"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
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
import { boundaryNear, emptyBandAt, insertGridRows, removeGridRows } from "@/features/dashboard/layout/grid-rows";
import { RowContextMenu, type RowMenuState } from "./row-context-menu";
import { RowGuides, useRowGeometry } from "./row-guides";
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
  const { resize, preview: resizePreview, start: startResize } = useResize({ items, canvasRef, layoutRef, onCommit });
  const shown = dragPreview ?? resizePreview ?? items;
  const cards = useLiveLayout(canvasRef, shown, layoutRef);
  const rowItems = useMemo(() => items.map((i) => ({ ...i, ...cards.find((c) => c.id === i.id)?.grid })), [items, cards]);
  const placed = useMemo(() => cards.map(({ id, rect: r }) => ({ id, x: r.left, y: r.top, w: r.width, h: r.height })), [cards]);
  const onKey = useBoardKeyboard({ items: rowItems, placed, canRemove, label, onCommit, onRemoved, onSelect, setAnnounce });
  const hidden = items.filter((it) => !isStructuralId(it.id) && !cards.some((c) => c.id === it.id));
  const geometry = useRowGeometry(canvasRef, rowItems);
  // 배치 전체(자리 + 제목·옵션)를 글자로 — rowItems는 카드 픽셀을 다시 잴 때마다 새 객체라(차트가 늦게 뜸 · 미리보기 재수신) 객체로 비교하면
  // 메뉴가 저절로 닫힌다. 자리만 보면 옵션(연락처·금액 표시)을 되돌린 뒤 옛 배치로 행을 넣어 그 옵션이 되살아난다(리뷰 2026-10-14).
  const rowSig = useMemo(() => JSON.stringify(rowItems), [rowItems]);
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  const closeRowMenu = useCallback(() => setRowMenu(null), []);
  /**
   * 캔버스 우클릭 = '이곳에 행 추가'(원장 2026-10-14 — 위쪽 '행 편집' 줄 대신). 누른 높이에서 가장 가까운 행 경계
   * (카드를 가로지르지 않는 곳)에 넣는다. 그 자리가 완전히 빈 행이면 '빈 행 삭제'도 함께 보인다.
   */
  const onCanvasContextMenu = (ev: ReactMouseEvent<HTMLDivElement>) => {
    const host = canvasRef.current;
    if (!host || drag || resize) return;
    ev.preventDefault();
    const offset = ev.clientY - host.getBoundingClientRect().top - geometry.top;
    const at = boundaryNear(rowItems, (offset + geometry.gap / 2) / geometry.step);
    const band = emptyBandAt(rowItems, Math.floor(offset / geometry.step));
    const insert = (count: number) => () => {
      const next = insertGridRows(rowItems, at, count, `space:${crypto.randomUUID()}`);
      if (next.length === rowItems.length && next.every((it, i) => it === rowItems[i])) {
        setAnnounce("더 이상 행을 넣을 수 없습니다");
        return void toast.info("더 이상 행을 넣을 수 없습니다");
      }
      onCommit(next);
    };
    setRowMenu({
      x: ev.clientX,
      y: ev.clientY,
      at,
      title: at === 0 ? "맨 위" : `${at}행 아래`,
      items: [
        { label: "이곳에 행 1개 추가", run: insert(1) },
        { label: "이곳에 행 4개 추가", run: insert(4) },
        ...(band ? [{ label: `빈 행 ${band.h}개 삭제 · 아래 카드 당기기`, danger: true, run: () => onCommit(removeGridRows(rowItems, band.y, band.h)) }] : []),
      ],
      source: rowSig,
    });
  };
  // 메뉴가 열린 채 배치가 바뀌면(Ctrl+Z·Ctrl+Y) 내린다 — 열 때의 배치로 만든 항목이 되돌린 것을 다시 살린다(리뷰 2026-10-14).
  // 상태째 지운다(렌더 중 갱신) — 숨기기만 하면 다시 실행으로 같은 배치가 돌아왔을 때 옛 메뉴가 되살아난다.
  if (rowMenu && rowMenu.source !== rowSig) setRowMenu(null);
  const openMenu = rowMenu && rowMenu.source === rowSig ? rowMenu : null;

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
          <div ref={canvasRef} className={live.canvas} onClick={(ev) => ev.target === ev.currentTarget && onSelect(null)} onContextMenu={onCanvasContextMenu}>
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
            {!drag && !resize ? <RowGuides geometry={geometry} items={rowItems} onCommit={onCommit} target={openMenu?.at ?? null} /> : null}
          </div>
          <div className={e.srLive} aria-live="polite">{announce}</div>
          {openMenu ? <RowContextMenu menu={openMenu} close={closeRowMenu} /> : null}
        </CanvasDrop>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={onAddRow}>+ 하단에 행 추가</Button>
        <span className="text-muted-foreground text-sm">원하는 높이에서 우클릭하면 그 자리에 행을 넣을 수 있습니다.</span>
      </div>
      {hidden.length ? <details className={live.hiddenCards}>
        <summary>현재 화면에 표시되지 않는 카드 {hidden.length}개</summary>
        <p>권한이나 데이터에 따라 표시됩니다. 배치에는 보관되어 있습니다.</p>
        <div>{hidden.map((it) => <button key={it.id} type="button" onClick={() => onSelect(it.id)}>{label(it.id)} 설정</button>)}</div>
      </details> : null}
      <WidgetDrawer ids={unused} draggingTile={drag?.kind === "tile"} activeChip={drag?.kind === "chip" ? drag.id : null} onAdd={onAdd} />
      {typeof document !== "undefined" ? createPortal(<>
        <DragOverlay dropAnimation={null} zIndex={70}>
          {drag?.kind === "tile" ? <div className={e.lifted} style={{ transform: "none", animation: "none" }} data-blocked={drag.target === null || undefined}>
            <CardDragPreview html={dragHtml} width={drag.size.width} height={drag.size.height} />
          </div> : drag ? <div className={`${e.chip} ${e.liftedChip}`}><WidgetThumb kind={cardDef(drag.id)?.thumb ?? "number"} /><span>{label(drag.id)}</span></div> : null}
        </DragOverlay>
        {drag?.kind === "tile" ? <Trash over={drag.target === "trash"} blocked={!canRemove && !isHeadingId(drag.id)} /> : null}
      </>, document.body) : null}
    </DndContext>
  );
}
