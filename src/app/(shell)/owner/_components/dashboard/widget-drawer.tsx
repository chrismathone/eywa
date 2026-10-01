"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cardDef } from "@/features/dashboard/layout/registry";
import { WidgetThumb } from "./widget-thumb";
import e from "./editor.module.css";

function Chip({ id, ghosted, onAdd }: { id: string; ghosted: boolean; onAdd: (id: string) => void }) {
  const def = cardDef(id)!;
  const { setNodeRef, listeners, attributes } = useDraggable({ id: `chip:${id}`, data: { kind: "chip", id } });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="listitem"
      aria-roledescription="안 쓰는 위젯"
      aria-label={`${def.label} — 위로 끌어 올리면 넣습니다`}
      className={e.chip}
      data-ghosted={ghosted || undefined}
    >
      <WidgetThumb kind={def.thumb} />
      <span>{def.label}</span>
      <button
        type="button"
        className={e.chipAdd}
        aria-label={`${def.label} 넣기`}
        onPointerDown={(ev) => ev.stopPropagation()}
        onMouseDown={(ev) => ev.stopPropagation()}
        onTouchStart={(ev) => ev.stopPropagation()}
        onClick={() => onAdd(id)}
      >
        +
      </button>
    </div>
  );
}

/**
 * 아래 서랍 — 이 역할 배치에 **안 쓰는 카드**. 끌어 올리면 넣고(놓은 자리에), 위 카드를 여기로 끌어 내리면 빠진다(확인창 없이 즉시,
 * 되돌리기는 토스트·되돌리기 버튼). '+'는 맨 뒤에 넣는다. 갤러리('위젯 추가')는 같은 목록을 크게 보여 주는 곳이다.
 */
export function WidgetDrawer({ ids, draggingTile, activeChip, onAdd }: { ids: readonly string[]; draggingTile: boolean; activeChip: string | null; onAdd: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "drawer" });
  return (
    <section ref={setNodeRef} className={e.drawer} data-over={(draggingTile && isOver) || undefined} aria-label="안 쓰는 카드">
      <div className={e.drawerHead}>
        <b>안 쓰는 카드 {ids.length}</b>
        <span>{draggingTile ? "여기에 놓으면 이 역할 화면에서 뺍니다" : "위로 끌어 올리면 넣고, 위 카드를 여기로 끌어 내리면 뺍니다"}</span>
      </div>
      {ids.length ? (
        <div className={e.chips} role="list">
          {ids.map((id) => (
            <Chip key={id} id={id} ghosted={activeChip === id} onAdd={onAdd} />
          ))}
        </div>
      ) : (
        <p className={e.note}>모든 카드를 쓰고 있습니다.</p>
      )}
    </section>
  );
}
