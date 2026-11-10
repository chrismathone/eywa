import { bearerMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError, reportWarning } from "@/lib/observability/report-error";
import { fetchInChunks } from "@/lib/supabase/batch";
import {
  groupPathsByBucket,
  RECORDING_RETENTION_DAYS,
  retentionCutoffISO,
  RETENTION_IN_FLIGHT,
  RETENTION_MIRROR,
  RETENTION_TABLES,
  withoutMirroredPaths,
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
const PATH_CHUNK = 40; // 경로(약 80자)를 주소에 싣는 `.in()` — 100개면 주소가 8KB를 넘는다(B3 · #53)

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const cutoff = retentionCutoffISO(new Date());
  const result: Record<string, number> = {};

  for (const { table, kind, dateColumn } of RETENTION_TABLES) {
    // 도메인 날짜가 NULL인 행은 created_at 폴백으로 별도 처리하지 않고 보존(삭제는 보수적으로).
    // 상담 행은 녹음을 붙일 때 경로와 '업로드됨'을 **한 문장으로** 쓰고, 녹음 행은 그 뒤에 생긴다(액션 순서) —
    // 그 사이에 이 정리가 돌면 주인 확인(아래)에 아직 안 걸려 방금 올린 원본을 지울 수 있다. 전사가 도는 중인 행은 건너뛴다
    // (멈춘 행은 재대조 cron이 '실패'로 돌리면 다음 날 판단한다). 다른 표는 거르지 않는다(`id is not null` = 항상 참).
    const [skipCol, skipOp, skipVal]: [string, string, string] =
      table === RETENTION_MIRROR.mirror ? ["processing_status", "not.in", RETENTION_IN_FLIGHT] : ["id", "not.is", "null"];
    const { data: rows, error } = await admin
      .from(table)
      .select("id, audio_path")
      .not("audio_path", "is", null)
      .filter(skipCol, skipOp, skipVal)
      .lt(dateColumn, cutoff)
      .order(dateColumn, { ascending: true })
      .limit(BATCH_PER_TABLE);
    if (error) {
      reportError(error, { scope: "cron.recordings-retention", table });
      result[table] = -1;
      continue;
    }
    let targets = rows ?? [];
    // 상담 행은 녹음 행의 경로를 베껴 둔 것일 수 있다 — 그 원본은 녹음 행의 날짜로 판단하므로 여기서 건너뛴다
    // (오래된 상담에 새로 붙인 녹음이 상담일 기준으로 지워지던 구멍 · RETENTION_MIRROR ①).
    if (table === RETENTION_MIRROR.mirror && targets.length) {
      try {
        const owned = await fetchInChunks(
          targets.map((r) => r.audio_path).filter((p): p is string => !!p),
          (chunk) => admin.from(RETENTION_MIRROR.source).select("audio_path").in("audio_path", chunk),
          PATH_CHUNK,
        );
        targets = withoutMirroredPaths(targets, new Set(owned.map((o) => o.audio_path as string)));
      } catch (e) {
        reportError(e, { scope: "cron.recordings-retention", table, step: "mirror-check" });
        result[table] = -1;
        continue;
      }
    }
    if (!targets.length) {
      result[table] = 0;
      continue;
    }

    // 버킷 단위 일괄 삭제 → 성공한 경우에만 행 NULL(실패 시 다음 실행이 재시도).
    // 이미 없는 원본을 지우라고 해도 Storage는 오류 없이 넘어간다 — 지난번에 원본만 지우고 행을 못 비운 경우도 이 길로 정리된다.
    const grouped = groupPathsByBucket(targets, kind);
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
    // 조회 때의 경로가 그대로인 행만 비운다 — 그 사이 같은 상담에 새 음성이 붙어 경로가 바뀌었으면 새 경로를 지우지 않는다
    // (경로를 주소에 함께 실으므로 PATH_CHUNK씩 · 앞 묶음이 실패하면 멈추고 다음 실행이 남은 행을 다시 본다).
    let cleared = 0;
    let upErr: unknown = null;
    for (let i = 0; i < targets.length; i += PATH_CHUNK) {
      const chunk = targets.slice(i, i + PATH_CHUNK);
      const { data: done, error } = await admin
        .from(table)
        .update({ audio_path: null })
        .in("id", chunk.map((r) => r.id))
        .in("audio_path", chunk.map((r) => r.audio_path).filter((p): p is string => !!p))
        .select("id");
      if (error) {
        upErr = error;
        break;
      }
      cleared += done?.length ?? 0;
    }
    if (upErr) {
      reportError(upErr, { scope: "cron.recordings-retention", table });
      result[table] = -1;
      continue;
    }
    // 녹음 원본을 지웠으면 같은 경로를 가리키던 상담 행도 비운다(RETENTION_MIRROR ②) — 실패해도 다음 실행이 상담 행 쪽에서 다시 본다.
    if (table === RETENTION_MIRROR.source) {
      try {
        await fetchInChunks(
          targets.map((r) => r.audio_path).filter((p): p is string => !!p),
          (chunk) => admin.from(RETENTION_MIRROR.mirror).update({ audio_path: null }).in("audio_path", chunk).select("id"),
          PATH_CHUNK,
        );
      } catch (e) {
        reportError(e, { scope: "cron.recordings-retention", table: RETENTION_MIRROR.mirror, step: "mirror-clear" });
      }
    }
    result[table] = cleared;
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
  return NextResponse.json({ cutoff, retentionDays: RECORDING_RETENTION_DAYS, ...result });
}
