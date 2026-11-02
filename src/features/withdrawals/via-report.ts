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
 *  · 반 이동 · 특강 등 같은 과목의 다른 반이 남는 종료(원장 2026-10-23 *"같은 과목중에 하나가 남아있을때는 그냥 특강 등의 반 수강종료이므로
 *    과목 수강종료(퇴원)이라고 볼 수 없어서 냅두는게 맞음."*) · 퇴원관리가 '수강종료'로 세지 않는 종료(특강만 다니던 과목의 특강이 끝남 등)
 *  · 반 폐지·종강·시트/엑셀 가져오기의 수강 종료(학생 상태는 그대로 — 수업 없는 재원생은 퇴원보고서로만 퇴원한다)
 *  · 그 밖의 직접 쓰기(로그인 세션으로 DB에 바로 쓰는 것)는 막지 않고 **경고**한다 — 그 지점 원장 알림 + 감사로그(0454a DB 트리거)
 * 🔴 그 과목의 **마지막 반**을 끝내는 과목 수강종료도 퇴원보고서로(원장 2026-10-26 *"그 과목의 마지막 반을 끝내는건 기존에 있던 것과
 *    일치하게"*) — 학생의 마지막 반(퇴원)과 같은 처리다. 판정 = 시간표 확인 문구의 `endScopeOf`(과목 범위) **+** 퇴원관리 목록의 '수강종료'
 *    판정(`getEndedSubjects`) 둘 다(`endsSubjectCourse`). 보고서에서 한 과목의 반만 고르면 처리 구분이 과목 수강종료(`subject_end`)다.
 * 장부 정리(관리 도구 '수강 없는 재원생' 일괄 퇴원)는 학생마다 **관리자 바로 처리 보고서**를 남기는 길로 옮겼다(보고서 없는 퇴원이 아니다).
 */
import { clipToWithdrawal, endScopeOf, type OtherSpan } from "@/features/attendance/enrollment-span";
import { addDays } from "@/lib/date-kst";
import { getEndedSubjects } from "./subject-ended";

/** 직원 화면의 직접 퇴원을 거절할 때. */
export const WITHDRAWAL_VIA_REPORT = "퇴원은 퇴원보고서로 처리합니다. 원생 화면의 '퇴원보고서'에서 진행해 주세요.";

/** 새 퇴원 예약(또는 예약 날짜 변경)을 거절할 때 — 미래 날짜 퇴원도 퇴원보고서가 그날 처리한다. */
export const SCHEDULE_VIA_REPORT =
  "퇴원 예약은 퇴원보고서로 겁니다. 원생 화면의 '퇴원보고서'에서 퇴원일을 정해 주세요. 걸려 있는 예약은 '퇴원 예약 취소'로 풀 수 있습니다.";

/** 마지막 수업을 끝내려는 사람이 가야 할 곳(원장 2026-11-02 — 수강종료만 하고 보고서를 안 쓰면 오해가 쌓인다). */
const LAST_COURSE_NEXT = "반이동이면 '반 이동' 메뉴로, 퇴원(수강종료)이면 원생 화면의 '퇴원보고서'를 작성해 주세요.";

/** 학생이 다니는 마지막 반을 끝내려 할 때(끝내면 다니는 반이 없다 = 사실상 퇴원). */
export const LAST_COURSE_VIA_REPORT = `이 학생이 다니는 마지막 수업이라 수강 종료할 수 없습니다. ${LAST_COURSE_NEXT}`;

/** 그 과목의 마지막 반을 끝내려 할 때(끝내면 그 과목 수강종료 — 퇴원관리 '수강종료'에 선다). */
export const SUBJECT_END_VIA_REPORT = `이 과목의 마지막 수업이라 수강 종료할 수 없습니다. ${LAST_COURSE_NEXT}`;

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
  /** 특강 반([`isSpecialLecture`](@/features/classes/special-lecture)) — 끝난 특강은 퇴원관리 '수강종료'로 세지 않는다. */
  isSpecial?: boolean;
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

/**
 * 수강 `target`(함께 끝내는 `endingIds` 포함)을 `date`로 끝낸 뒤 그 과목이 **퇴원관리 '수강종료'로 서는가** — 목록 조회와 같은 판정
 * ([`getEndedSubjects`](./subject-ended) · 끝난 특강은 빼고 그 과목 수강이 모두 끝남). 그 과목 수강이 다 끝나는 날의 다음 날로 본다
 * (같은 과목 반이 며칠 뒤 끝나도 그날 선다 — 그 반이 계속되는지는 `endScopeOf`가 14일 창으로 먼저 가린다).
 * 종료일이 없는 같은 과목 수강(아직 시작 전 포함)이 남으면 서지 않는다. 저장과 같게 미래 시작 수강의 종료일은 시작일로 당긴다.
 * ⚠️ 학원 퇴원일로 자르지 않는다 — 이 판정을 쓰는 게이트는 퇴원 예약이 없는 학생에게만 걸린다(`lastCourseGateApplies`).
 */
export function subjectEndCounts(rows: readonly EndRow[], target: EndRow, endingIds: ReadonlySet<string>, date: string): boolean {
  const subject = target.subject;
  if (subject == null) return false;
  const after = rows
    .filter((r) => r.subject === subject)
    .map((r) => (endingIds.has(r.id) ? { ...r, end: r.start > date ? r.start : date, isTransferred: false } : r));
  if (after.some((r) => r.end == null)) return false;
  const last = after.reduce((m, r) => (r.end! > m ? r.end! : m), date);
  const split = getEndedSubjects(
    after.map((r) => ({ subject, endDate: r.end, isTransferred: r.isTransferred, isSpecial: r.isSpecial })),
    addDays(last, 1),
  );
  return split.ended.includes(subject);
}

/**
 * 고른 수강을 끝내면 **그 과목의 마지막 반**이 끝나는가(= 과목 수강종료) — 하나라도 시간표 확인 문구가 '과목'이라 말하고(`endScopeOf` —
 * 반이동·같은 과목 다른 반 계속이 아니고 다른 과목 반은 계속) **퇴원관리가 '수강종료'로 세면**(`subjectEndCounts`) 참.
 * 원장 2026-10-26 *"그 과목의 마지막 반을 끝내는건 기존에 있던 것과 일치하게"* — 퇴원관리·시간표 X가 이미 수강종료로 세는 것만 막는다.
 */
export function endsSubjectCourse(
  rows: readonly EndRow[],
  targetIds: readonly string[],
  date: string,
  withdrawnAt: string | null,
): boolean {
  const ending = new Set(targetIds);
  return rows.some(
    (r) => ending.has(r.id) && endScopeFor(rows, r, ending, date, withdrawnAt).scope === "subject" && subjectEndCounts(rows, r, ending, date),
  );
}

/** 마지막 반 게이트의 거절 문구 — 학생의 마지막 반(퇴원)이 먼저, 그다음 그 과목의 마지막 반(과목 수강종료). 아니면 null. */
export function viaReportMessage(
  rows: readonly EndRow[],
  targetIds: readonly string[],
  date: string,
  withdrawnAt: string | null,
): string | null {
  if (endsLastCourse(rows, targetIds, date, withdrawnAt)) return LAST_COURSE_VIA_REPORT;
  if (endsSubjectCourse(rows, targetIds, date, withdrawnAt)) return SUBJECT_END_VIA_REPORT;
  return null;
}
