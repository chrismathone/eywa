"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { SessionTermPatch } from "@/features/billing/session-terms/server/actions";
import type { SessionTermRow } from "@/features/billing/session-terms/server/queries";
import { publishRecordSaved } from "@/lib/realtime/record-channel";

const Context = createContext<{
  patches: Record<string, SessionTermPatch>;
  apply: (terms: SessionTermPatch[]) => void;
  confirmedCount: number;
} | null>(null);

/** 저장한 행만 즉시 반영한다. 새로 조회한 서버 값이 오면 이전 덮어쓰기는 비운다. */
export function SessionTermsState({ rows, children }: { rows: Pick<SessionTermRow, "id" | "confirmedSessions">[]; children: ReactNode }) {
  const [state, setState] = useState({ source: rows, patches: {} as Record<string, SessionTermPatch> });
  if (state.source !== rows) setState({ source: rows, patches: {} });
  const patches = state.source === rows ? state.patches : {};
  const confirmedCount = rows.filter((row) => (patches[row.id] ?? row).confirmedSessions !== null).length;
  function apply(terms: SessionTermPatch[]) {
    setState((current) => ({ ...current, patches: { ...current.patches, ...Object.fromEntries(terms.map((term) => [term.id, term])) } }));
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
