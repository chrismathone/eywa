/**
 * MCS 로스터 판정 — **누가 이 시트에 서는가**. 순수(Vitest).
 *
 * 원장 2026-08-31: *"퇴원생 이런거 잘보고 현재 수업중인 학생만 나와야해. 재원생이어야한다 이말이지.
 * 반이동 이런것도 잘 보고. 수업 종료되었는데 나오면 안되는거야."*
 *
 * 🔴 **끝나는 길이 셋이고 셋 다 봐야 한다.**
 *    ① 수강 종료(`enrollments.end_date`) ② **반이동 전출**(`is_transferred` — 새 반에서 보이므로 옛 반엔
 *    안 남긴다. 종료일 **당일에** 끝난다: `isEnrollmentEndedOn`의 세 번째 인자) ③ **학원 퇴원**
 *    (`students.withdrawn_at` — 수강에 종료일이 안 찍힌 채 퇴원하는 경우가 있어 수강만 보면 안 걸린다).
 *    실효 종료일 = ①과 ③ 중 **이른** 것(시간표·ECS와 같은 산식).
 *
 * 🔴 **기준일은 "보고 있는 달"에 갇힌다.** 지난 달을 열면 그 달 말일, 이번 달이면 오늘, 다음 달이면 1일이
 *    기준이다 — 오늘 하나로 판정하면 8월 시트를 9월에 열었을 때 8월 내내 다닌 학생이 통째로 사라진다.
 * ⚠️ 행에 서는 것과 **칸이 켜지는 것은 다른 판정**이다. 로스터에 서더라도 그 학생이 아직 안 온 날짜는
 *    `cell-state.ts`가 날짜별로 다시 `off-roster`로 끈다(달 중간 입반).
 * ⚠️ `on_hold`(휴원)는 여기서 보지 않는다 — 휴원은 시간이 아니라 상태이고 명단엔 남는 게 규약이다
 *    (`enrollmentPhaseOn` 주석). 출결 대상 판정과는 쓰는 자리가 다르다.
 */
import { isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import { monthRange } from "@/lib/date-kst";

export type MathEnrollmentWindow = {
  startDate: string | null;
  endDate: string | null;
  /** 반이동 전출 — 옛 반에선 종료일 당일에 끝난다. */
  isTransferred: boolean;
};

/**
 * 그 달 화면의 로스터 기준일 — `오늘`을 그 달 안으로 접는다.
 * 과거 달 → 말일 · 이번 달 → 오늘 · 미래 달 → 1일.
 */
export function rosterAnchorOf(month: string, today: string): string {
  const { from, to } = monthRange(month);
  if (today < from) return from;
  if (today > to) return to;
  return today;
}

/** 학원 퇴원을 반영한 **실효 종료일** — 수강 종료와 퇴원일 중 이른 것. */
export function effectiveEndDate(endDate: string | null, withdrawnAt: string | null): string | null {
  if (!endDate) return withdrawnAt;
  if (!withdrawnAt) return endDate;
  return endDate < withdrawnAt ? endDate : withdrawnAt;
}

/**
 * 기준일에 이 반 재원인가 — 수강 구간이 여럿이면 하나라도 걸리면 재원(나갔다 돌아온 경우).
 * `startDate`가 없는 행은 근거로 쓰지 않는다(언제부터인지 모르는 것을 "다닌다"로 읽지 않는다).
 */
export function isOnMathRoster(
  enrollments: readonly MathEnrollmentWindow[],
  withdrawnAt: string | null,
  date: string,
): boolean {
  return enrollments.some((e) => {
    if (e.startDate == null) return false;
    return isEnrollmentOnRosterOn(
      {
        startDate: e.startDate,
        endDate: effectiveEndDate(e.endDate, withdrawnAt),
        isTransferred: e.isTransferred,
      },
      date,
    );
  });
}
