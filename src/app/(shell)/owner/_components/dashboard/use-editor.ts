"use client";

import { useCallback, useMemo, useReducer, useState } from "react";
import { defaultItems } from "@/features/dashboard/layout/defaults";
import { insertAt, sameItems } from "@/features/dashboard/layout/engine";
import { canRedo, canUndo, pushHistory, redoHistory, startHistory, undoHistory, type History } from "@/features/dashboard/layout/history";
import { layoutKey, roleItems } from "@/features/dashboard/layout/normalize";
import { BUNDLES, DASHBOARD_VERSION, type Bundle, type DashboardSettings, type Item, type RoleLayout } from "@/features/dashboard/layout/types";

type State = { role: Bundle; subject: string | null; drafts: Record<string, History>; selected: string | null; editing: boolean };
type Action =
  | { type: "role"; role: Bundle }
  | { type: "subject"; subject: string }
  | { type: "editing"; on: boolean }
  | { type: "select"; id: string | null }
  | { type: "commit"; items: Item[]; key: string }
  | { type: "restore"; key: string; item: Item; index: number }
  | { type: "undo" | "redo" };

function reduce(state: State, a: Action): State {
  const key = layoutKey(state.role, state.subject);
  const h = state.drafts[key];
  switch (a.type) {
    case "role": return { ...state, role: a.role, selected: null };
    case "subject": return state.drafts[layoutKey("subject", a.subject)] ? { ...state, subject: a.subject, selected: null } : state;
    case "editing": return { ...state, editing: a.on, selected: a.on ? state.selected : null };
    case "select": return { ...state, selected: a.id };
    case "commit": {
      const next = pushHistory(state.drafts[a.key], a.items);
      const selected = a.key !== key ? state.selected : state.selected && a.items.some((i) => i.id === state.selected) ? state.selected : null;
      return next === state.drafts[a.key] ? state : { ...state, selected, drafts: { ...state.drafts, [a.key]: next } };
    }
    case "restore": {
      const cur = state.drafts[a.key].present;
      return cur.some((i) => i.id === a.item.id) ? state : reduce(state, { type: "commit", key: a.key, items: insertAt(cur, a.item, a.index) });
    }
    case "undo": return { ...state, selected: null, drafts: { ...state.drafts, [key]: undoHistory(h) } };
    case "redo": return { ...state, selected: null, drafts: { ...state.drafts, [key]: redoHistory(h) } };
  }
}

/**
 * 저장 기준(`base` — 처음 받은 값 또는 내가 마지막으로 저장한 값)과 달라진 배치 키. 동시 저장 때 서버는 **이 키만**
 * 덮어쓴다(mergeDashboardSave, 원장 2026-10-14) — 안 고친 역할은 그사이 다른 사람이 저장한 것이 그대로 남는다.
 */
export function touchedLayouts(drafts: Record<string, History>, base: DashboardSettings): string[] {
  return Object.entries(drafts)
    .filter(([key, h]) => {
      const subject = key.startsWith("subject:") ? key.slice(8) : null;
      return !sameItems(h.present, roleItems(base, (subject ? "subject" : key) as Bundle, subject));
    })
    .map(([key]) => key);
}

/** 역할과 과목마다 배치·이력을 따로 보관한다. 진행 중이던 조작은 원래 대상에 적용된다. */
export function useDashboardEditor(initial: DashboardSettings, subjects: readonly string[] = []) {
  const [state, dispatch] = useReducer(reduce, { initial, subjects }, ({ initial: init, subjects: keys }): State => ({
    role: "owner", subject: keys[0] ?? null, editing: false, selected: null,
    drafts: Object.fromEntries([
      ...BUNDLES.map((b) => [b, startHistory(roleItems(init, b))]),
      ...[...new Set([...keys, ...init.layouts.flatMap((l) => l.subject ? [l.subject] : [])])].map((s) => [layoutKey("subject", s), startHistory(roleItems(init, "subject", s))]),
    ]),
  }));
  // 저장 기준 = 처음 받은 값 → 내가 저장할 때마다 그 값(`markSaved`). 미저장 표시(●)와 '고친 배치'(touched)가 **같은 기준**을 본다 —
  // `initial` prop은 다른 창의 저장 뒤 재검증으로 바뀌므로 그걸 기준으로 삼으면 ●가 영영 안 지워진다(리뷰 2026-10-14).
  const [saved, setSaved] = useState(initial);
  const key = layoutKey(state.role, state.subject);
  const items = state.drafts[key].present;
  const payload: DashboardSettings = useMemo(() => ({ version: DASHBOARD_VERSION, layouts: Object.entries(state.drafts).map(([key, h]): RoleLayout =>
    key.startsWith("subject:") ? { role: "subject", subject: key.slice(8), items: h.present } : { role: key as Bundle, items: h.present }) }), [state.drafts]);
  const status = useMemo(() => Object.fromEntries(BUNDLES.map((b) => {
    const subject = b === "subject" ? state.subject : null;
    const draft = state.drafts[layoutKey(b, subject)].present;
    const dirty = b === "subject" ? Object.entries(state.drafts).some(([key, h]) => (key === "subject" || key.startsWith("subject:"))
      && !sameItems(h.present, roleItems(saved, b, key.startsWith("subject:") ? key.slice(8) : null))) : !sameItems(draft, roleItems(saved, b));
    return [b, { isDefault: sameItems(draft, defaultItems(b)), dirty }];
  })) as Record<Bundle, { isDefault: boolean; dirty: boolean }>, [state.drafts, state.subject, saved]);
  const touched = useMemo(() => touchedLayouts(state.drafts, saved), [state.drafts, saved]);
  return {
    ...state, items, payload, status, touched, canUndo: canUndo(state.drafts[key]), canRedo: canRedo(state.drafts[key]),
    markSaved: setSaved,
    setRole: useCallback((role: Bundle) => dispatch({ type: "role", role }), []),
    setSubject: useCallback((subject: string) => dispatch({ type: "subject", subject }), []),
    setEditing: useCallback((on: boolean) => dispatch({ type: "editing", on }), []),
    select: useCallback((id: string | null) => dispatch({ type: "select", id }), []),
    commit: useCallback((next: Item[]) => dispatch({ type: "commit", key, items: next }), [key]),
    restore: useCallback((role: Bundle, item: Item, index: number, subject?: string | null) => dispatch({ type: "restore", key: layoutKey(role, subject), item, index }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    draftOf: (b: Bundle) => state.drafts[layoutKey(b, state.subject)].present,
  };
}

export type DashboardEditor = ReturnType<typeof useDashboardEditor>;
