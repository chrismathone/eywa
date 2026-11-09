import "server-only";
import { isReadonlyTeacherView } from "@/lib/auth/view-mode";
import { reportError } from "@/lib/observability/report-error";
import { addDays, kstToday } from "@/lib/date-kst";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { countDuties, foldCounts, listOwnerMonthDuties } from "../server/queries";
import { buildMonthRows, foldRows } from "../view-month";
import { MyDutiesStripButton, type DutyStripSummary } from "./my-duties-strip-button";

/**
 * 강사 홈(원스크린 · 영어 시트) '내 업무' 한 줄(s2_0041 의무 장부) — 오늘·이번 달 의무가 하나라도 있을 때 선다.
 * 머리 한 줄 아래 완료도 칸(오늘 · 기한 초과 · 이번 주 · 이달 상담 · 신규생 콜)이 **접힌 채로도** 보이고, 펼치면 오늘 / 이번 주 / 이번 달 보기.
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
    const date = kstToday();
    const month = date.slice(0, 7);
    // 오늘 · 이번 주 · 이번 달은 서로 독립 — 같은 Promise.all(B4).
    const [todayRows, weekRows, monthItems] = await Promise.all([
      countDuties(viewer.user.tenantId, viewer.user.id, date, date),
      countDuties(viewer.user.tenantId, viewer.user.id, addDays(date, -6), date),
      listOwnerMonthDuties(viewer.user.tenantId, viewer.user.id, month),
    ]);
    const todayDaily = todayRows.filter((c) => c.period === "daily");
    const today = foldCounts(todayDaily);
    const { counsel, newcomer } = buildMonthRows(monthItems, Date.now());
    const counselCount = foldRows(counsel), newcomerCount = foldRows(newcomer);
    if (!today.total && !counselCount.total && !newcomerCount.total) return null;
    return { date, month, today, week: foldCounts(weekRows.filter((c) => c.period === "daily")),
      byKind: todayDaily.map((c) => ({ kind: c.kind, total: c.total, done: c.done, late: c.late })), counsel: counselCount, newcomer: newcomerCount, lang };
  } catch (error) {
    reportError(error, { scope: "duties.strip" });
    return null;
  }
}
