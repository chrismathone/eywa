/**
 * 당일 출결 보드의 **강사 줄 묶음 축** — 순수 함수(Vitest). 조회는 `server/queries.ts`가 한다.
 *
 * 원장 지시 2026-08-20: *"담당미지정으로 나오게하지말고, lAB이면 lAB, JJ면 JJ"* — 어제 출결 요약의
 * "입력이 덜 된" 줄이 `담당 미지정 108칸 중 58칸 · 미입력 8반`으로 뭉쳐 나왔는데, 실제로는 그날 무담당
 * 슬롯 18개가 **전부 랩실·JJ실 자리 교시**였다(실측 2026-08-19: LAB 8 · JJ 10, 전부 영어).
 * 이 줄이 답해야 할 질문은 "누구에게 말하나"인데 `담당 미지정`은 아무 것도 답하지 못한다.
 *
 * 🔑 자리(LAB·JJ)는 `teacher_id`가 구조적으로 null이다(`teacher-axis.ts`가 담임 폴백을 금지한다 —
 *    자리 수업을 담임 시수로 잡으면 급여가 어긋난다). 그래서 **묶는 키만** 자리 이름으로 갈라 세고,
 *    귀속 축(`taughtByForSlot`)은 손대지 않는다. 바뀌는 건 표시·집계 그룹뿐이다.
 * 🔴 **자리 이름을 `teacherId`에 넣지 말 것.** 그러면 로그인도 못 하는 "가짜 강사"가 알림 수신자·
 *    직원 목록·급여로 따라 붙는다(2026-07-23 발송실패 알림이 `JJ` 계정으로 배달돼 아무도 못 본 사고 —
 *    [teacher-label.ts](../../timetable/lib/teacher-label.ts) 상단 🔴). 그래서 신원은
 *    `{ teacherId, seatLabel }` 두 칸으로 들고 다니고, 키는 **문자열로만** 쓴다.
 * 🔴 LAB과 JJ는 **서로 다른 방이라 절대 한 줄로 합치지 않는다**(같은 시각에 동시에 돌아간다).
 * ⚠️ 자리 판정은 raw 라벨이 아니라 `specialSlotLabel`(별칭 흡수·멱등)로 한다 — 옛 별칭(`이주희`·`랩실`)이
 *    들어오면 raw 문자열 키는 같은 방을 두 줄로 쪼갠다.
 */
import { specialSlotLabel, type SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";

/** 담당도 담임도 없고 자리도 아닌 슬롯의 줄 이름(수학 담임 공석 반이 여기로 온다). */
export const UNASSIGNED_TEACHER_NAME = "담당 미지정";
/** 계정은 있는데 표시 이름이 비어 있는 경우 — 사람이 사라지면 안 된다. */
export const NAMELESS_TEACHER_NAME = "이름 없음";

/** 묶기에 필요한 슬롯의 최소 모양(보드 타입에 묶지 않는다). */
export type TeacherGroupSlot = {
  /** 귀속된 사람(`taughtByForSlot`). 자리는 항상 null. */
  teacherId: string | null;
  /** 슬롯에 적힌 담당 표기 — 자리(`LAB`·`JJ`·별칭)이거나 시트 닉네임이거나 null. */
  slotTeacherLabel: string | null;
};

/**
 * 그 줄이 **누구/무엇인가**. 사람이면 `teacherId`, 방이면 `seatLabel`, 둘 다 없으면 담당 미지정.
 * 🔴 두 칸이 동시에 차지 않는다 — 소비처가 "사람이 아니라 방"임을 문자열 비교 없이 알 수 있게.
 */
export type TeacherGroupIdentity = {
  teacherId: string | null;
  seatLabel: SpecialSlotLabel | null;
};

/**
 * 사람이 먼저다 — 담당이 붙은 슬롯은 라벨이 닉네임이든 뭐든 **그 사람 줄**이다(닉네임으로 쪼개지 않는다.
 * 실측 2026-08-19: 살아 있는 슬롯 194개가 `teacher_id` + 시트 닉네임을 함께 들고 있다).
 */
export function groupIdentityOf(slot: TeacherGroupSlot): TeacherGroupIdentity {
  if (slot.teacherId) return { teacherId: slot.teacherId, seatLabel: null };
  return { teacherId: null, seatLabel: specialSlotLabel(slot.slotTeacherLabel) };
}

/**
 * 묶음 키(문자열). uuid ↔ `LAB`·`JJ` ↔ `""`는 서로 겹칠 수 없어 한 Map에 같이 태워도 안전하다.
 * ⚠️ 이 값은 **키일 뿐** — 그대로 `teacherId`로 내보내지 말 것(위 🔴).
 */
export function identityKey(identity: TeacherGroupIdentity): string {
  return identity.teacherId ?? identity.seatLabel ?? "";
}

export function groupKeyOf(slot: TeacherGroupSlot): string {
  return identityKey(groupIdentityOf(slot));
}

/**
 * 줄 이름 — 사람이면 계정 표시 이름, 방이면 자리 이름(`LAB`·`JJ`), 그 외 `담당 미지정`.
 * @param personName 사람일 때만 쓴다(자리·미지정은 조회 자체를 안 한다).
 */
export function groupDisplayName(
  identity: TeacherGroupIdentity,
  personName?: string | null,
): string {
  if (identity.teacherId) return personName?.trim() || NAMELESS_TEACHER_NAME;
  return identity.seatLabel ?? UNASSIGNED_TEACHER_NAME;
}

/** 보드가 내보내는 줄 머리(슬롯·수치는 호출부가 붙인다). */
export type TeacherGroupHeader = {
  teacherId: string | null;
  seatLabel: SpecialSlotLabel | null;
  teacherName: string;
  teacherPhone: string | null;
};

/**
 * 줄 머리 조립 — **id·연락처가 사람에게만 붙는다는 성질을 여기서 잠근다**(호출부가 각자 삼항연산자로
 * 쓰면 한 곳만 고쳐지고 자리에 전화번호가 붙는다). 자리·미지정은 `person`을 넘겨도 무시한다.
 */
export function groupHeaderOf(
  identity: TeacherGroupIdentity,
  person?: { name?: string | null; phone?: string | null } | null,
): TeacherGroupHeader {
  const isPerson = identity.teacherId != null;
  return {
    teacherId: identity.teacherId,
    seatLabel: identity.seatLabel,
    teacherName: groupDisplayName(identity, isPerson ? person?.name : null),
    teacherPhone: isPerson ? (person?.phone ?? null) : null,
  };
}
