import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability/report-error";
import { refreshDemoMath } from "@/features/demo-history/math-refresh";
import { runDemoHistory } from "../../../../../scripts/_oneoff/backfill-demo-history.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** 06:05 KST: refresh the fictional demo tenant only. Both writers assert its slug and roster tags. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const asOf = new Date();
    const history = await runDemoHistory({ apply: true, asOf });
    const math = await refreshDemoMath(asOf, true);
    return NextResponse.json({ ok: true, history, math });
  } catch (error) {
    reportError(error, { where: "cron.demo-refresh" });
    return NextResponse.json({ ok: false, error: "데모 데이터 갱신에 실패했습니다" }, { status: 500 });
  }
}
