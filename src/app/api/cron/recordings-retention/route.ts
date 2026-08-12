import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError, reportWarning } from "@/lib/observability/report-error";
import {
  groupPathsByBucket,
  RECORDING_RETENTION_DAYS,
  retentionCutoffISO,
  RETENTION_TABLES,
  TRANSCRIPT_RETENTION_DAYS,
  TRANSCRIPT_TABLES,
} from "@/lib/storage/retention";

/**
 * 녹음 원본 보존기간 삭제 cron — Vercel cron이 매일 호출(vercel.json `0 17 * * *` = KST 02:00).
 * 원장 결정(2026-07-28): **90일**. 도메인 날짜(held_at·consulted_at) 기준으로 만료된 원본 오디오를
 * Supabase Storage에서 지우고 행의 audio_path를 NULL로 — 전사·AI 분석 결과는 영구 보존(ijw
 * cleanupExpiredRecordings 정책 승계, 그 함수는 ijw 소등과 함께 폐기).
 *
 * ⚠️ 도메인 날짜 기준인 이유: ijw 이전분은 created_at=임포트일(2026-07-01)이라 created_at 기준이면
 * 3월 회의가 10월까지 살아남는다(실측). ⚠️ audio_path NULL = UI에서 재생·재전사 어포던스가 자연히
 * 사라짐(경로를 남기고 만료 플래그를 두는 대안은 스키마 추가 대비 이득이 없어 비채택).
 * ⚠️ 백엔드가 supabase일 때만 동작 — 전환 전(gcs)엔 no-op(이전 중 GCS 원본을 지우면 이전이 깨진다).
 */
export const dynamic = "force-dynamic";

const BATCH_PER_TABLE = 100; // 하루 100건/테이블 상한 — 초기 백로그(~70건)도 이틀 내 소화(B2: 무한 스캔 금지)

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const cutoff = retentionCutoffISO(new Date());
  const result: Record<string, number> = {};

  for (const { table, kind, dateColumn } of RETENTION_TABLES) {
    // 도메인 날짜가 NULL인 행은 created_at 폴백으로 별도 처리하지 않고 보존(삭제는 보수적으로).
    const { data: rows, error } = await admin
      .from(table)
      .select("id, audio_path")
      .not("audio_path", "is", null)
      .lt(dateColumn, cutoff)
      .order(dateColumn, { ascending: true })
      .limit(BATCH_PER_TABLE);
    if (error) {
      reportError(error, { scope: "cron.recordings-retention", table });
      result[table] = -1;
      continue;
    }
    if (!rows?.length) {
      result[table] = 0;
      continue;
    }

    // 버킷 단위 일괄 삭제 → 성공한 경우에만 행 NULL(실패 시 다음 실행이 재시도).
    const grouped = groupPathsByBucket(rows, kind);
    let removedOk = true;
    for (const [bucket, paths] of Object.entries(grouped)) {
      const { error: rmErr } = await admin.storage.from(bucket).remove(paths);
      if (rmErr) {
        reportError(rmErr, { scope: "cron.recordings-retention", table, bucket });
        removedOk = false;
      }
    }
    if (!removedOk) {
      result[table] = -1;
      continue;
    }
    const ids = rows.map((r) => r.id);
    const { error: upErr } = await admin.from(table).update({ audio_path: null }).in("id", ids);
    if (upErr) {
      reportError(upErr, { scope: "cron.recordings-retention", table });
      result[table] = -1;
      continue;
    }
    result[table] = ids.length;
  }

  const total = Object.values(result)
    .filter((n) => n > 0)
    .reduce((s, n) => s + n, 0);
  if (total > 0) {
    reportWarning(`녹음 보존기간(${RECORDING_RETENTION_DAYS}일) 원본 삭제 ${total}건`, {
      scope: "cron.recordings-retention",
      ...result,
    });
  }

  const transcripts = await purgeExpiredTranscripts(admin);

  return NextResponse.json({
    cutoff,
    retentionDays: RECORDING_RETENTION_DAYS,
    ...result,
    transcriptRetentionDays: TRANSCRIPT_RETENTION_DAYS,
    transcripts,
  });
}

/**
 * 🔴 등록상담 **전사 원문 파기**(원장 결정 2026-08-12: 14일).
 *
 * 지우는 것 = `transcription`(통짜 전사) + `speaker_labels`(화자별 발화) — **오간 말 그대로**.
 * 남기는 것 = AI 분석 결과(요약·13섹션)와 상담 기록. 위험이 가장 큰 축어 전문만 짧게 끊고 쓸모는 남긴다.
 *
 * ⚠️ 등록 여부와 무관하게 **전건** 적용. 전사는 기록의 근거일 뿐 기록 자체가 아니다.
 * ⚠️ 전사는 **두 표**에 산다(단일 미러 `enrollment_consultations` + 녹음 행 `consultation_recordings`) —
 *    한쪽만 지우면 다른 쪽에 그대로 남는다. `TRANSCRIPT_TABLES`가 그 목록이고 새 표가 생기면 여기도 추가.
 * 🔴 되돌릴 수 없다 — 지운 뒤엔 "AI 분석 다시 생성"이 불가능하다(오디오도 90일에 사라져 재전사 불가).
 */
async function purgeExpiredTranscripts(
  admin: ReturnType<typeof createAdminClient>,
): Promise<Record<string, number>> {
  const cutoff = retentionCutoffISO(new Date(), TRANSCRIPT_RETENTION_DAYS);
  const out: Record<string, number> = {};

  for (const { table, dateColumn } of TRANSCRIPT_TABLES) {
    const { data: rows, error } = await admin
      .from(table)
      .select("id")
      .lt(dateColumn, cutoff)
      .not("transcription", "is", null)
      .order(dateColumn, { ascending: true })
      .limit(BATCH_PER_TABLE);
    if (error) {
      // 전사 파기가 실패해도 오디오 파기(본 작업)를 되돌리지 않는다 — 다음 실행이 재시도한다.
      reportError(error, { scope: "cron.transcript-retention", table });
      out[table] = -1;
      continue;
    }
    if (!rows?.length) {
      out[table] = 0;
      continue;
    }
    const ids = rows.map((r) => r.id);
    const { error: upErr } = await admin
      .from(table)
      .update({ transcription: null, speaker_labels: null })
      .in("id", ids);
    if (upErr) {
      reportError(upErr, { scope: "cron.transcript-retention", table });
      out[table] = -1;
      continue;
    }
    out[table] = ids.length;
  }

  const total = Object.values(out)
    .filter((n) => n > 0)
    .reduce((s, n) => s + n, 0);
  if (total > 0) {
    reportWarning(`전사 보유기간(${TRANSCRIPT_RETENTION_DAYS}일) 원문 파기 ${total}건`, {
      scope: "cron.transcript-retention",
      ...out,
    });
  }
  return out;
}
