import "server-only";
import { isReadonlyTeacherView } from "@/lib/auth/view-mode";
import { reportError } from "@/lib/observability/report-error";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { loadDutySummary } from "../server/summary";
import { flushDuties } from "../server/live-sync";
import { MyDutiesStripButton, type DutyStripSummary } from "./my-duties-strip-button";

/**
 * 강사 홈(원스크린 · 영어 시트) '내 업무' 한 줄(s2_0043 의무 장부) — 오늘·이번 달 의무가 하나라도 있을 때 선다.
 * 머리 한 줄 아래 완료도 칸(오늘 · 기한 초과 · 이번 주 · 이달 상담 · 신규생 콜)이 **접힌 채로도** 보이고, 펼치면 오늘 / 이번 주 / 이번 달 보기.
 * 숫자는 보일 때 60초마다 GET `/api/duties/summary`로 새로 받는다(새로고침 없이 — 원장 2026-11-09 *"실시간 반영"*).
 * 사람 판정은 할 일과 같은 문(`getStaffTaskViewer` — '다른 강사 뷰'면 그 강사).
 * ⚠️ 부르는 쪽이 Suspense로 감싼다(전원이 매일 여는 화면 — 첫 페인트를 막지 않는다, B7). 표가 아직 없는 지점(#95)·조회 실패면 줄이 안 선다.
 */
export async function MyDutiesStrip({ className }: { className?: string } = {}) {
  const found = await loadMine();
  return found ? <MyDutiesStripButton summary={found} className={className} /> : null;
}

async function loadMine(): Promise<DutyStripSummary | null> {
  try {
    const [viewer, readonly, lang] = await Promise.all([getStaffTaskViewer(), isReadonlyTeacherView(), getTeacherViewLang()]);
    if (!viewer || readonly) return null;
    await flushDuties(viewer.user.tenantId); // 방금 저장한 것을 먼저 장부에 맞춘다(s2_0051 · 던지지 않는다)
    const summary = await loadDutySummary(viewer.user.tenantId, viewer.user.id);
    if (!summary.today.total && !summary.counsel.total && !summary.exam.total && !summary.newcomer.total) return null;
    return { ...summary, lang };
  } catch (error) {
    reportError(error, { scope: "duties.strip" });
    return null;
  }
}
