"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, MeasuringStrategy, getClientRect } from "@dnd-kit/core";
import { removeItem } from "@/features/dashboard/layout/engine";
import { cardDef } from "@/features/dashboard/layout/registry";
import { isHeadingId, isSpaceId, isStructuralId, type Item } from "@/features/dashboard/layout/types";
import { Button } from "@/components/ui/button";
import { ACCESSIBILITY, CanvasDrop, Trash } from "./board-drop-targets";
import { captureCard, CardDragPreview } from "./card-drag-preview";
import { useBoardKeyboard } from "./use-board-keyboard";
import { CanvasTile } from "./canvas-tile";
import type { BoardLayout } from "./geometry";
import { boardCollision, useBoardDrag } from "./use-board-drag";
import { useLiveLayout } from "./use-live-layout";
import { useResize } from "./use-resize";
import { WidgetDrawer } from "./widget-drawer";
import { WidgetThumb } from "./widget-thumb";
import e from "./editor.module.css";
import live from "./live-editor.module.css";

/** 실제 운영실을 그대로 그리고, 측정한 카드 위에 편집 도구만 겹친다. */
export function EditBoard({ items, unused, onAddRow, selected, onSelect, onCommit, onRemoved, onAdd, renderPreview }: {
  items: Item[];
  unused: string[];
  onAddRow: () => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (next: Item[]) => void;
  onRemoved: (id: string, before: Item[]) => void;
  onAdd: (id: string) => void;
  renderPreview: (items: Item[]) => ReactNode;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<BoardLayout | null>(null);
  const [announce, setAnnounce] = useState("");
  const [dragHtml, setDragHtml] = useState("");
  const label = useCallback((id: string) => items.find((i) => i.id === id)?.title ?? cardDef(id)?.label ?? (isSpaceId(id) ? "빈 행 · 여기에 카드를 놓으세요" : "구역 제목"), [items]);
  const { drag, preview: dragPreview, sensors, canRemove, handlers } = useBoardDrag({ items, canvasRef, layoutRef, onCommit, onRemoved });
  const { resize, preview: resizePreview, start: startResize } = useResize({ items, layoutRef, onCommit });
  const shown = dragPreview ?? resizePreview ?? items;
  const cards = useLiveLayout(canvasRef, shown, layoutRef);
  const placed = useMemo(() => cards.map(({ id, rect: r }) => ({ id, x: r.left, y: r.top, w: r.width, h: r.height })), [cards]);
  const onKey = useBoardKeyboard({ items, placed, canRemove, label, onCommit, onRemoved, onSelect, setAnnounce });
  const hidden = items.filter((it) => !isStructuralId(it.id) && !cards.some((c) => c.id === it.id));

  useLayoutEffect(() => {
    if (!drag) return;
    const el = canvasRef.current?.querySelector<HTMLElement>(`[data-live-preview] [data-dashboard-card="${CSS.escape(drag.id)}"]`);
    if (!el) return;
    el.style.opacity = "0.25";
    return () => { el.style.opacity = ""; };
  }, [drag]);

  return (
    <DndContext sensors={sensors} collisionDetection={boardCollision}
      measuring={{ draggable: { measure: getClientRect }, droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={ACCESSIBILITY} {...handlers}
      onDragStart={(ev) => {
        const id = (ev.active.data.current as { id?: string } | undefined)?.id;
        setDragHtml(id ? captureCard(canvasRef.current, id) : "");
        handlers.onDragStart(ev);
      }}
    >
      <div className={live.surface}>
        <CanvasDrop over={drag?.target === "canvas"} onBackground={() => onSelect(null)}>
          <div ref={canvasRef} className={live.canvas} onClick={(ev) => ev.target === ev.currentTarget && onSelect(null)}>
            <div data-live-preview inert>{renderPreview(shown)}</div>
            {cards.map(({ id, rect }) => {
              const heading = isStructuralId(id);
              return <CanvasTile key={id} id={id} label={label(id)} rect={rect} heading={heading}
                selected={selected === id} ghosted={drag?.id === id} sizeLabel={resize?.id === id ? resize.z.label : null}
                canRemove={heading || canRemove} canResize={!isSpaceId(id)}
                onSelect={onSelect} onKey={onKey} onResizeStart={startResize}
                onRemove={(key) => { onCommit(removeItem(items, key)); onRemoved(key, [...items]); }}
              >{isSpaceId(id) ? <span className="text-muted-foreground flex h-full items-center justify-center rounded-lg border border-dashed text-sm">빈 행 · 여기에 카드를 놓으세요</span> : null}</CanvasTile>;
            })}
          </div>
          <div className={e.srLive} aria-live="polite">{announce}</div>
        </CanvasDrop>
      </div>
      <Button type="button" variant="outline" onClick={onAddRow}>+ 하단에 행 추가</Button>
      {hidden.length ? <details className={live.hiddenCards}>
        <summary>현재 화면에 표시되지 않는 카드 {hidden.length}개</summary>
        <p>권한이나 데이터에 따라 표시됩니다. 배치에는 보관되어 있습니다.</p>
        <div>{hidden.map((it) => <button key={it.id} type="button" onClick={() => onSelect(it.id)}>{label(it.id)} 설정</button>)}</div>
      </details> : null}
      <WidgetDrawer ids={unused} draggingTile={drag?.kind === "tile"} activeChip={drag?.kind === "chip" ? drag.id : null} onAdd={onAdd} />
      {typeof document !== "undefined" ? createPortal(<>
        <DragOverlay dropAnimation={null} zIndex={70}>
          {drag?.kind === "tile" ? <div className={e.lifted} data-blocked={drag.target === null || undefined}>
            <CardDragPreview html={dragHtml} width={drag.size.width} height={drag.size.height} />
          </div> : drag ? <div className={`${e.chip} ${e.liftedChip}`}><WidgetThumb kind={cardDef(drag.id)?.thumb ?? "number"} /><span>{label(drag.id)}</span></div> : null}
        </DragOverlay>
        {drag?.kind === "tile" ? <Trash over={drag.target === "trash"} blocked={!canRemove && !isHeadingId(drag.id)} /> : null}
      </>, document.body) : null}
    </DndContext>
  );
}
