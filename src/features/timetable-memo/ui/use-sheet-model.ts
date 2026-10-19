"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { overLimit, rangeOf, type Pos, type Range, type SheetDoc } from "../doc";
import { expandToMerges, layoutOf, mergeIndex } from "../geometry";

/**
 * 판의 상태 한 벌 — 문서 · 선택 · 되돌리기 이력.
 * 🔴 문서의 정본은 `docRef`(렌더와 무관하게 늘 최신) — 키 입력·붙여넣기 핸들러가 렌더 사이에 연달아 고쳐도
 *    앞 변경을 잃지 않는다. 화면은 같은 값을 `doc` state로 받는다.
 */
export type Selection = { anchor: Pos; focus: Pos };

const HISTORY_MAX = 100;

function clampPos(doc: SheetDoc, p: Pos): Pos {
  return { r: Math.min(doc.rows - 1, Math.max(0, p.r)), c: Math.min(doc.cols - 1, Math.max(0, p.c)) };
}

export function useSheetModel(initial: () => SheetDoc, onChange: () => void) {
  const [doc, setDoc] = useState(initial);
  const docRef = useRef(doc);
  const past = useRef<SheetDoc[]>([]);
  const future = useRef<SheetDoc[]>([]);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [sel, setSelState] = useState<Selection>({ anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } });
  const selRef = useRef(sel);
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  });

  const setSel = useCallback((next: Selection) => {
    const d = docRef.current;
    const s = { anchor: clampPos(d, next.anchor), focus: clampPos(d, next.focus) };
    selRef.current = s;
    setSelState(s);
  }, []);

  const show = useCallback((next: SheetDoc) => {
    docRef.current = next;
    setDoc(next);
    setHistory({ undo: past.current.length, redo: future.current.length });
    const s = selRef.current;
    if (s.anchor.r >= next.rows || s.anchor.c >= next.cols || s.focus.r >= next.rows || s.focus.c >= next.cols) {
      setSel(s);
    }
  }, [setSel]);

  /**
   * 편집 한 번 — 문서가 같으면(바뀐 게 없으면) 이력에 안 남긴다. 저장 상한을 넘는 편집은 들이지 않고 이유를 알린다
   * (들이면 서버가 문서 통째로 거절해 그 뒤 자동 저장이 전부 막힌다). 들였으면 true.
   */
  const apply = useCallback((fn: (d: SheetDoc) => SheetDoc): boolean => {
    const prev = docRef.current;
    const next = fn(prev);
    if (next === prev) return false;
    const over = overLimit(next);
    if (over) {
      toast.error(over);
      return false;
    }
    past.current.push(prev);
    if (past.current.length > HISTORY_MAX) past.current.shift();
    future.current = [];
    show(next);
    changed.current();
    return true;
  }, [show]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(docRef.current);
    show(prev);
    changed.current();
  }, [show]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(docRef.current);
    show(next);
    changed.current();
  }, [show]);

  /** 서버 판으로 갈아끼운다(다른 사람이 먼저 저장한 판 불러오기) — 이력은 비운다(되돌리면 남의 저장을 지운다). */
  const reset = useCallback((next: SheetDoc) => {
    past.current = [];
    future.current = [];
    show(next);
  }, [show]);

  const layout = useMemo(() => layoutOf(doc), [doc]);
  const merges = useMemo(() => mergeIndex(doc.merges), [doc.merges]);
  /** 지금 고른 범위(병합에 걸치면 넓힌 것). */
  const range: Range = useMemo(() => expandToMerges(rangeOf(sel.anchor, sel.focus), doc.merges), [sel, doc.merges]);

  return { doc, docRef, apply, undo, redo, reset, history, layout, merges, sel, selRef, setSel, range };
}

export type SheetModel = ReturnType<typeof useSheetModel>;
