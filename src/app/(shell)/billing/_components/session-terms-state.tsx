"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { SessionTermPatch } from "@/features/billing/session-terms/server/actions";
import type { SessionTermRow } from "@/features/billing/session-terms/server/queries";
import { publishRecordSaved } from "@/lib/realtime/record-channel";
import { useBillingSettingsRefresh } from "@/features/billing/use-billing-settings-refresh";
import { useTermRefresh } from "./use-term-refresh";

type RowPatch = Partial<SessionTermRow> & { id: string };

const Context = createContext<{
  patches: Record<string, RowPatch>;
  apply: (terms: SessionTermPatch[]) => void;
  confirmedCount: number;
} | null>(null);

/** 저장한 행만 즉시 반영한다. 새로 조회한 서버 값이 오면 이전 덮어쓰기는 비운다. */
export function SessionTermsState({ rows, children }: { rows: (Pick<SessionTermRow, "id" | "confirmedSessions"> & Partial<SessionTermRow>)[]; children: ReactNode }) {
  useBillingSettingsRefresh();
  const refresh = useTermRefresh();
  const [state, setState] = useState({ source: rows, patches: {} as Record<string, RowPatch> });
  if (state.source !== rows) setState({ source: rows, patches: {} });
  const patches = state.source === rows ? state.patches : {};
  const confirmedCount = rows.filter((row) => ({ ...row, ...patches[row.id] }).confirmedSessions !== null).length;
  function apply(terms: SessionTermPatch[]) {
    const affected = new Set(rows.filter((r) => r.invoiceHasAllocations && terms.some((t) => t.id === r.id)).map((r) => r.invoiceId));
    setState((current) => {
      const next = { ...current.patches };
      // 재조회 전에는 예전 '배분 완료'를 확정값 변경 후에도 그대로 표시하지 않는다.
      for (const row of rows) if (affected.has(row.invoiceId)) next[row.id] = { ...next[row.id], id: row.id, allocatedAmount: null, allocationStale: true };
      for (const term of terms) next[term.id] = { ...next[term.id], ...term };
      return { ...current, patches: next };
    });
    if (affected.size) refresh();
    publishRecordSaved("billing:session-terms");
  }
  return <Context.Provider value={{ patches, apply, confirmedCount }}>{children}</Context.Provider>;
}

export function useSessionTermsState() {
  const state = useContext(Context);
  if (!state) throw new Error("SessionTermsState가 필요합니다");
  return state;
}

export function SessionTermsConfirmedCount() {
  return <span className="num">{useSessionTermsState().confirmedCount}</span>;
}
