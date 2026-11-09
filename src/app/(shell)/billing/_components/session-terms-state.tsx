"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { SessionTermPatch } from "@/features/billing/session-terms/server/actions";
import type { SessionTermRow } from "@/features/billing/session-terms/server/queries";
import { publishRecordSaved } from "@/lib/realtime/record-channel";
import { useBillingSettingsRefresh } from "@/features/billing/use-billing-settings-refresh";
import { useTermRefresh } from "./use-term-refresh";
import { toast } from "sonner";

type RowPatch = Partial<SessionTermRow> & { id: string };

const Context = createContext<{
  patches: Record<string, RowPatch>;
  apply: (terms: SessionTermPatch[]) => void;
  confirmedCount: number;
} | null>(null);

/**
 * 저장한 행만 즉시 반영한다. 새로 조회한 서버 값이 오면 이전 덮어쓰기는 비운다.
 * ⚠️ 패치는 **행 id** 키다 — 회차 행이 없던 줄(가상 id)을 확정한 응답은 실 uuid라 여기 안 붙는다. 그 경로는 액션 응답의 `created`를
 *    보고 `router.refresh()`로 새 데이터를 받는다(그때 이 패치도 비워진다).
 */
export function SessionTermsState({ rows, children }: { rows: (Pick<SessionTermRow, "id" | "confirmedSessions"> & Partial<SessionTermRow>)[]; children: ReactNode }) {
  useBillingSettingsRefresh();
  const refresh = useTermRefresh();
  const [state, setState] = useState({ source: rows, patches: {} as Record<string, RowPatch> });
  if (state.source !== rows) setState({ source: rows, patches: {} });
  const patches = state.source === rows ? state.patches : {};
  const confirmedCount = rows.filter((row) => ({ ...row, ...patches[row.id] }).confirmedSessions !== null).length;
  function apply(terms: SessionTermPatch[]) {
    // 청구서 없는 줄(`invoiceId` null)은 배분이 없어 '재확인'으로 되돌릴 것도 없다.
    const affected = new Set(rows.filter((r) => r.invoiceHasAllocations && r.invoiceId && terms.some((t) => t.id === r.id)).map((r) => r.invoiceId as string));
    setState((current) => {
      const next = { ...current.patches };
      // 재조회 전에는 예전 '배분 완료'를 확정값 변경 후에도 그대로 표시하지 않는다.
      for (const row of rows) if (row.invoiceId && affected.has(row.invoiceId)) next[row.id] = { ...next[row.id], id: row.id, allocatedAmount: null, allocationStale: true };
      for (const term of terms) next[term.id] = { ...next[term.id], ...term };
      return { ...current, patches: next };
    });
    // 받은 금액 이월 때문에 확정 시수를 자동으로 맞춘 줄(원장 2026-10-07) — 친 값과 다른 숫자가 서므로 한 번 알린다.
    const notices = terms.flatMap((term) => (term.carryNotice ? [term.carryNotice] : []));
    if (notices.length) toast.success(notices.join(" · "));
    // 이 확정으로 다음 달로 보낸 이월이 무효가 된 줄(2026-11-09) — 조용히 다음 달 실납에서 빠지지 않게 경고로.
    const warnings = terms.flatMap((term) => (term.carryWarning ? [term.carryWarning] : []));
    if (warnings.length) toast.warning(warnings.join(" · "), { duration: 15000 });
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
