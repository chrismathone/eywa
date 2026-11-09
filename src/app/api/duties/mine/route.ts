import { NextResponse } from "next/server";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { listOwnerDuties } from "@/features/duties/server/queries";
import { isValidYmd, kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";

/**
 * 내 의무 목록(GET) — 강사 홈 '오늘 내 업무' 줄을 펼칠 때 부른다(s2_0039). 사람 확인은 할 일과 같은 문(`getStaffTaskViewer` — '다른 강사 뷰'면 그 강사).
 * 내 것만 내려간다(관리자 범위 화면은 2단계). 사람마다 다른 응답이라 캐시 금지.
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("date");
  const date = isValidYmd(raw) ? raw : kstToday();
  try {
    const viewer = await getStaffTaskViewer();
    if (!viewer) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401, headers: NO_STORE });
    const items = await listOwnerDuties(viewer.user.tenantId, viewer.user.id, date);
    return NextResponse.json({ date, items }, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.duties.mine" });
    return NextResponse.json({ error: "오늘 업무를 불러오지 못했습니다" }, { status: 500, headers: NO_STORE });
  }
}
