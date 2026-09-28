"use client";

import { useState } from "react";
import { freeAllocationSaveRows, validateFreeAllocation, type FreeAllocationTerm } from "@/features/billing/session-terms/free-allocation";
import { TERM_STATE_LABEL, type TermRowState } from "@/features/billing/session-terms/month-roster";

// 수납 **자유 배분**(관리자 이상, 0279a) — 배분 창 안에서 항목별 화면 대신 선다. 원장 2026-09-21 *"총 금액(청구액)은 변하지 않는선에서
// 출결행에 다 분배"* · *"받은 돈보다 더 지급할 순 없다 · 덜 지급하는건 괜찮다"*. 처음 값은 자동 배분(부모가 넘긴 `initial`).

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export type FreePanelTerm = FreeAllocationTerm & { amount: number | null; termState?: TermRowState; enrollmentLabel?: string };

export function FreeAllocationPanel({ terms, total, initial, pending, onSave }: {
  terms: readonly FreePanelTerm[];
  /** 수업 청구액 합계 — 상한. */
  total: number;
  initial: Record<string, string>;
  pending: boolean;
  onSave: (rows: { termId: string; amount: number }[]) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>(initial);
  const rows = freeAllocationSaveRows(terms, amounts);
  const checked = validateFreeAllocation(terms, rows, total);
  const sum = rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  const left = total - sum;
  return (
    <section aria-label="자유 배분" className="my-4">
      <div className="bg-bg-soft mb-3 grid grid-cols-3 gap-2 rounded-lg p-3 text-sm">
        <div><div className="text-text-dim text-xs">수업 청구액(상한)</div><div className="num font-bold">{won(total)}</div></div>
        <div><div className="text-text-dim text-xs">배분 합계</div><div className={`num font-bold${sum > total ? " text-danger" : ""}`}>{won(sum)}</div></div>
        <div><div className="text-text-dim text-xs">남은 금액</div><div className={`num font-bold${left < 0 ? " text-danger" : ""}`}>{won(left)}</div></div>
      </div>
      <p className="text-text-dim mb-2 text-xs">수납 항목과 상관없이 반마다 금액을 적습니다. 합계는 수업 청구액(급여 기준 — 할인 전)을 넘을 수 없고, 덜 나누는 것은 괜찮습니다(남은 금액은 분배되지 않습니다). 확정한 반은 빈칸이면 0원으로 저장합니다.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-line border-b"><th className="py-2">반</th><th>확정금액</th><th className="text-right">배분금액</th></tr></thead><tbody>
        {terms.map((t) => (
          <tr key={t.id} className="border-line border-b">
            <td className="py-3 pr-3">{t.className ?? "—"}{t.confirmedSessions === null ? <span className="text-amber ml-2 text-xs">미확정</span> : null}{t.termState && t.termState !== "term" ? <span className="text-amber ml-2 text-xs" title={TERM_STATE_LABEL[t.termState].tip}>{TERM_STATE_LABEL[t.termState].label}</span> : null}{t.fullyRefunded ? <span className="text-text-dim ml-2 text-xs">전액 환불</span> : null}{t.enrollmentLabel ? <span className="text-text-dim mt-1 block text-xs">{t.enrollmentLabel}</span> : null}</td>
            <td className="num pr-3">{t.amount === null ? "—" : won(t.amount)}</td>
            <td className="py-2 text-right">
              <input aria-label={`${t.className ?? "반"} 자유 배분금액`} type="number" min="0" step="1" disabled={pending} value={amounts[t.id] ?? ""}
                placeholder={t.confirmedSessions !== null ? "0" : ""}
                onChange={(e) => setAmounts((cur) => ({ ...cur, [t.id]: e.target.value }))}
                className="border-input bg-background num w-32 rounded-md border px-2 py-1.5 text-right" />
            </td>
          </tr>
        ))}
      </tbody></table></div>
      <footer className="mt-4 flex items-center justify-between gap-4">
        <div className="text-sm">{checked.ok ? <span className="text-text-dim">{left > 0 ? `${won(left)}은 어느 반에도 나누지 않고 남깁니다.` : "청구액을 모두 나눴습니다."}</span> : <p role="alert" className="text-amber">{checked.error}</p>}</div>
        <button type="button" disabled={pending || !checked.ok} onClick={() => onSave(rows)} className="bg-primary text-primary-foreground shrink-0 rounded-md px-4 py-2 text-sm font-bold disabled:opacity-40">{pending ? "저장 중…" : "자유 배분 저장"}</button>
      </footer>
    </section>
  );
}
