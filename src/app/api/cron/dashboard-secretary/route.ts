import { NextResponse } from "next/server";
import { runScheduledSecretary } from "@/features/dashboard/instruments/secretary-schedule";
import { bearerMatches } from "@/lib/http/secret-compare";
import { reportError } from "@/lib/observability/report-error";

/**
 * 업무 비서 예약 정리 — 매일 01:00 · 13:00 KST(vercel.json `0 4,16 * * *` UTC). 화면이 남긴 마지막 후보로 AI 정리를 만든다.
 * `?dry=1` = 누구에게 돌릴지만 센다(AI 호출 · 저장 없음).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(req.headers.get("authorization") ?? "", secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runScheduledSecretary(Date.now(), new URL(req.url).searchParams.get("dry") === "1");
    return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 500 : 200 });
  } catch (error) {
    reportError(error, { scope: "cron.dashboard-secretary" });
    return NextResponse.json({ ok: false, error: "업무 비서 예약 정리를 하지 못했습니다" }, { status: 500 });
  }
}
