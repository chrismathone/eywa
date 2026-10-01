/**
 * 편집 이력(되돌리기·다시 하기) — 순수 리듀서. 한 번의 조작(끌어 놓기 한 번·크기 변경 한 번·빼기 한 번)이 한 칸이다.
 * 같은 값으로 push하면 쌓지 않는다(끌다가 제자리에 놓은 경우).
 */
import { sameItems } from "./engine";
import type { Item } from "./types";

export type History = { past: Item[][]; present: Item[]; future: Item[][] };

export const HISTORY_LIMIT = 100;

export const startHistory = (present: Item[]): History => ({ past: [], present, future: [] });

export function pushHistory(h: History, next: Item[]): History {
  if (sameItems(h.present, next)) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undoHistory(h: History): History {
  const prev = h.past.at(-1);
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redoHistory(h: History): History {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: rest };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;
