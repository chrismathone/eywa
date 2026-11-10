import { NextResponse } from "next/server";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { classWeekdays, listOwnerDuties, listOwnerMonthDuties, studentWeekdays, weekCells } from "@/features/duties/server/queries";
import { weekDaysOf } from "@/features/duties/view";
import { isValidYmd, kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";

/**
 * 내 의무(GET) — 강사 홈 '오늘 내 업무'를 펼칠 때 부른다(s2_0043). 사람 확인은 할 일과 같은 문(`getStaffTaskViewer` — '다른 강사 뷰'면 그 강사).
 * 그날 일간 의무 + 최근 7일 학생별 완료 재료 + 이번 달 의무(월 상담 · 신규생 콜). 내 것만(관리자 범위 화면은 다음 단계). 사람마다 다른 응답이라 캐시 금지.
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("date");
  const date = isValidYmd(raw) ? raw : kstToday();
  try {
    const viewer = await getStaffTaskViewer();
    if (!viewer) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401, headers: NO_STORE });
    const days = weekDaysOf(date); // 항상 월요일 시작(월~일)
    const [items, week, month] = await Promise.all([
      listOwnerDuties(viewer.user.tenantId, viewer.user.id, date),
      weekCells(viewer.user.tenantId, viewer.user.id, days[0]!, days[6]!),
      listOwnerMonthDuties(viewer.user.tenantId, viewer.user.id, date.slice(0, 7)),
    ]);
    const classIds = [...new Set([...items, ...week].flatMap((x) => (x.classId ? [x.classId] : [])))];
    const classDays = await classWeekdays(viewer.user.tenantId, classIds, days[0]!, days[6]!);
    const studentDays = await studentWeekdays(viewer.user.tenantId, classIds, classDays);
    return NextResponse.json({ date, days, items, week, month, classDays, studentDays }, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.duties.mine" });
    return NextResponse.json({ error: "오늘 업무를 불러오지 못했습니다" }, { status: 500, headers: NO_STORE });
  }
}
