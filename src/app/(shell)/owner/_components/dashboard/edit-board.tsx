"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, MeasuringStrategy, getClientRect } from "@dnd-kit/core";
import type { MenuKey } from "@/lib/permissions";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { holesOf, layoutAt } from "@/features/dashboard/layout/flow";
import { placedIds, removeItem } from "@/features/dashboard/layout/engine";
import { cardDef } from "@/features/dashboard/layout/registry";
import { summaryOf } from "@/features/dashboard/layout/summary";
import { isHeadingId, type Bundle, type Item } from "@/features/dashboard/layout/types";
import { badgesFor, exposureOf, optionOn } from "./badges";
import { ACCESSIBILITY, CanvasDrop, Trash } from "./board-drop-targets";
import { useBoardKeyboard } from "./use-board-keyboard";
import { CanvasTile } from "./canvas-tile";
import { metricsOf, rectOf, SPRING, type Rect } from "./geometry";
import { boardCollision, useBoardDrag } from "./use-board-drag";
import { useResize } from "./use-resize";
import { WidgetDrawer } from "./widget-drawer";
import { WidgetFace } from "./widget-face";
import { WidgetThumb } from "./widget-thumb";
import e from "./editor.module.css";

/**
 * 편집 캔버스 + 아래 서랍 — iOS 홈 화면 위젯 편집처럼: 들면 살짝 커지고(그림자), 다른 카드는 **스프링으로 비켜 흐르고**,
 * 놓을 자리는 점선 윤곽으로 보인다. 크기는 모서리 손잡이로 끌면 프리셋에 붙는다. 서랍으로 끌어 내리면 빠진다(되돌리기 토스트).
 * 🔴 끄는 카드는 body로 포털한 `DragOverlay`가 그린다 — transform 조상 아래 fixed 좌표가 틀어지는 함정([[#98]]).
 */
export function EditBoard(props: {
  items: Item[];
  role: Bundle;
  menus: ReadonlySet<MenuKey>;
  snapshot: OverviewSnapshot | null;
  selected: string | null;
  unused: readonly string[];
  onSelect: (id: string | null) => void;
  onCommit: (next: Item[]) => void;
  onRemoved: (id: string, before: Item[]) => void;
  onAdd: (id: string) => void;
}) {
  const { items, role, menus, snapshot, selected, unused, onSelect, onCommit, onRemoved, onAdd } = props;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [announce, setAnnounce] = useState("");
  const layoutRef = useRef<{ placed: ReturnType<typeof layoutAt>; metrics: ReturnType<typeof metricsOf> } | null>(null);
  const dropFrom = useRef<{ id: string; rect: Rect } | null>(null);

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    ro.observe(el); // 처음 관찰할 때도 한 번 불린다 — 첫 폭을 따로 재지 않는다(effect 안 동기 setState 금지, gotchas #25).
    return () => ro.disconnect();
  }, []);

  const label = useCallback((id: string) => items.find((i) => i.id === id)?.title ?? cardDef(id)?.label ?? "구역 제목", [items]);
  const onDropped = useCallback((id: string, rect: Rect) => {
    dropFrom.current = { id, rect };
  }, []);
  const { drag, preview: dragPreview, sensors, canRemove, handlers } = useBoardDrag({ items, canvasRef, layoutRef, onCommit, onRemoved, onDropped });
  const { resize, preview: resizePreview, start: startResize } = useResize({ items, layoutRef, onCommit });

  const shown = dragPreview ?? resizePreview ?? items;
  const placed = useMemo(() => layoutAt(shown, "desktop"), [shown]);
  // 맨 아래 빈 줄 하나는 **늘** 둔다(맨 뒤에 놓을 자리) — 끌기를 시작할 때 늘리면 캔버스가 자라 아래 서랍이 포인터에서 도망간다.
  const metrics = useMemo(() => metricsOf(placed, Math.max(width, 1), 1), [placed, width]);
  useLayoutEffect(() => {
    layoutRef.current = { placed, metrics };
  });
  const holes = useMemo(() => (drag ? [] : holesOf(placed)), [placed, drag]);

  // 얼굴은 배치·역할·권한·값이 바뀔 때만 다시 만든다 — 끄는 동안(자리만 바뀜) 같은 요소를 넘겨 다시 그리지 않는다.
  const chipItem = drag?.kind === "chip" ? drag.item : null;
  const exposure = useMemo(() => exposureOf(items, role, menus), [items, role, menus]);
  const faces = useMemo(() => {
    const all = chipItem ? [...items, chipItem] : items;
    return new Map(
      all.map((it) => {
        if (isHeadingId(it.id)) {
          return [it.id, <div key={it.id} className={e.headingFace}><b>{it.title}</b>{it.note ? <span>{it.note}</span> : null}</div>] as const;
        }
        const def = cardDef(it.id)!;
        const sum = snapshot ? summaryOf(it.id, snapshot, { amounts: optionOn(it, "amounts", role) }) : null;
        return [it.id, <WidgetFace key={it.id} def={def} item={it} summary={sum} badges={badgesFor(it, role, menus, exposure)} />] as const;
      }),
    );
  }, [items, chipItem, snapshot, role, menus, exposure]);

  // 놓은 카드는 들고 있던 자리에서 제자리로 스프링 착지(FLIP). 움직임 줄이기 설정이면 건너뛴다.
  useLayoutEffect(() => {
    const from = dropFrom.current;
    if (!from || drag) return;
    dropFrom.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = canvasRef.current?.querySelector<HTMLElement>(`[data-tile-id="${CSS.escape(from.id)}"]`);
    if (!el) return;
    const to = el.getBoundingClientRect();
    const base = getComputedStyle(el).transform;
    const frames = [{ transform: `translate(${from.rect.left - to.left}px, ${from.rect.top - to.top}px) ${base === "none" ? "" : base} scale(1.04)` }, { transform: base }];
    try {
      el.animate(frames, { duration: 420, easing: SPRING });
    } catch {
      el.animate(frames, { duration: 420, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.12)" }); // linear() 이징을 모르는 브라우저
    }
  }, [items, drag]);

  const onKey = useBoardKeyboard({ items, placed, canRemove, label, onCommit, onRemoved, onSelect, setAnnounce });

  const ghost = drag && drag.target === "canvas" ? placed.find((p) => p.id === drag.id) : null;
  const blocked = !!drag && drag.target === null;
  const overlayFace = drag ? faces.get(drag.id) : null;
  const sizeLabelOf = (id: string) => {
    if (resize?.id !== id) return null;
    return resize.z.label;
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollision}
      // 🔑 카드 자리는 transform으로 옮긴다 — dnd-kit 기본(transform을 뺀 크기)으로 재면 들어 올린 카드가 캔버스 원점에서 뜬다.
      measuring={{ draggable: { measure: getClientRect }, droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={ACCESSIBILITY}
      {...handlers}
    >
      <CanvasDrop over={drag?.target === "canvas"} onBackground={() => onSelect(null)}>
        <div ref={canvasRef} className={e.canvas} style={{ height: metrics.height } as CSSProperties} onClick={(ev) => ev.target === ev.currentTarget && onSelect(null)}>
          {width > 0 &&
            holes.map((h) => {
              const r = rectOf({ ...h, h: 1 }, metrics);
              return <div key={`${h.x}:${h.y}`} className={e.hole} style={{ "--tx": `${r.left}px`, "--ty": `${r.top}px`, width: r.width, height: r.height } as CSSProperties} aria-hidden />;
            })}
          {ghost && width > 0 ? (() => {
            const r = rectOf(ghost, metrics);
            return <div className={e.ghost} style={{ "--tx": `${r.left}px`, "--ty": `${r.top}px`, width: r.width, height: r.height } as CSSProperties} aria-hidden />;
          })() : null}
          {width > 0 &&
            shown.map((it) => {
              const p = placed.find((x) => x.id === it.id);
              if (!p) return null;
              const heading = isHeadingId(it.id);
              const def = cardDef(it.id);
              return (
                <CanvasTile
                  key={it.id}
                  id={it.id}
                  label={label(it.id)}
                  rect={rectOf(p, metrics)}
                  heading={heading}
                  selected={selected === it.id}
                  ghosted={drag?.id === it.id}
                  sizeLabel={sizeLabelOf(it.id)}
                  canRemove={heading || canRemove}
                  canResize={!heading && !!def && def.sizes.length > 1}
                  onSelect={onSelect}
                  onRemove={(id) => {
                    const before = [...items];
                    onCommit(removeItem(items, id));
                    onRemoved(id, before);
                  }}
                  onKey={onKey}
                  onResizeStart={startResize}
                >
                  {faces.get(it.id)}
                </CanvasTile>
              );
            })}
        </div>
        <div className={e.srLive} aria-live="polite">
          {announce}
        </div>
      </CanvasDrop>
      <WidgetDrawer ids={unused} draggingTile={drag?.kind === "tile"} activeChip={drag?.kind === "chip" ? drag.id : null} onAdd={onAdd} />
      {/* 편집기는 SSR하지 않는다(next/dynamic ssr:false) — 첫 렌더부터 document가 있다. */}
      {typeof document !== "undefined"
        ? createPortal(
            <>
              <DragOverlay dropAnimation={null} zIndex={70}>
                {drag?.kind === "tile" ? (
                  <div className={e.lifted} style={{ width: drag.size.width, height: drag.size.height }} data-blocked={blocked || undefined}>
                    {overlayFace}
                  </div>
                ) : drag ? (
                  <div className={`${e.chip} ${e.liftedChip}`} data-blocked={blocked || undefined}>
                    <WidgetThumb kind={cardDef(drag.id)?.thumb ?? "number"} />
                    <span>{label(drag.id)}</span>
                  </div>
                ) : null}
              </DragOverlay>
              {drag?.kind === "tile" ? <Trash over={drag.target === "trash"} blocked={!canRemove && placedIds(items).includes(drag.id)} /> : null}
            </>,
            document.body,
          )
        : null}
    </DndContext>
  );
}
