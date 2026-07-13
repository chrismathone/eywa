import { kstMonth } from "@/lib/date-kst";
import { resolveMonthlyTasks } from "@/features/staff/server/notion";
import { MonthlyScheduleView } from "../_components/monthly-schedule-view";

// '월간일정' 탭(근무일정 대체) — Notion 업무를 이번 달 기준으로 서버에서 초기 로드해 클라 뷰에 주입.
// 연동 미설정/미매핑이면 Notion 호출 없이 즉시 상태 반환(첫 페인트 안 막음, B7) — 자동연결·수동 후보는
// 클라(monthly-schedule-view)가 화면 표시 후 prepareNotionMapping 액션으로 지연 로드한다.
export async function MonthlyScheduleTab({
  staffId,
  staffName,
  canManage,
}: {
  staffId: string;
  staffName: string;
  canManage: boolean;
}) {
  const month = kstMonth();
  const initial = await resolveMonthlyTasks(staffId, month);

  return (
    <MonthlyScheduleView
      staffId={staffId}
      staffName={staffName}
      canManage={canManage}
      initialMonth={month}
      initial={initial}
    />
  );
}
