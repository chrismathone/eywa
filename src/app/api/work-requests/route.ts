import { NextResponse } from "next/server";
import { loadWorkBoard } from "@/features/work-requests/server/board";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";

/** 대시보드 '업무 흐름' — 화면이 뜬 뒤 따로 읽는다(GET · 셸이 저절로 부르는 조회는 서버 액션이 아니다 — #137). */
export async function GET() {
  try {
    return NextResponse.json(await loadWorkBoard(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    reportError(error, { scope: "api.work-requests" });
    return NextResponse.json({ error: "업무 요청을 불러오지 못했습니다" }, { status: 500 });
  }
}
