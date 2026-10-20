"use client";

import { useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { cellKey, inRange, type Pos } from "../doc";
import { autoFitLines } from "../autofit";
import { cellAt, cellRange, headerLinesAt } from "../geometry";
import { resizeLines } from "../ops-struct";
import { measureText } from "./measure-text";
import { GridBase } from "./grid-base";
import { HEADER_H, ROW_HEAD_W } from "./grid-dims";
import { ColumnHeaders, HeaderCorner, RowHeaders, type HeaderHandlers } from "./grid-headers";
import { CellEditorBox, ResizeGuide, SelectionLayer } from "./grid-overlay";
import type { CellEditor } from "./use-cell-editor";
import type { useSheetKeys } from "./use-sheet-keys";
import type { SheetModel } from "./use-sheet-model";

/**
 * 판 창 — 자기 스크롤(가로·세로)을 가진 엑셀 창. 머리(열 이름·행 번호)는 고정, 본문은 그림 층 + 선택 층 + 편집 칸.
 * 🔴 `data-no-drag-scroll` — 바깥 시간표 판의 '잡고 끌기'가 여기서 시작하지 않는다(끌기 = 범위 선택).
 */
type Resize = { axis: "row" | "col"; index: number; start: number; orig: number; size: number; lines: number[] };

export function SheetGrid({
  model,
  editor,
  keys,
  canEdit,
  viewportRef,
  onMenu,
}: {
  model: SheetModel;
  editor: CellEditor;
  keys: ReturnType<typeof useSheetKeys>;
  canEdit: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  onMenu: (x: number, y: number) => void;
}) {
  const { doc, layout, merges, range, sel } = model;
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | "cells" | "row" | "col">(null);
  const [resize, setResize] = useState<Resize | null>(null);

  const posAt = (e: { clientX: number; clientY: number }): Pos => {
    const rect = bodyRef.current!.getBoundingClientRect();
    return cellAt(layout, e.clientX - rect.left, e.clientY - rect.top);
  };
  const settle = () => {
    if (editor.editingRef.current) editor.commit(0, 0);
    keys.clearCopied();
  };

  /** 편집 중인 입력칸 안을 누른 것(글자 사이 커서 옮기기) — 판 선택으로 먹지 않는다. */
  const insideEditor = (t: EventTarget) => t === editor.taRef.current && !!editor.editingRef.current;

  const onBodyDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || insideEditor(e.target)) return;
    e.preventDefault();
    settle();
    editor.select(posAt(e), e.shiftKey);
    drag.current = "cells";
    e.currentTarget.setPointerCapture(e.pointerId);
    editor.focus();
  };
  const onBodyMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current === "cells") editor.select(posAt(e), true);
  };
  const endDrag = () => void (drag.current = null);

  const headers: HeaderHandlers = {
    onSelect(axis, index, e) {
      if (e.button !== 0) return;
      e.preventDefault();
      settle();
      const last = { r: doc.rows - 1, c: doc.cols - 1 };
      const s = model.selRef.current;
      // Shift+누르기 = 지금 고른 줄부터 여기까지.
      const anchor =
        axis === "col" ? { r: 0, c: e.shiftKey ? s.anchor.c : index } : { r: e.shiftKey ? s.anchor.r : index, c: 0 };
      const focus = axis === "col" ? { r: last.r, c: index } : { r: index, c: last.c };
      model.setSel({ anchor, focus });
      drag.current = axis;
      editor.focus();
    },
    onResize(axis, index, e) {
      if (!canEdit || e.button !== 0) return;
      e.preventDefault();
      const sizes = axis === "col" ? doc.colW : doc.rowH;
      // 여러 줄을 통째로 고른 채 경계를 끌면 고른 줄이 모두 같은 크기가 된다(엑셀과 같다).
      const lines = headerLinesAt(doc, range, axis, index);
      const start = axis === "col" ? e.clientX : e.clientY;
      setResize({ axis, index, start, orig: sizes[index]!, size: sizes[index]!, lines });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onAutoFit(axis, index) {
      if (!canEdit) return;
      settle();
      model.apply((d) => autoFitLines(d, axis, headerLinesAt(d, range, axis, index), measureText));
    },
  };

  const onFrameMove = (e: PointerEvent<HTMLDivElement>) => {
    if (resize) {
      const delta = (resize.axis === "col" ? e.clientX : e.clientY) - resize.start;
      // 2px 안의 흔들림은 끌기가 아니다 — 두 번 누르기(크기 맞추기)의 첫 클릭이 크기 바꾸기로 남지 않게.
      if (Math.abs(delta) > 2 || resize.size !== resize.orig) setResize({ ...resize, size: Math.max(6, resize.orig + delta) });
      return;
    }
    if (drag.current === "col" || drag.current === "row") {
      const p = posAt(e);
      const s = model.selRef.current;
      model.setSel({
        anchor: s.anchor,
        focus: drag.current === "col" ? { r: doc.rows - 1, c: p.c } : { r: p.r, c: doc.cols - 1 },
      });
    }
  };
  const onFrameUp = () => {
    if (resize) {
      const r = resize;
      setResize(null);
      if (r.size !== r.orig) model.apply((d) => resizeLines(d, r.axis, r.lines, r.size));
    }
    endDrag();
  };

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    if (insideEditor(e.target)) return; // 편집 중 글자 메뉴(복사·붙여넣기)는 브라우저 것
    e.preventDefault();
    settle();
    const p = posAt(e);
    if (!inRange(range, p.r, p.c)) editor.select(p, false);
    editor.focus();
    onMenu(e.clientX, e.clientY);
  };

  const active = cellRange(sel.anchor, merges);
  const fullCols = range.r0 === 0 && range.r1 === doc.rows - 1;
  const fullRows = range.c0 === 0 && range.c1 === doc.cols - 1;
  const editing = editor.editing;

  return (
    <div
      ref={viewportRef}
      data-no-drag-scroll=""
      className="relative min-h-0 flex-1 overflow-auto bg-white"
      onPointerMove={onFrameMove}
      onPointerUp={onFrameUp}
      onPointerCancel={onFrameUp}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `${ROW_HEAD_W}px ${layout.width}px`, gridTemplateRows: `${HEADER_H}px ${layout.height}px` }}
      >
        <HeaderCorner
          onSelectAll={() => {
            settle();
            model.setSel({ anchor: { r: 0, c: 0 }, focus: { r: doc.rows - 1, c: doc.cols - 1 } });
            editor.focus();
          }}
        />
        <ColumnHeaders layout={layout} range={range} full={fullCols} handlers={headers} />
        <RowHeaders layout={layout} range={range} full={fullRows} handlers={headers} />
        <div
          ref={bodyRef}
          className="relative cursor-cell select-none"
          style={{ width: layout.width, height: layout.height }}
          onPointerDown={onBodyDown}
          onPointerMove={onBodyMove}
          onPointerUp={endDrag}
          onDoubleClick={() => editor.startEdit("edit")}
          onContextMenu={onContextMenu}
        >
          <GridBase doc={doc} layout={layout} merges={merges} />
          <SelectionLayer layout={layout} range={range} active={active} copied={keys.copied} />
          <CellEditorBox
            taRef={editor.taRef}
            layout={layout}
            active={active}
            style={doc.cells[cellKey(sel.anchor.r, sel.anchor.c)]?.s}
            editing={!!editing}
            readOnly={!canEdit}
            handlers={{
              onKeyDown: keys.onKeyDown,
              onInput: () => editor.beginTyping(),
              onCompositionStart: () => editor.beginTyping(),
              onCopy: keys.onCopy,
              onCut: keys.onCut,
              onPaste: keys.onPaste,
              onBlur: () => {
                if (editor.editingRef.current) editor.commit(0, 0);
              },
            }}
          />
          <ResizeGuide layout={layout} resize={resize} />
        </div>
      </div>
    </div>
  );
}
