import { NextResponse } from "next/server";
import { isGateFailure, scopedViewer } from "@/features/assistant/server/gate";
import { suggestionScope, suggestionsFor } from "@/features/assistant/server/suggestions-service";
import { FALLBACK_SUGGESTIONS } from "@/features/assistant/suggestions";
import { kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";

export const dynamic = "force-dynamic";
const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/**
 * 학원 비서 첫 화면 추천 질문(`SuggestionsResponse`) — 이 지점의 최근 추세 신호로 고른 6개. AI는 부르지 않는다.
 * `?have=<scope>.<day>` = 화면이 오늘 묶음을 이미 가졌다(세지 않고 그대로) · `?refresh=1` = '새로 고침'(다시 센다).
 * 셸이 저절로 부르는 조회라 GET(#137). 계산이 실패하면 고정 문장(`fallback`).
 */
export async function GET(request: Request) {
  const viewer = await scopedViewer();
  if (isGateFailure(viewer)) return NextResponse.json({ error: viewer.error }, { status: viewer.status, ...NO_STORE });
  const url = new URL(request.url);
  const today = kstToday();
  try {
    return NextResponse.json(
      await suggestionsFor(viewer.owner, viewer.scope, today, { have: url.searchParams.get("have"), refresh: url.searchParams.get("refresh") === "1" }),
      NO_STORE,
    );
  } catch (error) {
    reportError(error, { scope: "api.assistant.suggestions", tenantId: viewer.owner.tenantId });
    return NextResponse.json({ scope: suggestionScope(viewer.owner, viewer.scope), day: today, items: FALLBACK_SUGGESTIONS, fallback: true }, NO_STORE);
  }
}
