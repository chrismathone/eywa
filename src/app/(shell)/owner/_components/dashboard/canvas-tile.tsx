"use client";

import { memo, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Rect } from "./geometry";
import e from "./editor.module.css";

const stop = (ev: { stopPropagation: () => void }) => ev.stopPropagation();

/**
 * 편집 캔버스의 카드 한 장 — 자리는 CSS 변수(transform)로만 옮기고(스프링 전이), 얼굴(`children`)은 memo라 다시 안 그린다.
 * 마우스 = 5px 끌면 집기 · 터치 = 길게 눌러 집기(센서는 `edit-board.tsx`). 키보드 = 화살표로 옮기기 · Shift+화살표로 크기 · Delete로 빼기.
 * '−'(빼기)·모서리 손잡이(크기)는 집기 센서가 먼저 잡지 않게 누름 이벤트를 막는다.
 */
export const CanvasTile = memo(function CanvasTile({
  id,
  label,
  rect,
  heading,
  selected,
  ghosted,
  sizeLabel,
  canRemove,
  canResize,
  onSelect,
  onRemove,
  onKey,
  onResizeStart,
  children,
}: {
  id: string;
  label: string;
  rect: Rect;
  heading: boolean;
  selected: boolean;
  ghosted: boolean;
  /** 크기를 바꾸는 중이면 그 크기(예 "2×1") — 손잡이 옆에 띄운다. */
  sizeLabel: string | null;
  canRemove: boolean;
  canResize: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onKey: (id: string, ev: KeyboardEvent<HTMLDivElement>) => void;
  onResizeStart: (id: string, ev: ReactPointerEvent<HTMLSpanElement>) => void;
  children: ReactNode;
}) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id: `tile:${id}`, data: { kind: "tile", id } });
  const style = { "--tx": `${rect.left}px`, "--ty": `${rect.top}px`, width: rect.width, height: rect.height } as CSSProperties;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      aria-roledescription="위젯"
      aria-label={`${label}. 끌어서 옮기기, 화살표로 행·열 이동, Shift와 화살표로 크기, Delete로 빼기`}
      aria-pressed={selected}
      tabIndex={0}
      data-tile-id={id}
      data-selected={selected || undefined}
      data-ghosted={ghosted || undefined}
      data-heading={heading || undefined}
      className={e.tile}
      style={style}
      onClick={() => onSelect(id)}
      onKeyDown={(ev) => onKey(id, ev)}
    >
      {children}
      {canRemove ? (
        <button
          type="button"
          className={e.remove}
          aria-label={`${label} 빼기`}
          onPointerDown={stop}
          onMouseDown={stop}
          onTouchStart={stop}
          onClick={(ev) => {
            ev.stopPropagation();
            onRemove(id);
          }}
        >
          −
        </button>
      ) : null}
      {canResize ? (
        <span
          className={e.handle}
          role="presentation"
          onMouseDown={stop}
          onTouchStart={stop}
          onClick={stop}
          onPointerDown={(ev) => {
            ev.stopPropagation();
            onResizeStart(id, ev);
          }}
        />
      ) : null}
      {sizeLabel ? <span className={e.sizeTag}>{sizeLabel}</span> : null}
    </div>
  );
});
