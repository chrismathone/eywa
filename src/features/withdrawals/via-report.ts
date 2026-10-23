/**
 * **퇴원은 퇴원보고서로만** — 판정과 문구 한 곳(순수 · Vitest).
 *
 * 원장 2026-10-23 *"퇴원한 학생의 퇴원보고서를 새로 써야하는 경우는 앞으로 없도록. 퇴원 보고서를 써야 퇴원처리가 가능하도록."*
 * + *"대신 관리자가 어느 학생에 대해 퇴원보고서 카드에서 '강사 작성 없이 바로 퇴원(수강종료)' 가능하게"*.
 * 이미 퇴원한 학생은 보고서를 요청할 수 없다(작성 후보에서 빠지고 DB도 거절) — 보고서 없이 퇴원하면 그 학생은 영영 보고서가 없다.
 * 그래서 직원이 학생을 퇴원시키는 길은 전부 퇴원보고서(강사 작성 요청 → 승인 → 처리, 또는 관리자 바로 처리)를 지난다.
 * 서버 액션이 이 판정으로 거절한다 — 화면에서 버튼을 숨긴 것은 게이트가 아니다(#77).
 *
 * 🔑 그대로 두는 길(퇴원이 아니거나 이미 정해진 것 — 가드 [`via-report-wiring.test.ts`](./via-report-wiring.test.ts)가 목록을 잠근다):
 *  · 퇴원보고서의 최종 적용(DB `transition_withdrawal_report` — 승인 완료·처리일 cron·관리자 바로 처리가 모두 이 함수)
 *  · 이미 걸려 있던 퇴원 예약의 당일 처리(cron `apply-due-withdrawals`) — 이번 변경 전에 잡힌 예약을 깨지 않는다(새 예약 입구만 막는다)
 *  · 학생 병합(진 쪽 정리) · 옛 기록 등록(새 원생을 지난 퇴원 상태로 등록 · 엑셀 가져오기) · 데모 데이터
 *  · 반 이동 · 특강이 끝나도 다른 반을 계속 다니는 종료 · 한 과목만 끝내는 수강 종료(학생은 재원 그대로)
 *  · 반 폐지·종강·시트/엑셀 가져오기의 수강 종료(학생 상태는 그대로 — 수업 없는 재원생은 퇴원보고서로만 퇴원한다)
 * 장부 정리(관리 도구 '수강 없는 재원생' 일괄 퇴원)는 학생마다 **관리자 바로 처리 보고서**를 남기는 길로 옮겼다(보고서 없는 퇴원이 아니다).
 */
import { clipToWithdrawal, endScopeOf, type OtherSpan } from "@/features/attendance/enrollment-span";

/** 직원 화면의 직접 퇴원을 거절할 때. */
export const WITHDRAWAL_VIA_REPORT = "퇴원은 퇴원보고서로 처리합니다. 원생 화면의 '퇴원보고서'에서 진행해 주세요.";

/** 새 퇴원 예약(또는 예약 날짜 변경)을 거절할 때 — 미래 날짜 퇴원도 퇴원보고서가 그날 처리한다. */
export const SCHEDULE_VIA_REPORT =
  "퇴원 예약은 퇴원보고서로 겁니다. 원생 화면의 '퇴원보고서'에서 퇴원일을 정해 주세요. 걸려 있는 예약은 '퇴원 예약 취소'로 풀 수 있습니다.";

/** 학생이 다니는 마지막 반을 끝내려 할 때(끝내면 다니는 반이 없다 = 사실상 퇴원). */
export const LAST_COURSE_VIA_REPORT =
  "이 학생이 다니는 마지막 반이라 끝내면 퇴원입니다. 퇴원은 퇴원보고서로 처리합니다 — 원생 화면의 '퇴원보고서'에서 진행해 주세요.";

/**
 * 학생 폼(등록·수정) 저장이 **새로** 퇴원시키거나 새 퇴원 예약을 거는가 → 거절 문구(아니면 null).
 * `kind` = [`planFormWithdrawal`](@/features/students/withdrawal-plan)의 결과. 등록은 `prevStatus = null`.
 * - 이미 퇴원한 학생을 고치는 저장 · 새 원생을 지난 날짜의 퇴원 상태로 등록(옛 기록) = 그대로
 * - 걸려 있던 예약을 같은 날짜로 다시 저장 · 예약 취소(빈칸) = 그대로
 * - 재원·휴원 학생을 퇴원으로(예약을 오늘로 당기는 것 포함) · 새 예약 · 예약 날짜 변경 = 거절
 */
export function formWithdrawalViaReport(a: {
  prevStatus: string | null;
  prevWithdrawnAt?: string | null;
  kind: "withdraw" | "schedule" | "none";
  withdrawnAt: string | null;
}): string | null {
  if (a.kind === "none") return null;
  if (a.kind === "withdraw") return a.prevStatus === null || a.prevStatus === "withdrawn" ? null : WITHDRAWAL_VIA_REPORT;
  const prev = a.prevWithdrawnAt ? String(a.prevWithdrawnAt).slice(0, 10) : null;
  const keepsSchedule = a.prevStatus !== null && a.prevStatus !== "withdrawn" && prev !== null && a.withdrawnAt === prev;
  return keepsSchedule ? null : SCHEDULE_VIA_REPORT;
}

/** 학생의 수강 한 줄 — 종료 판정 재료(반 이름·과목은 반에서). */
export type EndRow = {
  id: string;
  classId: string;
  className: string;
  subject: string | null;
  start: string;
  end: string | null;
  isTransferred?: boolean;
};

/**
 * 수강 `target`을 `date`로 끝내면(함께 끝내는 수강 `endingIds`는 없는 셈 치고) 무엇이 되는지 — 이 반만 종강 / 그 과목 수강종료 / 퇴원.
 * 시간표 '수강 종료' 확인 문구([`loadEndScope`](@/features/timetable/server/end-scope))와 **같은 판정**(`endScopeOf`)이다 —
 * 화면이 "마지막 반"이라 말하는 것과 서버가 막는 것이 갈리지 않게.
 * - 같은 반의 다른 수강 줄(재등록)은 '다른 반'이 아니다(뱃지·ECS와 같은 축) · 학원 퇴원일로 다른 반 구간을 먼저 자른다(`clipToWithdrawal`)
 * - 저장은 미래 시작 수강의 종료일을 시작일로 당긴다(`endEnrollmentById`) — 판정 날짜도 같게 맞춘다.
 */
export function endScopeFor(
  rows: readonly EndRow[],
  target: EndRow,
  endingIds: ReadonlySet<string>,
  date: string,
  withdrawnAt: string | null,
) {
  const others: OtherSpan[] = rows
    .filter((r) => !endingIds.has(r.id) && r.classId !== target.classId)
    .map((r) =>
      clipToWithdrawal(
        { start: r.start, end: r.end, isTransferred: r.isTransferred, classId: r.classId, className: r.className, subject: r.subject },
        withdrawnAt,
      ),
    );
  const leftOn = target.start > date ? target.start : date;
  return endScopeOf(leftOn, target.subject, others);
}

/**
 * 마지막 반 게이트를 거는 학생인가 — 재원·휴원이고 퇴원 예약이 없는 학생만. 이미 퇴원(남은 수강 정리)·예비·상담 학생, 이번 변경 전에 걸린
 * 퇴원 예약이 있는 학생(퇴원은 이미 정해졌다 · 예약 학생은 퇴원보고서를 시작할 수 없다)은 막지 않는다. 시간표 확인 문구도 같은 판정을 쓴다.
 */
export function lastCourseGateApplies(status: string, withdrawnAt: string | null): boolean {
  return (status === "enrolled" || status === "on_hold") && !withdrawnAt;
}

/** 고른 수강을 끝내면 학생에게 이어지는 반이 하나도 없는가(= 사실상 퇴원) — 하나라도 '퇴원' 범위면 참. */
export function endsLastCourse(
  rows: readonly EndRow[],
  targetIds: readonly string[],
  date: string,
  withdrawnAt: string | null,
): boolean {
  const ending = new Set(targetIds);
  return rows.some((r) => ending.has(r.id) && endScopeFor(rows, r, ending, date, withdrawnAt).scope === "student");
}
