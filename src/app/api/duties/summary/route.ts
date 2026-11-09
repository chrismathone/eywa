import { NextResponse } from "next/server";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { loadDutySummary } from "@/features/duties/server/summary";
import { reportError } from "@/lib/observability/report-error";

/**
 * 내 업무 숫자(GET) — 강사 홈 '내 업무' 줄이 **보일 때 60초마다** 다시 받는다(ClassNote 매칭 아이콘과 같은 결 · 셸 자동 호출은 서버 액션 금지 #137).
 * 사람 확인은 할 일과 같은 문. 사람마다 다른 응답이라 캐시 금지.
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  try {
    const viewer = await getStaffTaskViewer();
    if (!viewer) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401, headers: NO_STORE });
    return NextResponse.json(await loadDutySummary(viewer.user.tenantId, viewer.user.id), { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.duties.summary" });
    return NextResponse.json({ error: "업무 숫자를 불러오지 못했습니다" }, { status: 500, headers: NO_STORE });
  }
}
