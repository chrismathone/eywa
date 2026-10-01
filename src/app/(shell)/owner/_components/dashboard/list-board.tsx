"use client";

import { Button } from "@/components/ui/button";
import type { MenuKey } from "@/lib/permissions";
import { moveTo, placedIds, removeItem } from "@/features/dashboard/layout/engine";
import { cardDef, presetOf } from "@/features/dashboard/layout/registry";
import { isHeadingId, type Bundle, type Item } from "@/features/dashboard/layout/types";
import { badgesFor, exposureOf } from "./badges";
import e from "./editor.module.css";

/**
 * 좁은 화면(폰·작은 창)의 편집 — 24열 캔버스는 손가락으로 끌기엔 칸이 너무 작다. 같은 배치를 **한 줄 목록**으로:
 * ▲▼ 순서 · 누르면 아래 설정 칸(크기·제목·옵션) · − 빼기. 끌어서 옮기기는 넓은 화면에서.
 */
export function ListBoard({
  items,
  role,
  menus,
  selected,
  onSelect,
  onCommit,
  onRemoved,
}: {
  items: Item[];
  role: Bundle;
  menus: ReadonlySet<MenuKey>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (next: Item[]) => void;
  onRemoved: (id: string, before: Item[]) => void;
}) {
  const canRemove = placedIds(items).length > 1;
  const exposure = exposureOf(items, role, menus);
  return (
    <ol className="flex flex-col gap-2" aria-label="운영실 카드 순서">
      {items.map((it, idx) => {
        const def = cardDef(it.id);
        const heading = isHeadingId(it.id);
        const name = it.title ?? def?.label ?? "구역 제목";
        const size = def ? (presetOf(def, it)?.label ?? "") : "구역";
        const badges = badgesFor(it, role, menus, exposure);
        return (
          <li key={it.id} className={e.listRow} data-selected={selected === it.id || undefined} style={selected === it.id ? { boxShadow: "0 0 0 2px var(--primary)" } : undefined}>
            <span>
              <button type="button" className="w-full truncate text-left" onClick={() => onSelect(selected === it.id ? null : it.id)} aria-expanded={selected === it.id}>
                {heading ? `— ${name} —` : name}
              </button>
            </span>
            <small className="shrink-0">{size}</small>
            {badges[0] ? (
              <small className={e.badge} data-tone={badges[0].tone}>
                {badges[0].text}
              </small>
            ) : null}
            <Button size="icon-sm" variant="ghost" aria-label={`${name} 앞으로`} disabled={idx === 0} onClick={() => onCommit(moveTo(items, it.id, idx - 1))}>
              ▲
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`${name} 뒤로`} disabled={idx === items.length - 1} onClick={() => onCommit(moveTo(items, it.id, idx + 1))}>
              ▼
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${name} 빼기`}
              disabled={!heading && !canRemove}
              onClick={() => {
                const before = [...items];
                onCommit(removeItem(items, it.id));
                onRemoved(it.id, before);
              }}
            >
              −
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

/** 좁은 화면의 '안 쓰는 카드' — 끌기 대신 '+'로 맨 뒤에 넣는다. */
export function UnusedList({ ids, onAdd }: { ids: readonly string[]; onAdd: (id: string) => void }) {
  if (!ids.length) return <p className={e.note}>모든 카드를 쓰고 있습니다.</p>;
  return (
    <section className={e.drawer} aria-label="안 쓰는 카드">
      <div className={e.drawerHead}>
        <b>안 쓰는 카드 {ids.length}</b>
        <span>‘+’를 누르면 맨 뒤에 넣습니다</span>
      </div>
      <div className={e.chips} role="list">
        {ids.map((id) => (
          <div key={id} role="listitem" className={e.chip}>
            <span>{cardDef(id)?.label}</span>
            <button type="button" className={e.chipAdd} aria-label={`${cardDef(id)?.label ?? "카드"} 넣기`} onClick={() => onAdd(id)}>
              +
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
