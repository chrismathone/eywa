/**
 * **같은 반 · 같은 교재 배정 여러 개** — 순수(Vitest).
 *
 * 원장 2026-10-21: *"동일한 선생님이 동일한 교재로 최대3개까지 넣을수있어야함 그때 동일한 교재를 넣을경우 각 차시가
 * 각각 돌도록"*. 배정마다 차수가 1부터(또는 고른 시작 차수부터) **따로** 돈다.
 *
 * 🔑 규칙 셋
 *   ① 같은 반 같은 교재는 **3개까지**(`MAX_SAME_BOOK_PLANS`).
 *   ② 같은 교재 배정끼리 **교시(요일·시각)가 겹치지 않는다** — 한 교시에 같은 교재 줄이 둘이면 어느 배정의 줄인지
 *      가를 수 없다(줄엔 교재 이름만 있다). 그래서 한 칸의 그 교재 줄은 언제나 배정 하나의 것이다.
 *   ③ 새로 거는 교시가 **기존 배정 하나와 겹치면 그 배정을 갈아 끼운다** — 종전 흐름("교시만 바꿔 다시 건다")
 *      그대로다. 둘 이상과 겹치면 어느 쪽을 바꿀지 모르니 거절한다.
 * 🔑 줄 미룸·당김 표식의 `lane`은 **배정 id**다(`planLane`) — 교재 id면 같은 교재 배정 둘이 서로를 민다.
 */
import { picksCover } from "./plan-delete";
import { parseSlotPick } from "./lesson-schedule";

export const MAX_SAME_BOOK_PLANS = 3;

/** 줄 표식(0382a `lane`)의 키 — 배정 id. id 없는 행(테스트·옛 호출)은 교재 id로 떨어진다. */
export function planLane(p: { id?: string | null; textbook_id: string }): string {
  return String(p.id || p.textbook_id).toLowerCase();
}

/** 두 배정의 교시가 겹치나 — 요일·시각 기준(자리 `|1·2`는 안 본다). `null` = 옛 축 방식 = 그 반 모든 교시. */
export function picksOverlap(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null || a.length === 0 || b.length === 0) return true;
  const pa = a.map(parseSlotPick).filter((p) => p !== null);
  const pb = b.map(parseSlotPick).filter((p) => p !== null);
  return pa.some((x) => pb.some((y) => x.start === y.start && (x.dow === null || y.dow === null || x.dow === y.dow)));
}

export type SameBookPlan = { id: string; slotPicks: readonly string[] | null };

export type SameBookPlacement =
  | { kind: "insert" }
  | { kind: "update"; id: string }
  | { kind: "error"; error: string };

export const SAME_BOOK_FULL = `같은 교재는 한 반에 ${MAX_SAME_BOOK_PLANS}개까지 배정할 수 있습니다 — 기존 배정을 지운 뒤 다시 걸어 주세요`;
export const SAME_BOOK_OVERLAP_MANY =
  "고른 교시가 같은 교재의 다른 배정 여러 개와 겹칩니다 — 겹치는 배정을 먼저 지우거나 교시를 다시 골라 주세요";
export const SAME_BOOK_OVERLAP = "고른 교시가 같은 교재의 다른 배정과 겹칩니다 — 교시를 다시 골라 주세요";

/**
 * 새 배정(또는 `selfId` 배정의 수정)을 어디에 쓸지.
 * @param siblings 그 반의 **같은 교재** 배정들(활성, 자기 자신 포함 가능 — `selfId`로 뺀다).
 */
export function placeSameBookPlan(input: {
  picks: readonly string[] | null;
  siblings: readonly SameBookPlan[];
  /** 고치는 배정 id — 있으면 갈아 끼우기 없이 그 배정만 고친다(다른 배정과 겹치면 거절). */
  selfId?: string | null;
}): SameBookPlacement {
  const others = input.siblings.filter((s) => s.id !== input.selfId);
  const overlapping = others.filter((s) => picksOverlap(input.picks, s.slotPicks));
  if (input.selfId) {
    return overlapping.length > 0 ? { kind: "error", error: SAME_BOOK_OVERLAP } : { kind: "update", id: input.selfId };
  }
  if (overlapping.length === 1) return { kind: "update", id: overlapping[0]!.id };
  if (overlapping.length > 1) return { kind: "error", error: SAME_BOOK_OVERLAP_MANY };
  if (others.length >= MAX_SAME_BOOK_PLANS) return { kind: "error", error: SAME_BOOK_FULL };
  return { kind: "insert" };
}

/**
 * 이 줄(날짜·교시)이 그 배정의 것인가 — 같은 교재 배정이 **하나뿐이면** 그 교재 줄은 전부 그 배정 것이다(종전 그대로,
 * 고른 교시 밖에 손으로 옮긴 줄도). 형제가 있으면 고른 교시로 가른다(규칙 ② — 겹치지 않으니 주인은 하나다).
 */
export function ownsCell(
  plan: { slotPicks: readonly string[] | null },
  hasSiblings: boolean,
  date: string,
  slot: string,
): boolean {
  return !hasSiblings || picksCover(plan.slotPicks, date, slot);
}
