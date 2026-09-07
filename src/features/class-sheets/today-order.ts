/**
 * ECS **오늘 면 반 순서** — 강사가 손으로 정한 개인 순서(원장 2026-09-05 *"선생님이 자신의 멋대로
 * 순서를 커스터마이징하고 싶다고 하는데, 개인별 커스터마이징 가능하게 드래그드랍으로 순서 바꿀 수 있게"*).
 *
 * 기본 순서는 **화면에 보이는 첫 교시**(`firstVisibleTodaySlot`, 2026-08-19)다. 그건 대부분의 날에 맞지만
 * "나는 이 반을 늘 먼저 본다" 같은 개인 습관은 표현하지 못한다 → 저장된 순서가 있으면 그게 이긴다.
 *
 * 🔴 **저장은 계정에**(`users.ui_prefs.ecs.todayOrder`) — 원장 2026-08-04 *"모든 뷰 세팅은 계정 귀속"*.
 *    localStorage는 포트 포함 origin 단위라 "로그인은 그대로인데 순서만 리셋"으로 위장한다([[#90]]).
 * 🔴 **저장 안 된 반은 사라지지 않는다** — 순위를 못 찾으면 맨 뒤로 보내되 **기본 순서(시각)를 그대로**
 *    유지한다. 새로 배정된 반이 목록에서 증발하면 그날 그 반을 통째로 놓친다.
 * ⚠️ 순서는 **반 id 한 줄**이라 날짜 축이 없다. 오늘 보이는 반만 끌어 정렬해도, 저장할 땐 오늘 안 보이는
 *    옛 저장분을 뒤에 붙여 **다른 날의 상대 순서를 지운다**(mergeTodayOrder). 즉 오늘 만진 반들끼리의
 *    순서는 앞으로도 유지되고, 오늘 안 보인 반들끼리의 순서도 유지된다. 두 무리가 다른 날 함께 뜨면
 *    오늘 만진 쪽이 앞에 선다 — 한 줄 순서로 표현할 수 있는 한계이고, 실제 습관("이 반 먼저")과 맞는다.
 */

/** 저장 상한 — 담당 반이 수십 개라도 남는 값이 무한정 자라지 않게. */
export const TODAY_ORDER_MAX = 200;

/** 저장 가능한 모양으로 — 문자열만, 중복 제거, 상한. 액션·리더가 **같은 정규화**를 쓴다. */
export function normalizeTodayOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const id = v.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= TODAY_ORDER_MAX) break;
  }
  return out;
}

/**
 * 기본 순서로 정렬된 목록에 **내 순서**를 얹는다.
 * 저장에 있는 반이 그 순서대로 앞에 서고, 없는 반은 **기본 순서 그대로** 뒤에 붙는다(안정 정렬).
 */
export function applyTodayOrder<T extends { classId: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...items];
  const rank = new Map(order.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i, r: rank.get(item.classId) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}

/**
 * 화면에서 끌어 만든 **오늘의 새 순서**를 저장값과 합친다.
 * 오늘 보인 반이 새 순서대로 앞에, 오늘 안 보인 옛 저장분이 그 뒤에(기존 상대 순서 유지).
 */
export function mergeTodayOrder(saved: readonly string[], visibleInNewOrder: readonly string[]): string[] {
  const visible = new Set(visibleInNewOrder);
  return normalizeTodayOrder([...visibleInNewOrder, ...saved.filter((id) => !visible.has(id))]);
}
