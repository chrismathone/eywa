import { attendanceRate } from "@/lib/calc/attendance";
import { shiftDate } from "@/features/newcomers/onboarding-items";
import type { AttendanceSnapshot } from "@/features/dashboard/server/queries";

/** 출결 칸 하나 — 같은 칸의 정정은 `effectiveAttendanceRecords`가 이미 접어 둔 값이다. */
type AttendanceCell = { session_date: string; status: string };

export const ATTENDANCE_TREND_DAYS = 14;

/** 조회 시작일 = 추이 첫날. 쿼리와 추이가 같은 창을 쓰도록 한 곳에서 낸다. */
export function attendanceWindowStart(today: string): string {
  return shiftDate(today, -(ATTENDANCE_TREND_DAYS - 1));
}

/**
 * 운영실 '출결 현황'(도넛) + '출석률 추이'(14일) 한 벌.
 * 🔴 도넛은 **오늘 칸만** 센다(원장 2026-09-13 *"출결 현황은 오늘것만 카운팅 되게"*) — 오늘 기록이 없으면
 * (일요일·첫 수업 전) 지난 기록일로 넘어가지 않고 null이다. 예전엔 14일 안의 마지막 기록일을 대신 세서
 * 일요일에 토요일 숫자가 '출결 현황'으로 섰다. 추이는 지난 날을 보여 주는 게 목적이라 그대로 둔다.
 */
export function attendanceOverview(cells: readonly AttendanceCell[], today: string) {
  const start = attendanceWindowStart(today);
  const trend = Array.from({ length: ATTENDANCE_TREND_DAYS }, (_, i) => {
    const date = shiftDate(start, i);
    const day = cells.filter((r) => r.session_date === date);
    return {
      date,
      total: day.length,
      rate: day.length ? attendanceRate(attended(day), day.length) : null,
    };
  });
  const todayCells = cells.filter((r) => r.session_date === today);
  const count = (status: string) => todayCells.filter((r) => r.status === status).length;
  const snapshot: AttendanceSnapshot | null = todayCells.length
    ? {
        date: today,
        total: todayCells.length,
        present: count("present"),
        absent: count("absent"),
        late: count("late"),
        excused: count("excused"),
        rate: attendanceRate(attended(todayCells), todayCells.length),
      }
    : null;
  return { trend, snapshot };
}

function attended(cells: readonly AttendanceCell[]): number {
  return cells.filter((r) => r.status === "present" || r.status === "late").length;
}
