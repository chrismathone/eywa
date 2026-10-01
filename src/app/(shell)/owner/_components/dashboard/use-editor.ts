"use client";

import { useCallback, useMemo, useReducer } from "react";
import { defaultItems } from "@/features/dashboard/layout/defaults";
import { insertAt, sameItems } from "@/features/dashboard/layout/engine";
import { canRedo, canUndo, pushHistory, redoHistory, startHistory, undoHistory, type History } from "@/features/dashboard/layout/history";
import { roleItems } from "@/features/dashboard/layout/normalize";
import { BUNDLES, DASHBOARD_VERSION, type Bundle, type DashboardSettings, type Item } from "@/features/dashboard/layout/types";

/**
 * 대시보드 편집기 상태 — 역할마다 **따로** 되돌리기 이력을 든다(역할을 오가도 각자의 편집이 남는다).
 * 저장은 다섯 역할을 한 번에(학원 설정 한 섹션). 기본과 같은 역할은 서버가 저장값을 지운다(`normalize.ts`).
 */
type State = { role: Bundle; drafts: Record<Bundle, History>; selected: string | null; editing: boolean };
type Action =
  | { type: "role"; role: Bundle }
  | { type: "editing"; on: boolean }
  | { type: "select"; id: string | null }
  | { type: "commit"; items: Item[]; role?: Bundle }
  /** 뺀 카드 되살리기(토스트 '되돌리기') — 그사이 역할을 바꿨어도 **뺀 그 역할**의 지금 배치에 원래 자리로. */
  | { type: "restore"; role: Bundle; item: Item; index: number }
  | { type: "undo" }
  | { type: "redo" };

function reduce(state: State, a: Action): State {
  const h = state.drafts[state.role];
  switch (a.type) {
    case "role":
      return { ...state, role: a.role, selected: null };
    case "editing":
      return { ...state, editing: a.on, selected: a.on ? state.selected : null };
    case "select":
      return { ...state, selected: a.id };
    case "commit": {
      const role = a.role ?? state.role;
      const next = pushHistory(state.drafts[role], a.items);
      const selected = role !== state.role ? state.selected : state.selected && a.items.some((i) => i.id === state.selected) ? state.selected : null;
      return next === state.drafts[role] ? state : { ...state, selected, drafts: { ...state.drafts, [role]: next } };
    }
    case "restore": {
      const cur = state.drafts[a.role].present;
      if (cur.some((i) => i.id === a.item.id)) return state;
      return reduce(state, { type: "commit", role: a.role, items: insertAt(cur, a.item, a.index) });
    }
    case "undo":
      return { ...state, selected: null, drafts: { ...state.drafts, [state.role]: undoHistory(h) } };
    case "redo":
      return { ...state, selected: null, drafts: { ...state.drafts, [state.role]: redoHistory(h) } };
  }
}

export function useDashboardEditor(initial: DashboardSettings) {
  const [state, dispatch] = useReducer(reduce, initial, (init): State => ({
    role: "owner",
    editing: false,
    selected: null,
    drafts: Object.fromEntries(BUNDLES.map((b) => [b, startHistory(roleItems(init, b))])) as Record<Bundle, History>,
  }));
  const items = state.drafts[state.role].present;
  const payload: DashboardSettings = useMemo(
    () => ({ version: DASHBOARD_VERSION, layouts: BUNDLES.map((role) => ({ role, items: state.drafts[role].present })) }),
    [state.drafts],
  );
  /** 역할마다: 기본을 쓰는가 · 저장된 값과 다른가(저장 안 한 편집). */
  const status = useMemo(
    () =>
      Object.fromEntries(
        BUNDLES.map((b) => [
          b,
          { isDefault: sameItems(state.drafts[b].present, defaultItems(b)), dirty: !sameItems(state.drafts[b].present, roleItems(initial, b)) },
        ]),
      ) as Record<Bundle, { isDefault: boolean; dirty: boolean }>,
    [state.drafts, initial],
  );
  return {
    ...state,
    items,
    payload,
    status,
    canUndo: canUndo(state.drafts[state.role]),
    canRedo: canRedo(state.drafts[state.role]),
    setRole: useCallback((role: Bundle) => dispatch({ type: "role", role }), []),
    setEditing: useCallback((on: boolean) => dispatch({ type: "editing", on }), []),
    select: useCallback((id: string | null) => dispatch({ type: "select", id }), []),
    commit: useCallback((next: Item[]) => dispatch({ type: "commit", role: state.role, items: next }), [state.role]),
    restore: useCallback((role: Bundle, item: Item, index: number) => dispatch({ type: "restore", role, item, index }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    draftOf: (b: Bundle) => state.drafts[b].present,
  };
}

export type DashboardEditor = ReturnType<typeof useDashboardEditor>;
