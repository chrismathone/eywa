import { bearerMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability/report-error";
import { checkSyncAgentHeartbeat } from "@/features/sync-agent/server/heartbeat-alert";

/**
 * 연동 PC 신호 끊김 점검 — 10분마다(vercel.json). 원장 2026-11-09 *"제안 바로 적용"* — 11-06 발송 정지(1시간 40분)를 아무도 몰랐던 일.
 * 규칙·문구 = `src/features/sync-agent/heartbeat-alert.ts`. 끊김 한 번에 원장 벨 한 번(중요 알림).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const results = await checkSyncAgentHeartbeat();
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    reportError(e, { scope: "cron.sync-agent-heartbeat" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
