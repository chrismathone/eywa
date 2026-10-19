"use client";

import { useMemo } from "react";
import { rangeOf, type BorderLine, type Range } from "../doc";
import { expandToMerges } from "../geometry";
import {
  applyBorders,
  clearContents,
  clearFormats,
  mergeCells,
  patchStyle,
  styleAt,
  unmergeCells,
  type BorderMode,
  type StylePatch,
} from "../ops";
import { deleteLines, insertLines } from "../ops-struct";
import type { SheetModel } from "./use-sheet-model";

/**
 * 툴바·우클릭 메뉴·단축키가 함께 쓰는 서식 명령 — 늘 **지금 고른 범위**(병합에 걸치면 넓힌 것)에 건다.
 * 범위는 렌더 값이 아니라 ref에서 읽는다(키를 연달아 눌러도 마지막 선택을 본다).
 * 🔴 모든 명령은 먼저 `settle()`(칸 입력 확정)을 부른다 — 툴바는 판의 초점을 안 뺏어서, 입력 중에 '행 넣기'·
 *    '되돌리기'를 누르면 입력하던 글자가 **밀린 좌표**의 다른 칸에 들어갔다(적대 리뷰 2026-10-19).
 */
export type SheetActions = ReturnType<typeof useSheetActions>;
export type ToggleFlag = "b" | "i" | "u" | "st";

export function useSheetActions(model: SheetModel, settle: () => void) {
  const { apply, docRef, selRef, setSel, undo, redo } = model;
  return useMemo(() => {
    const current = (): Range => {
      const s = selRef.current;
      return expandToMerges(rangeOf(s.anchor, s.focus), docRef.current.merges);
    };
    /** 확정 → 범위 → 편집. */
    const run = (fn: (range: Range) => Parameters<typeof apply>[0]) => {
      settle();
      const range = current();
      return apply(fn(range));
    };
    /** 행·열 넣기 — 실제로 늘어난 줄 수만큼만 선택을 민다(상한에 걸려 안 늘면 그대로). */
    const insert = (axis: "row" | "col", before: boolean) => {
      settle();
      const range = current();
      const n = axis === "row" ? range.r1 - range.r0 + 1 : range.c1 - range.c0 + 1;
      const was = axis === "row" ? docRef.current.rows : docRef.current.cols;
      apply((d) => insertLines(d, axis, axis === "row" ? (before ? range.r0 : range.r1 + 1) : before ? range.c0 : range.c1 + 1, n));
      const added = (axis === "row" ? docRef.current.rows : docRef.current.cols) - was;
      if (before && added > 0) {
        const dr = axis === "row" ? added : 0;
        const dc = axis === "col" ? added : 0;
        setSel({ anchor: { r: range.r0 + dr, c: range.c0 + dc }, focus: { r: range.r1 + dr, c: range.c1 + dc } });
      }
    };
    const collapse = (range: Range) => setSel({ anchor: { r: range.r0, c: range.c0 }, focus: { r: range.r0, c: range.c0 } });
    return {
      current,
      undo() {
        settle();
        undo();
      },
      redo() {
        settle();
        redo();
      },
      toggle(flag: ToggleFlag) {
        run((range) => {
          const on = !styleAt(docRef.current, range.r0, range.c0)[flag];
          return (d) => patchStyle(d, range, { [flag]: on ? true : null });
        });
      },
      style: (patch: StylePatch) => run((range) => (d) => patchStyle(d, range, patch)),
      borders: (mode: BorderMode, line: BorderLine) => run((range) => (d) => applyBorders(d, range, mode, line)),
      merge: () => run((range) => (d) => mergeCells(d, range)),
      unmerge: () => run((range) => (d) => unmergeCells(d, range)),
      clearContents: () => run((range) => (d) => clearContents(d, range)),
      clearFormats: () => run((range) => (d) => clearFormats(d, range)),
      insertRows: (where: "above" | "below") => insert("row", where === "above"),
      insertCols: (where: "left" | "right") => insert("col", where === "left"),
      deleteRows() {
        settle();
        const range = current();
        if (apply((d) => deleteLines(d, "row", range.r0, range.r1 - range.r0 + 1))) collapse(range);
      },
      deleteCols() {
        settle();
        const range = current();
        if (apply((d) => deleteLines(d, "col", range.c0, range.c1 - range.c0 + 1))) collapse(range);
      },
    };
  }, [apply, docRef, selRef, setSel, undo, redo, settle]);
}
