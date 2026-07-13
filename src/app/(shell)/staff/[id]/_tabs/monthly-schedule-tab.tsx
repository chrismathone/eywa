import { kstMonth } from "@/lib/date-kst";
import {
  resolveMonthlyTasks,
  fetchNotionUserOptions,
  type NotionUserOption,
} from "@/features/staff/server/notion";
import { MonthlyScheduleView } from "../_components/monthly-schedule-view";

// '월간일정' 탭(근무일정 대체) — Notion 업무를 이번 달 기준으로 서버에서 초기 로드해 클라 뷰에 주입.
// 연동 미설정/미매핑이면 API 호출 없이 즉시 상태 반환(토큰·컬럼 없어도 안전). 미매핑+사무실이면 매핑용 사용자 목록도 함께.
export async function MonthlyScheduleTab({
  staffId,
  canManage,
}: {
  staffId: string;
  canManage: boolean;
}) {
  const month = kstMonth();
  const initial = await resolveMonthlyTasks(staffId, month);

  let userOptions: NotionUserOption[] = [];
  if (initial.ok && initial.state === "unmapped" && canManage) {
    try {
      userOptions = await fetchNotionUserOptions();
    } catch {
      userOptions = [];
    }
  }

  return (
    <MonthlyScheduleView
      staffId={staffId}
      canManage={canManage}
      initialMonth={month}
      initial={initial}
      userOptions={userOptions}
    />
  );
}
