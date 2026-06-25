import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError, reportWarning } from "@/lib/observability/report-error";

/**
 * 멈춘 전사 회수 cron (B2) — Vercel cron이 호출(vercel.json `0 18 * * *` = 매일 1회).
 * ⚠️ Vercel Hobby 플랜은 cron이 **하루 1회**로 제한 → 일일 스케줄. 더 빠른 회수(~30분)가 필요하면
 * Pro 업그레이드 후 `*/15 * * * *`로 바꾸거나, 외부 스케줄러(cron-job.org 등)가 `Authorization: Bearer $CRON_SECRET`로 이 라우트를 주기 호출.
 *
 * 배경: AssemblyAI 웹훅이 유실/지연되면 행이 'transcribing'/'analyzing'에 영구 정지하고 알림도 없었다
 * (웹훅이 유일한 'completed'/'failed' 기록자). 30분 넘게 in-progress인 행을 **명시 실패**로 전환한다.
 * 자동 재제출 대신 'failed'로 두는 이유: 사용자가 기존 '다시 시도'(retry) 버튼으로 인지·복구하게 하고,
 * 무한 재시도·유료 재전사 폭주를 막기 위함. 회수 건수는 reportWarning으로 로깅(관측성).
 */
export const dynamic = "force-dynamic";

const STUCK_STATES = ["uploaded", "transcribing", "analyzing"];
const STUCK_MINUTES = 30;
const TABLES = ["meeting_minutes", "enrollment_consultations", "student_consultations"] as const;
const STUCK_ERROR = "전사 시간 초과(웹훅 미수신). 다시 시도하세요.";

export async function GET(req: Request) {
  // CRON_SECRET 미설정이면 라우트를 닫는다(임의 호출로 in-progress 행 강제 실패 방지).
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
  const reconciled: Record<string, number> = {};

  for (const table of TABLES) {
    const { data, error } = await admin
      .from(table)
      .update({ processing_status: "failed", processing_error: STUCK_ERROR })
      .in("processing_status", STUCK_STATES)
      .lt("updated_at", cutoff)
      .select("id");
    if (error) {
      reportError(error, { scope: "cron.reconcile", table });
      reconciled[table] = -1;
      continue;
    }
    reconciled[table] = data?.length ?? 0;
  }

  const total = Object.values(reconciled)
    .filter((n) => n > 0)
    .reduce((s, n) => s + n, 0);
  if (total > 0) {
    reportWarning(`멈춘 전사 ${total}건을 failed로 회수`, { scope: "cron.reconcile", reconciled });
  }
  return NextResponse.json({ ok: true, reconciled });
}
