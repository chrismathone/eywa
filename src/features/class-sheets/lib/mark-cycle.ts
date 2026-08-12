/**
 * ECS 로스터 칸의 **클릭 순환**(체크) — 출결·태도가 공유하는 순수 규칙.
 *
 * 원장 2026-08-11: *"출결은 체크로 변경. 체크할때마다 출석 → 결석 → 지각 → 선택안함으로 반복 변경."*
 * + *"태도도 마찬가지."* (⚠️ *"일괄입력은 여전히 드랍다운"* — 한 번에 여러 명을 같은 값으로 맞추는
 * 일은 순환이 아니라 **고르는** 일이라, [SlotBulk](../components/slot-bulk.tsx)는 드롭다운 그대로 둔다.)
 *
 * 🔴 **순서를 여기서만 정한다.** 화면 컴포넌트가 각자 `if`로 다음 값을 만들면 출결·태도가 서로 다른
 *    규칙으로 갈라지고(그리고 한쪽만 고쳐진다), 무엇보다 "몇 번 누르면 원래대로 돌아오는가"를
 *    테스트로 잠글 수 없다.
 */

export type BasicAttendance = "present" | "late" | "absent";

/**
 * 출결 순환 — 원장이 말한 순서 그대로(출석 → 결석 → 지각 → 선택 안 함 → 다시 출석).
 * `null` = 선택 안 함(기록 없음)이라 **배열의 마지막**에 있다.
 */
export const ATTENDANCE_CYCLE: readonly (BasicAttendance | null)[] = ["present", "absent", "late", null];

/**
 * 다음 출결값. 순환에 없는 값(조퇴·공결·보강)은 **첫 값**으로 시작하지만, 화면은 그런 칸을 애초에
 * 읽기 전용으로 그려 이 함수까지 오지 않는다 — 출석부에서만 쓰는 상태를 여기서 덮으면 조용히 사라진다.
 */
export function nextAttendance(current: string | null): BasicAttendance | null {
  const i = ATTENDANCE_CYCLE.indexOf(current as BasicAttendance | null);
  return ATTENDANCE_CYCLE[(i + 1) % ATTENDANCE_CYCLE.length];
}

/**
 * 목록형 값(태도)의 다음 값 — 선택지를 차례로 돌고 마지막에 '선택 안 함'(null).
 * 선택지 밖 저장값(옛 표기 '완'·'최고' 등)은 **첫 선택지**로 시작한다. 그 값을 순환에 끼워 넣으면
 * 지울 수도 고를 수도 없는 유령 단계가 생긴다(옛 값은 화면이 그대로 보여 주되, 손대는 순간 새 눈금으로 옮긴다).
 */
export function nextCycleValue(current: string | null, options: readonly string[]): string | null {
  if (options.length === 0) return null;
  const cycle: (string | null)[] = [...options, null];
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length];
}
