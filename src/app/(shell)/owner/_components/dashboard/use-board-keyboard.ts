"use client";

import { useCallback, type KeyboardEvent } from "react";
import { moveTo, removeItem, resizeItem } from "@/features/dashboard/layout/engine";
import { cardDef, presetOf } from "@/features/dashboard/layout/registry";
import { isHeadingId, type Item, type Placed } from "@/features/dashboard/layout/types";
import { verticalNeighbor } from "./geometry";

export function useBoardKeyboard({ items, placed, canRemove, label, onCommit, onRemoved, onSelect, setAnnounce }: {
  items: Item[]; placed: Placed[]; canRemove: boolean; label: (id: string) => string;
  onCommit: (items: Item[]) => void; onRemoved: (id: string, before: Item[]) => void;
  onSelect: (id: string | null) => void; setAnnounce: (message: string) => void;
}) {
  return useCallback(
    (id: string, ev: KeyboardEvent<HTMLDivElement>) => {
      const idx = items.findIndex((i) => i.id === id);
      const item = items[idx];
      if (!item) return;
      const say = (next: Item[], what: string) => {
        onCommit(next);
        setAnnounce(`${label(id)} ${what}`);
      };
      if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        if (!canRemove && !isHeadingId(id)) return setAnnounce("마지막 카드는 뺄 수 없습니다");
        const before = [...items];
        onCommit(removeItem(items, id));
        onRemoved(id, before);
        return;
      }
      if (ev.key === "Escape") return onSelect(null);
      if (!ev.key.startsWith("Arrow")) return;
      ev.preventDefault();
      const def = cardDef(id);
      if (ev.shiftKey && def && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
        const at = def.sizes.findIndex((z) => z.key === presetOf(def, item)?.key);
        const z = def.sizes[Math.max(0, Math.min(def.sizes.length - 1, at + (ev.key === "ArrowRight" ? 1 : -1)))];
        if (z) say(resizeItem(items, id, z), `크기 ${z.label}`);
        return;
      }
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
        const to = Math.max(0, Math.min(items.length - 1, idx + (ev.key === "ArrowRight" ? 1 : -1)));
        if (to !== idx) say(moveTo(items, id, to), `${to + 1}번째 자리로`);
        return;
      }
      const neighbor = verticalNeighbor(placed, id, ev.key === "ArrowUp" ? -1 : 1);
      if (!neighbor) return;
      const rest = items.filter((i) => i.id !== id);
      const at = rest.findIndex((i) => i.id === neighbor) + (ev.key === "ArrowDown" ? 1 : 0);
      say(moveTo(items, id, at), ev.key === "ArrowUp" ? "윗줄로" : "아랫줄로");
    },
    [items, placed, canRemove, label, onCommit, onRemoved, onSelect, setAnnounce],
  );

}
