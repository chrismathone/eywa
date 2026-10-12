"use client";

import { useCallback, type KeyboardEvent } from "react";
import { removeItem, resizeItem } from "@/features/dashboard/layout/engine";
import { placeItem } from "@/features/dashboard/layout/fixed-grid";
import { isStructuralId, type Item, type Placed } from "@/features/dashboard/layout/types";

export function useBoardKeyboard({ items, canRemove, label, onCommit, onRemoved, onSelect, setAnnounce }: {
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
        if (!canRemove && !isStructuralId(id)) return setAnnounce("마지막 카드는 뺄 수 없습니다");
        const before = [...items];
        onCommit(removeItem(items, id));
        onRemoved(id, before);
        return;
      }
      if (ev.key === "Escape") return onSelect(null);
      if (!ev.key.startsWith("Arrow")) return;
      ev.preventDefault();
      const dx = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
      const dy = ev.key === "ArrowUp" ? -1 : ev.key === "ArrowDown" ? 1 : 0;
      if (ev.shiftKey) say(resizeItem(items, id, { w: item.w + dx, h: item.h + dy, mode: item.mode }), "크기 변경");
      else say(placeItem(items, item, (item.x ?? 0) + dx, (item.y ?? 0) + dy), "위치 변경");
    },
    [items, canRemove, label, onCommit, onRemoved, onSelect, setAnnounce],
  );

}
