/**
 * 305·JJ실 하루 표의 **반별 묶기** — 순수 모듈(Vitest).
 *
 * 이 표는 축이 반이 아니라 **자리 × 시각**이라, 같은 시각에 앉은 2~3개 반의 명단이 한 표로 합쳐진다
 * ([seat-day.ts](./seat-day.ts)). 그동안 줄 순서는 [roster-order](./roster-order.ts)의 가나다뿐이어서
 * `김근호 중1 MED / 류지훈 초6 SKY / 류혜정 중1 MED …`처럼 반이 뒤섞였다 —
 * 원장 지시(2026-09-10): *"영어강사시트 → JJ 뷰에서 반별로 정렬"*.
 *
 * 규칙 한 줄 = **섹션(재원·보강·퇴원·기록) → 반 → 그 섹션의 원래 순서**.
 *  · 섹션 구분은 `groupRosterRows`가 그대로 정한다(여기서 다시 나누지 않는다).
 *  · 반 안의 순서는 **호출부가 이미 정렬해 넘긴 순서**를 그대로 잇는다 — 이 정렬이 **안정 정렬**이라
 *    재원·보강·기록은 가나다, 퇴원은 최신 종료일 먼저가 반 안에서 그대로 살아 있다.
 *
 * 🔴 **정렬 키는 표시 문자열이 아니라 정본 반 이름(`className`)이다.** 강사뷰 영어 전환(`classNameFor`)은
 *    표기만 옮기는 표시 층이라, 표시 문자열로 정렬하면 같은 표가 언어에 따라 다른 순서로 선다.
 * 🔴 **반을 모르는 줄(빈 `className`)은 빼지 않고 맨 뒤로** 보낸다 — 사라지는 학생이 뒤섞인 학생보다 나쁘다.
 *
 * ⚠️ 순수 모듈 — server-only·클라 컴포넌트 어느 쪽도 import하지 않는다(구조적 타입만). [[#61]]
 */

/** 정렬이 보는 최소 모양 — 반 식별자와 정본 이름. */
export type SeatClassRef = {
  classId: string;
  /** 정본(DB) 반 이름. 표시용으로 줄인 이름(`shortClassLabel`)·번역본을 넣지 말 것. */
  className: string;
};

/**
 * 반 비교자 — 정본 이름 가나다(`localeCompare("ko")`) → 같은 이름이면 `classId`.
 * 이름이 비었으면(반 해석 실패) 뒤로 밀되, 둘 다 비었으면 **0을 돌려 원래 순서를 지킨다**.
 */
export function compareSeatClassRef(a: SeatClassRef, b: SeatClassRef): number {
  const an = (a.className ?? "").trim();
  const bn = (b.className ?? "").trim();
  if (!an || !bn) {
    if (an === bn) return 0; // 둘 다 미상 — 안정 정렬에 맡긴다
    return an ? -1 : 1; // 반을 모르는 줄이 맨 뒤
  }
  const byName = an.localeCompare(bn, "ko");
  if (byName !== 0) return byName;
  // 이름이 같아도 다른 반일 수 있다 — id로 붙여 놓아야 "같은 반끼리"가 참이 된다.
  return (a.classId ?? "").localeCompare(b.classId ?? "");
}

/**
 * 같은 반 학생을 붙여 세운다. **안정 정렬**이라 반 안의 기존 순서(가나다 등)는 그대로다.
 * `classOf`로 키를 뽑으므로 호출부의 행 모양(래핑된 엔트리 등)을 바꾸지 않는다.
 */
export function sortSeatRowsByClass<T>(rows: readonly T[], classOf: (row: T) => SeatClassRef): T[] {
  return [...rows].sort((a, b) => compareSeatClassRef(classOf(a), classOf(b)));
}
