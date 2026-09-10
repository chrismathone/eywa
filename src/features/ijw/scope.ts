/**
 * JJ실 강사 스코프 — 순수 판정(Vitest로 잠금). 조회는 ijw/server/viewer.ts가, 판정은 여기가 한다.
 *
 * 🔴 **학생 범위**(누구 학생까지 보이나)와 **칩 노출**(JJ를 볼 사람인가)은 다른 판정이다(적대 재리뷰 2026-09-10).
 *    학생 범위는 학생 상세와 같은 세 갈래 전부 — 이력 교시까지 넣는다(명단엔 뜨는데 열면 404가 되지 않게).
 *    그런데 칩 노출까지 그걸로 했더니, 봄에 영어에서 수학으로 옮긴 강사가 **마감된 옛 영어 교시** 때문에 학원 전체
 *    영어 시험 집계를 계속 봤다([[#88]] — class_schedules는 이력을 함께 담는다). 그래서 칩은 **지금 도는** 영어 반만 센다:
 *    운영 중인 반 × (현재 담임 ∪ 오늘 유효한 교시 ∪ 임시 위임).
 */

export type JjClassScope = {
  own: readonly string[];
  slots: readonly { classId: string; validFrom: string | null; validTo: string | null }[];
  delegated: readonly string[];
};

/** 강사가 볼 수 있는 반 전부(세 갈래 합집합, 이력 교시 포함) — 학생 범위용. */
export function viewableClassIds(s: JjClassScope): string[] {
  return [...new Set([...s.own, ...s.slots.map((x) => x.classId), ...s.delegated])];
}

/** 이 교시 행이 오늘 유효한가 — 시작 전·마감 뒤 행은 아니다. 날짜(YYYY-MM-DD)만 비교한다. */
export function slotLiveOn(slot: { validFrom: string | null; validTo: string | null }, today: string): boolean {
  const from = slot.validFrom ? slot.validFrom.slice(0, 10) : null;
  const to = slot.validTo ? slot.validTo.slice(0, 10) : null;
  return (!from || from <= today) && (!to || to >= today);
}

/** 지금 영어 반을 맡고 있는가 — 운영 중인 영어 반 × (담임 ∪ 오늘 유효한 교시 ∪ 위임). */
export function hasLiveEnglishClass(
  s: JjClassScope,
  classes: readonly { id: string; subject: string | null; isActive: boolean }[],
  today: string,
): boolean {
  const live = new Set([
    ...s.own,
    ...s.delegated,
    ...s.slots.filter((x) => slotLiveOn(x, today)).map((x) => x.classId),
  ]);
  // ⚠️ `english`는 과목 표준 키(코드 특수동작 허용 범위).
  return classes.some((c) => c.isActive && c.subject === "english" && live.has(c.id));
}
