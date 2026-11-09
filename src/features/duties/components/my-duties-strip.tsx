import "server-only";
import { isReadonlyTeacherView } from "@/lib/auth/view-mode";
import { reportError } from "@/lib/observability/report-error";
import { kstToday } from "@/lib/date-kst";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { countDuties, foldCounts } from "../server/queries";
import { MyDutiesStripButton } from "./my-duties-strip-button";

/**
 * 강사 홈(원스크린 · 영어 시트) '오늘 내 업무' 한 줄(s2_0041 의무 장부) — 오늘 의무가 하나라도 있을 때만 선다.
 * 누르면 학생별 칸(출결·보고서·발송)이 펼쳐진다. 사람 판정은 할 일과 같은 문(`getStaffTaskViewer` — '다른 강사 뷰'면 그 강사).
 * ⚠️ 부르는 쪽이 Suspense로 감싼다(전원이 매일 여는 화면 — 첫 페인트를 막지 않는다, B7). 표가 아직 없는 지점(#95)·조회 실패면 줄이 안 선다.
 */
export async function MyDutiesStrip({ className }: { className?: string } = {}) {
  const found = await loadMine();
  return found ? <MyDutiesStripButton {...found} className={className} /> : null;
}

async function loadMine(): Promise<{ date: string; total: number; done: number; late: number; lang: "ko" | "en" } | null> {
  try {
    const [viewer, readonly, lang] = await Promise.all([getStaffTaskViewer(), isReadonlyTeacherView(), getTeacherViewLang()]);
    if (!viewer || readonly) return null;
    const date = kstToday();
    const counts = foldCounts((await countDuties(viewer.user.tenantId, viewer.user.id, date, date)).filter((c) => c.period === "daily"));
    return counts.total ? { date, ...counts, lang } : null;
  } catch (error) {
    reportError(error, { scope: "duties.strip" });
    return null;
  }
}
