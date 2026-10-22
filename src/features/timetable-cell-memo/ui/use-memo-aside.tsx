"use client";

import { useEffect, type RefObject } from "react";
import { clampMemoSize, primaryMemo, type CellMemo } from "../rules";
import { setCellMemoAsideProvider } from "./aside-registry";
import { bodyCellOf, type MemoTarget } from "./cell-dom";
import { MemoNote } from "./memo-note";

/**
 * 수업 칸 정보 카드의 **오른쪽 2열**(원장 *"정보 1열, 메모 2열"*)을 내건다 — 카드가 트리거(칩)를 넘겨 물으면 그 칸 메모 상자를 돌려준다.
 * 편집 중인 칸은 묻지 않는다(상자가 둘이 된다). 🔴 fail-soft — 메모 2열 하나 때문에 정보 카드까지 안 뜨면 안 된다.
 */
export function useMemoAside(opts: {
  anchorRef: RefObject<HTMLElement | null>;
  live: RefObject<{ editable: boolean; editorTd: Element | null }>;
  identify: (td: HTMLTableCellElement) => MemoTarget | null;
  memosAt: (t: MemoTarget) => CellMemo[];
  openEditor: (t: MemoTarget, memo: CellMemo | null, rect?: DOMRect) => void;
}) {
  const { anchorRef, live, identify, memosAt, openEditor } = opts;
  useEffect(() => {
    const asideOf = (trigger: HTMLElement) => {
      const root = anchorRef.current?.parentElement;
      const td = root ? bodyCellOf(trigger, root) : null;
      const t = td && td !== live.current.editorTd ? identify(td) : null;
      const list = t ? memosAt(t) : [];
      if (!t || !td || list.length === 0) return null;
      const p = primaryMemo(list, t.spec.keyStart)!;
      const size = clampMemoSize(p.width, p.height);
      const node = <MemoNote memos={list} size={size} canEdit={live.current.editable} onActivate={(r) => openEditor(t, p, r)} />;
      return { node, width: size.width, height: size.height, anchor: td.getBoundingClientRect() };
    };
    const provider = (trigger: HTMLElement) => {
      try {
        return asideOf(trigger);
      } catch {
        return null;
      }
    };
    setCellMemoAsideProvider(provider);
    return () => setCellMemoAsideProvider(null, provider);
  }, [anchorRef, live, identify, memosAt, openEditor]);
}
