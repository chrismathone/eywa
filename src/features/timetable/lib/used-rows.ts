/**
 * 수업이 없는 교시 행을 **통째로 뺀다** — 시간표 **통합뷰**의 섹션 교시축(`class-grid.ts` `groupRichCards`)과
 * 학생 수업 탭의 주간 격자(`students/lib/week-grid.ts`, 기본 뷰가 통합뷰인 과목 = 영어)가 **같은 함수**를 쓴다.
 * 원래 class-grid 안에 있던 것을 그대로 꺼냈다(2026-09-11) — 학생 탭이 영어 교시표 15줄을 전부 그려서
 * 원장이 *"왜 영어 학생들의 수업탭의 시간표 표시는 실제 영어 시간표와 다른것 같지?"*라고 물었다.
 *
 * 원장 2026-08-11 *"수업없는 교시행도 숨겨버려"*.
 * 🔴 뒤집힌 규약 두 가지 — 되돌리기 전에 여기를 읽을 것:
 *  · 2026-07-06 "5칸 윈도우의 위·아래 패딩은 컨텍스트라 유지" → **폐기**(끝단 빈 행도 뺀다).
 *  · 2026-07-27 "중간 빈 구간은 물결(〜〜〜) 한 줄로 접는다" → **폐기**(접는 게 아니라 없앤다).
 *    행 라벨에 "1교시·8교시"처럼 교시 번호(이름을 비운 교시는 시간대)가 그대로 남아서, 사이가 비었다는
 *    사실은 라벨로 읽힌다.
 *
 * ⚠️ **전부 비면 원본을 돌려준다** — 격자가 0행이면 "반이 깨진 것"으로 보인다(방어적으로 윈도우를 남긴다).
 * ⚠️ `order`는 **행마다 달라야** 한다 — 시작이 같은 두 교시(EiE 16:20~17:00 / 인재원 16:20~17:20)가 같은 order면
 *    한쪽만 써도 둘 다 남는다. 교시축 order는 `periods.ts` `periodAxisOrder`처럼 같은 시작끼리 소수부로 가른다.
 * ⚠️ 순수·plain만 — 클라(rich-card-group·학생 탭 격자)도 import한다(`server-only` 금지, [[#61]]).
 */
export function keepUsedRows<T extends { order: number }>(
  rows: readonly T[],
  usedOrders: ReadonlySet<number>,
): T[] {
  const kept = rows.filter((r) => usedOrders.has(r.order));
  return kept.length > 0 ? kept : [...rows];
}
