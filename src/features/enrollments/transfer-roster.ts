import { enrollmentPhaseOn, isEnrollmentOnRosterOn } from "./eligibility";
import { isTransferDate, transferBlockReason, type TransferCandidate } from "./bulk-transfer";

/**
 * 반 상세 '학생 배정' 창의 **반이동 = 반 먼저, 학생은 그다음**(원장 2026-10-01 *"반이동시에 학생이름을 먼저
 * 고르지 않고 반을 골라서 할 수 있게 먼저 하는게 나을듯. 순서상으로도."*)의 순수 규칙.
 *
 * 🔴 명단 판정을 여기서 새로 만들지 않는다 — "그날 그 반 명단에 있나"는 `isEnrollmentOnRosterOn`
 *    (반 상세 명단과 같은 축, [[#125]] 반열림 규약 포함), "옮길 수 있나"는 단체 반 이동과 같은
 *    `transferBlockReason`을 그대로 쓴다. 둘이 갈리면 반 상세에 있는 학생이 여기선 안 보인다.
 */

/** 옮겨 올 반(출발지) 후보 한 줄. */
export type TransferSourceClass = {
  id: string;
  className: string;
  subject: string;
  teacherName: string | null;
};

/**
 * 출발 반 목록 — **목적지 반은 빼고**, 같은 과목 반을 먼저, 그다음 다른 과목 반(각각 이름순).
 * 반이동 저장(`moveEnrollmentsBatch`)은 과목을 가리지 않으므로 다른 과목 반도 남겨 둔다(종전 규칙 그대로).
 */
export function orderTransferSourceClasses(
  classes: TransferSourceClass[],
  targetClassId: string,
  targetSubject: string,
): TransferSourceClass[] {
  const byName = (a: TransferSourceClass, b: TransferSourceClass) =>
    a.className.localeCompare(b.className, "ko", { numeric: true }) || a.id.localeCompare(b.id);
  const rest = classes.filter((c) => c.id !== targetClassId);
  return [
    ...rest.filter((c) => c.subject === targetSubject).sort(byName),
    ...rest.filter((c) => c.subject !== targetSubject).sort(byName),
  ];
}

export type TransferRosterChoices = {
  /** 고를 수 있는 학생(수강 한 줄 = 학생 한 명). */
  choices: TransferCandidate[];
  /** 그날 명단엔 있지만 이미 반이동이 처리·예약된 수강 수. */
  reserved: number;
  /** 옮길 수는 있지만 이 반에 배정할 수 없는 학생 수(이미 이 반 수강 중 · 재원이 아님 — 배정 후보 밖). */
  unassignable: number;
  /** 이동일 **뒤에** 시작하는 수강 수 — 반 상세엔 '예정'으로 보이니 말없이 빼지 않고 센다. */
  upcoming: number;
};

/**
 * 고른 반의 **반이동 날짜 기준 명단**에서 고를 수 있는 학생.
 * - 명단 = `isEnrollmentOnRosterOn(수강, 이동일)` — 날짜를 바꾸면 다시 계산된다(그날 시작 전·이미 끝난 수강은 빠진다).
 * - 옮길 수 있나 = `transferBlockReason`이 없을 것(이미 반이동이 걸린 수강은 다시 옮기지 않는다).
 * - 배정 후보 = 화면이 받은 배정 후보 학생(`allowedStudentIds`) — **이미 이 반에 있는 학생은 종전대로 막는다**.
 */
export function transferRosterChoices(
  items: TransferCandidate[],
  date: string,
  allowedStudentIds: ReadonlySet<string>,
): TransferRosterChoices {
  if (!isTransferDate(date)) return { choices: [], reserved: 0, unassignable: 0, upcoming: 0 };
  const onRoster = items.filter((c) => isEnrollmentOnRosterOn(c.snapshot, date));
  const movable = onRoster.filter((c) => !transferBlockReason(c.snapshot, date));
  const choices = movable.filter((c) => allowedStudentIds.has(c.snapshot.studentId));
  return {
    choices,
    reserved: onRoster.length - movable.length,
    unassignable: movable.length - choices.length,
    upcoming: items.filter((c) => enrollmentPhaseOn(c.snapshot, date) === "upcoming").length,
  };
}
