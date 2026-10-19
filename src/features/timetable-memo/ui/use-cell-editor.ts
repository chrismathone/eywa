"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import { cellKey, type Pos } from "../doc";
import { cellRange, rectOf, stepPos } from "../geometry";
import { setTexts } from "../ops";
import { HEADER_H, ROW_HEAD_W } from "./grid-dims";
import type { SheetModel } from "./use-sheet-model";

/**
 * 칸 편집 — **늘 떠 있는 textarea 하나**가 입력을 받는다(구글 시트와 같은 방식).
 * 🔴 왜 숨은 입력칸인가: 한글은 조합(IME)으로 들어와 첫 keydown이 `Process`라 글자를 알 수 없다. 입력칸이
 *    처음부터 포커스를 들고 고른 칸 자리에 있으면 조합이 그대로 그 칸 글자가 된다(첫 글자가 사라지지 않는다).
 * 🔴 textarea는 **비제어**다 — React가 value를 다시 쓰면 조합 중인 글자가 끊긴다.
 * replace = 고른 칸에서 바로 친 것(방향키를 누르면 확정하고 옮긴다) · edit = F2·더블클릭(방향키는 글자 안 이동).
 */
export type Editing = { pos: Pos; mode: "replace" | "edit" } | null;

export function useCellEditor(model: SheetModel, canEdit: boolean, viewportRef: RefObject<HTMLDivElement | null>) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditingState] = useState<Editing>(null);
  const editingRef = useRef<Editing>(null);
  const setEditing = useCallback((e: Editing) => {
    editingRef.current = e;
    setEditingState(e);
  }, []);

  const focus = useCallback(() => {
    taRef.current?.focus({ preventScroll: true });
  }, []);

  /** 고른 칸이 화면 밖이면 보이게 굴린다(머리 줄·번호 칸만큼 띄워서). */
  const reveal = useCallback(
    (pos: Pos) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const rect = rectOf(model.layout, cellRange(pos, model.merges));
      // 판 좌표 → 스크롤 좌표: 본문은 행 번호 칸·열 이름 줄 뒤에서 시작하고, 두 머리는 고정(sticky)이다.
      const left = rect.x;
      const right = rect.x + rect.w + ROW_HEAD_W;
      const top = rect.y;
      const bottom = rect.y + rect.h + HEADER_H;
      if (left < vp.scrollLeft) vp.scrollLeft = left;
      else if (right > vp.scrollLeft + vp.clientWidth) vp.scrollLeft = right - vp.clientWidth;
      if (top < vp.scrollTop) vp.scrollTop = top;
      else if (bottom > vp.scrollTop + vp.clientHeight) vp.scrollTop = bottom - vp.clientHeight;
    },
    [model.layout, model.merges, viewportRef],
  );

  const select = useCallback(
    (pos: Pos, extend: boolean) => {
      const s = model.selRef.current;
      const m = model.merges.get(cellKey(pos.r, pos.c));
      const p = m && !extend ? { r: m.r, c: m.c } : pos;
      model.setSel(extend ? { anchor: s.anchor, focus: p } : { anchor: p, focus: p });
      reveal(p);
    },
    [model, reveal],
  );

  const move = useCallback(
    (dr: number, dc: number, extend: boolean) => {
      const s = model.selRef.current;
      const from = extend ? s.focus : s.anchor;
      const next = extend
        ? { r: Math.min(model.docRef.current.rows - 1, Math.max(0, from.r + dr)), c: Math.min(model.docRef.current.cols - 1, Math.max(0, from.c + dc)) }
        : stepPos(model.docRef.current, model.merges, from, dr, dc);
      select(next, extend);
    },
    [model, select],
  );

  const startEdit = useCallback(
    (mode: "replace" | "edit") => {
      const ta = taRef.current;
      if (!canEdit || !ta || editingRef.current) return;
      const pos = model.selRef.current.anchor;
      if (mode === "edit") {
        ta.value = model.docRef.current.cells[cellKey(pos.r, pos.c)]?.t ?? "";
        const end = ta.value.length;
        ta.setSelectionRange(end, end);
      }
      setEditing({ pos, mode });
      reveal(pos);
      ta.focus({ preventScroll: true });
    },
    [canEdit, model, reveal, setEditing],
  );

  /** 고른 칸에서 바로 치기 시작했다(입력·조합 시작 이벤트) — 값은 건드리지 않는다(조합 중인 글자를 살린다). */
  const beginTyping = useCallback(() => {
    if (!canEdit || editingRef.current) return;
    const pos = model.selRef.current.anchor;
    setEditing({ pos, mode: "replace" });
    reveal(pos);
  }, [canEdit, model, reveal, setEditing]);

  /** 확정 — 글자가 바뀌었을 때만 문서에 남기고(이력 1칸), 정한 방향으로 옮긴다. */
  const commit = useCallback(
    (dr: number, dc: number) => {
      const e = editingRef.current;
      const ta = taRef.current;
      if (!e || !ta) return;
      const text = ta.value;
      ta.value = "";
      setEditing(null);
      const prev = model.docRef.current.cells[cellKey(e.pos.r, e.pos.c)]?.t ?? "";
      if (text !== prev) model.apply((d) => setTexts(d, [{ r: e.pos.r, c: e.pos.c, t: text }]));
      if (dr || dc) move(dr, dc, false);
    },
    [model, move, setEditing],
  );

  const cancel = useCallback(() => {
    if (taRef.current) taRef.current.value = "";
    setEditing(null);
  }, [setEditing]);

  return { taRef, editing, editingRef, focus, reveal, select, move, startEdit, beginTyping, commit, cancel };
}

export type CellEditor = ReturnType<typeof useCellEditor>;
