import { bearerMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { DAILY_BRIEFING_DISABLED_MESSAGE } from "@/features/dashboard/briefing-status";

export const dynamic = "force-dynamic";

/** 외부에 남은 과거 스케줄도 브리핑 생성을 다시 시작할 수 없게 한다. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(req.headers.get("authorization") ?? "", secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: false, disabled: true, error: DAILY_BRIEFING_DISABLED_MESSAGE }, { status: 410 });
}
