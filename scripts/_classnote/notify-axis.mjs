// scripts/_classnote/notify-axis.mjs — "지금 그 반을 맡은 사람"·"지금 다니는 수강" 판정의 **워커용 사본**(순수, Vitest).
//
// 🔴 원본은 앱이다 — 워커(plain .mjs)는 src의 TS를 못 읽어 규칙을 여기 한 벌 더 든다.
//    · classTeachersNow   ← src/features/attendance/teacher-axis.ts `classTeacherIdsInRange`(from=to=오늘) + 위임(`isDelegationActiveOn`)
//    · enrollmentEndedOn  ← src/features/enrollments/eligibility.ts `isEnrollmentEndedOn`(반이동은 반열림, 일반 종료는 그날 포함 — [[#125]])
//    · SEAT_ALIAS_KEYS    ← src/features/timetable/lib/teacher-label.ts `SPECIAL_SLOT_ALIAS_KEYS`
//    패리티 테스트(tests/unit/classnote-notify-axis-parity.test.ts)가 두 벌을 같은 입력으로 대조한다 —
//    **앱 규칙을 바꾸면 여기도 같이** 바꿀 것(테스트가 빨개진다).
//
// `isCurrentEnrollment`는 앱 `isEnrollmentActiveOn`과 **휴원(on_hold)만** 다르다 — 그쪽은 출결 대상이라 휴원을 빼지만,
// 여기는 "그 학생의 지금 담당 선생님이 누구인가"라 휴원 중에도 담당은 그대로다(학부모가 복귀를 알리는 글이 담당에게 가야 한다).

/** 자리(LAB·JJ) 라벨 별칭(소문자) — 자리는 사람이 아니라 방이다. */
export const SEAT_ALIAS_KEYS = ["lab", "lab실", "이주희", "랩실", "jj", "집중자율수업실", "자율실"];
const SEAT = new Set(SEAT_ALIAS_KEYS);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function overlaps(slot, from, to) {
  if (slot.validFrom > to) return false;
  return slot.validTo == null || slot.validTo >= from;
}

function isSeat(slot) {
  if (slot.teacherId != null || slot.slotTeacherLabel == null) return false;
  return SEAT.has(String(slot.slotTeacherLabel).trim().toLowerCase());
}

/**
 * 지금(오늘) 그 반을 맡은 사람들 — 담임 ∪ 오늘 유효한 교시 담당(부담임) ∪ 오늘 유효한 임시 위임.
 * @param {{homeroomTeacherId:string|null, slots:Array, delegations?:Array, today:string}} input
 */
export function classTeachersNow({ homeroomTeacherId, slots, delegations = [], today }) {
  const out = new Set();
  if (homeroomTeacherId) out.add(homeroomTeacherId);
  for (const s of slots ?? []) if (s.teacherId && !isSeat(s) && overlaps(s, today, today)) out.add(s.teacherId);
  for (const d of delegations) {
    if (d.revokedAt || !YMD.test(d.fromDate ?? "") || !YMD.test(d.toDate ?? "") || !YMD.test(today)) continue;
    if (d.fromDate <= today && today <= d.toDate && d.delegateUserId) out.add(d.delegateUserId);
  }
  return [...out];
}

/** 기준일에 수강 종료가 이미 지났나 — 앱 `isEnrollmentEndedOn` 사본(반이동 `end <= date`, 일반 종료 `end < date`). */
export function enrollmentEndedOn(endDate, date, isTransferred) {
  if (!endDate) return false;
  return isTransferred ? endDate <= date : endDate < date;
}

/**
 * 오늘 다니는 수강인가 = 시작일 ≤ 오늘 이고 아직 안 끝났다(반이동 당일은 새 반만 — 옛 반은 반열림으로 이미 끝).
 * 🔴 `end_date is null`만 보면 ① 미래 시작 수강이 들어오고 ② 퇴원 예약(미래 종료일)이 빠진다(2026-09-30 원장 정정 때 바로잡음).
 * 날짜가 깨졌으면 다니지 않는 것으로 본다(모르면 보내지 않는다).
 */
export function isCurrentEnrollment({ startDate, endDate, isTransferred }, today) {
  if (!YMD.test(String(today ?? "")) || !YMD.test(String(startDate ?? ""))) return false;
  if (startDate > today) return false;
  if (endDate != null && !YMD.test(String(endDate))) return false;
  return !enrollmentEndedOn(endDate ?? null, today, isTransferred === true);
}
