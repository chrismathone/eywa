import "server-only";
import { kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";
import { isReadonlyTeacherView, viewAsTeacher } from "@/lib/auth/view-as";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { MyWorkRequests } from "./my-work-requests";

/**
 * 강사 홈 '받은 업무 요청' — 사람은 할 일과 같은 문(`getStaffTaskViewer` — '다른 강사 뷰'면 그 강사 · 지점 보기 중에는 없음).
 * '내 업무' 줄(의무 장부)과 따로 선다 — 의무가 없는 날 · 읽기 전용 강사뷰에서도 받은 요청은 보여야 한다(처리 칸은 읽기 전용이면 없다).
 * 목록은 화면이 뜬 뒤 GET `/api/work-requests`로 읽는다(첫 페인트를 막지 않는다 — B7 · 셸 자동 호출은 서버 액션 금지 #137).
 */
export async function MyWorkRequestsStrip({ className }: { className?: string } = {}) {
  try {
    const [viewer, as, readonly] = await Promise.all([getStaffTaskViewer(), viewAsTeacher(), isReadonlyTeacherView()]);
    if (!viewer) return null;
    // 강사뷰 대상을 확인하지 못한 요청(읽기 전용인데 대상이 없다)이면 그리지 않는다 — 보는 사람 본인의 요청이 그 강사 화면에 뜬다(리뷰 2026-11-11).
    if (readonly && !as) return null;
  } catch (error) {
    reportError(error, { scope: "work-requests.strip" });
    return null;
  }
  return <MyWorkRequests today={kstToday()} className={className} />;
}
