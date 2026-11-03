import { NextResponse } from "next/server";
import { loadInstrumentExtras } from "@/features/dashboard/instruments/extras-server";
import { reportError } from "@/lib/observability/report-error";

/**
 * '대시보드 전환' 화면의 추가 값(GET) — 화면을 열 때와 [새로 고침]은 전부, 스냅샷이 다시 읽힐 때는 `?part=checks`
 * (확인할 일 · 업무 비서에 드는 칸과 3개월 내 퇴원 명단만 — 긴 추이 · 청구는 다시 돌리지 않는다).
 * 저절로 도는 조회라 서버 액션이 아니라 라우트다(gotchas #137). 권한은 `loadInstrumentExtras`가 운영실 스냅샷과 같은 판정으로 본다.
 * 답의 `failed` = 읽지 못한 칸(화면은 그 칸만 이전 값을 둔다).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  try {
    const extras = await loadInstrumentExtras({ checksOnly: new URL(request.url).searchParams.get("part") === "checks" });
    if (!extras) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
    return NextResponse.json(extras, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.dashboard.instruments" });
    return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
