"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { cellSpecOf, type CellPos, type LaneCol } from "../grid-index";
import { memoDateOf, memosInRange, type CellMemo } from "../rules";
import { bodyRows, indexBody, rowCells, type MemoTarget } from "./cell-dom";

/**
 * 강사뷰 표의 칸 ↔ 메모 — 칸 되짚기(`identify`) · 그 칸 메모(`memosAt`) · **표식 칠하기**.
 *
 * 🔴 표식은 칸에 속성 하나(`data-cell-memo`)만 붙였다 뗀다 — React 상태가 아니라서 격자가 다시 그려지지 않는다.
 *    메모·주·축이 바뀌거나 표가 다시 그려지면(주 이동·새로고침·명단 펼침) 처음부터 다시 칠한다(지난 주 표식이 남지 않게).
 * `anchorRef` = 표 옆에 선 레이어의 표시용 자리(부모가 표를 품은 스크롤 상자).
 */

export const CELL_MEMO_MARK = "data-cell-memo";

type Axis = { memos: readonly CellMemo[]; lanes: readonly LaneCol[]; firstMin: number; stepMin: number; weekMonday: string };

/** 칸의 메모들 — 시각순. */
export function memosOfTarget(memos: readonly CellMemo[], t: MemoTarget): CellMemo[] {
  return memosInRange(memos, t.spec.col, t.date, t.spec.from, t.spec.to);
}

export function useCellMarks(anchorRef: RefObject<HTMLElement | null>, axis: Axis) {
  const live = useRef(axis);
  const index = useRef<Map<HTMLTableCellElement, CellPos> | null>(null);
  const { memos, lanes, firstMin, stepMin, weekMonday } = axis;

  useEffect(() => {
    live.current = axis;
  });
  useEffect(() => {
    index.current = null;
  }, [lanes, firstMin, stepMin]);

  const tbodyOf = useCallback(
    () => anchorRef.current?.parentElement?.querySelector<HTMLTableSectionElement>("table > tbody") ?? null,
    [anchorRef],
  );

  const identify = useCallback(
    (td: HTMLTableCellElement): MemoTarget | null => {
      const tbody = tbodyOf();
      if (!tbody) return null;
      index.current ??= indexBody(tbody);
      const pos = index.current.get(td);
      if (!pos) return null;
      const a = live.current;
      const mb = td.dataset.mb;
      const spec = cellSpecOf(pos, mb ? Number(mb) : null, a.lanes, { firstMin: a.firstMin, stepMin: a.stepMin });
      return spec ? { td, spec, date: memoDateOf(a.weekMonday, spec.day) } : null;
    },
    [tbodyOf],
  );
  const memosAt = useCallback((t: MemoTarget) => memosOfTarget(live.current.memos, t), []);

  const paint = useCallback(() => {
    const tbody = tbodyOf();
    if (!tbody) return;
    // 🔴 fail-soft — 표식 하나 때문에 시간표 전체가 오류 화면이 되지 않게(효과 안 예외는 화면을 무너뜨린다, [[#95]]와 같은 결).
    try {
      const any = live.current.memos.length > 0;
      for (const row of bodyRows(tbody)) {
        for (const td of rowCells(row)) {
          const t = any ? identify(td) : null;
          if (t && memosAt(t).length > 0) td.setAttribute(CELL_MEMO_MARK, "");
          else if (td.hasAttribute(CELL_MEMO_MARK)) td.removeAttribute(CELL_MEMO_MARK);
        }
      }
    } catch (e) {
      console.error("[timetable] 칸 메모 표식을 그리지 못했습니다", e);
    }
  }, [tbodyOf, identify, memosAt]);

  useEffect(() => {
    paint();
  }, [paint, memos, lanes, firstMin, stepMin, weekMonday]);

  useEffect(() => {
    const table = tbodyOf()?.parentElement;
    if (!table) return;
    let raf = 0;
    const mo = new MutationObserver(() => {
      index.current = null;
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), paint()));
    });
    mo.observe(table, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
      for (const td of Array.from(table.querySelectorAll(`td[${CELL_MEMO_MARK}]`))) td.removeAttribute(CELL_MEMO_MARK);
    };
  }, [tbodyOf, paint]);

  return { identify, memosAt };
}
