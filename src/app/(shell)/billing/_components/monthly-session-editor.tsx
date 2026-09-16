"use client";
import { useState, useTransition } from "react";
import { updateMonthlyTermSessions } from "@/features/billing/session-terms/server/monthly-sessions";
import { useSessionTermsState } from "./session-terms-state";

export function MonthlySessionEditor({ id, sessions, confirmedAt, studentName }: { id: string; sessions: number; confirmedAt: string | null; studentName: string }) {
  const { apply } = useSessionTermsState();
  const [editing, setEditing] = useState(false), [value, setValue] = useState(String(sessions));
  const [error, setError] = useState<string | null>(null), [pending, start] = useTransition();
  if (!editing) return <button type="button" aria-label={`${studentName} 월 정액 시수 수정`} title="시수만 수정하며 월 금액은 유지합니다" className="text-primary font-bold underline decoration-dotted underline-offset-4" onClick={() => { setValue(String(sessions)); setError(null); setEditing(true); }}>{sessions}</button>;
  return <form className="inline-flex flex-wrap items-center justify-center gap-1" onSubmit={(e) => { e.preventDefault(); start(async () => {
    try {
      const result = await updateMonthlyTermSessions(id, value.trim() === "" ? NaN : Number(value), confirmedAt);
      if (result.error) setError(result.error);
      else if (result.terms) { apply(result.terms); setEditing(false); }
    } catch { setError("시수를 저장하지 못했습니다. 다시 시도해 주세요"); }
  }); }}>
    <input type="number" min={0} max={99} step="any" required disabled={pending} aria-label={`${studentName} 월 정액 확정 시수`} className="border-input bg-background num w-14 rounded-md border px-1 py-1 text-center text-xs" value={value} onChange={(e) => setValue(e.target.value)} />
    <button type="submit" disabled={pending} className="text-primary text-xs">저장</button><button type="button" disabled={pending} className="text-text-dim text-xs" onClick={() => setEditing(false)}>취소</button>
    {error ? <span role="alert" className="text-danger block text-xs whitespace-normal">{error}</span> : null}
  </form>;
}
