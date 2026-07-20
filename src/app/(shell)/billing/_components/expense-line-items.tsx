"use client";

import { Copy, Plus, Trash2 } from "@/components/icons/eywa-icon-compat";
import { CURRENCIES, formatMoney, moneyStep, roundMoney } from "@/features/billing/currencies";

// 지출결의서 라인아이템 편집기 — ijw 패리티(용도/거래처/사용내역/수량/금액/부가세).
// 상태는 부모(다이얼로그)가 소유; 이 컴포넌트는 렌더 + onChange만. 좁은 창에 맞춰 줄 단위로 접는다.
export type ExpenseItemRow = {
  purpose: string;
  vendor: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vat: boolean;
};

// 라인 총액 — 반올림은 통화 정밀도로(₩는 정수, $는 센트). 통화 없이 Math.round하면 $10.6이 $11이 된다.
export const lineTotal = (r: ExpenseItemRow, currency: string) =>
  roundMoney(r.quantity * r.unitPrice * (r.vat ? 1.1 : 1), currency);

// ⚠️ 폭(w-*)은 여기 넣지 않는다 — 사용처에서 w-full/flex-1 등을 붙일 때 Tailwind width 충돌이 나기 때문.
const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

export function ExpenseLineItems({
  rows,
  onChange,
  currency,
  onCurrencyChange,
}: {
  rows: ExpenseItemRow[];
  onChange: (rows: ExpenseItemRow[]) => void;
  currency: string;
  onCurrencyChange: (code: string) => void;
}) {
  const setRow = (i: number, patch: Partial<ExpenseItemRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () =>
    onChange([...rows, { purpose: "", vendor: "", description: "", quantity: 1, unitPrice: 0, vat: false }]);
  const removeRow = (i: number) =>
    onChange(rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows);
  // 개별 항목 복사 — 바로 아래에 동일 내용 행 삽입(반복 입력 편의).
  const duplicateRow = (i: number) =>
    onChange([...rows.slice(0, i + 1), { ...rows[i] }, ...rows.slice(i + 1)]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground block text-sm font-medium">지출 항목</span>
        {/* 통화 선택(지출결의서당 단일 통화) — ijw 패리티 */}
        <select
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value)}
          className="border-line bg-background text-foreground rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
          aria-label="통화"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.symbol} {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2.5">
        {rows.map((r, i) => (
          <div key={i} className="border-line bg-bg-soft/40 space-y-1.5 rounded-md border p-2.5">
            <div className="flex items-center justify-between">
              <span className="micro">No.{i + 1}</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => duplicateRow(i)}
                  className="text-text-faint hover:text-blue shrink-0"
                  aria-label="항목 복사"
                  title="이 항목을 복사"
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="text-text-faint hover:text-danger shrink-0"
                  aria-label="항목 삭제"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                value={r.purpose}
                onChange={(e) => setRow(i, { purpose: e.target.value })}
                placeholder="용도"
                className={`${inputCls} w-full`}
              />
              <input
                value={r.vendor}
                onChange={(e) => setRow(i, { vendor: e.target.value })}
                placeholder="거래처"
                className={`${inputCls} w-full`}
              />
            </div>
            <input
              value={r.description}
              onChange={(e) => setRow(i, { description: e.target.value })}
              placeholder="사용내역"
              className={`${inputCls} w-full`}
            />
            <div className="flex items-center gap-1.5">
              <label className="text-text-faint flex shrink-0 items-center gap-1 text-[11px]">
                수량
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={r.quantity || ""}
                  onChange={(e) => setRow(i, { quantity: Number(e.target.value) || 0 })}
                  placeholder="1"
                  className={`${inputCls} num w-14 text-right`}
                  aria-label="수량"
                />
              </label>
              <label className="text-text-faint flex min-w-0 flex-1 items-center gap-1 text-[11px]">
                금액
                <input
                  type="number"
                  min="0"
                  step={moneyStep(currency)}
                  value={r.unitPrice || ""}
                  onChange={(e) => setRow(i, { unitPrice: Number(e.target.value) || 0 })}
                  placeholder="0"
                  className={`${inputCls} num w-full min-w-0 flex-1 text-right`}
                  aria-label="금액"
                />
              </label>
              <button
                type="button"
                onClick={() => setRow(i, { vat: !r.vat })}
                className={`shrink-0 rounded-full border px-2 py-1.5 text-[11px] transition ${
                  r.vat ? "border-primary bg-primary-soft text-primary" : "border-line text-text-faint"
                }`}
                title="부가세 10% 포함"
              >
                VAT
              </button>
            </div>
            <p className="text-text-dim text-right text-[11px]">
              총액 <span className="num text-foreground font-bold">{formatMoney(lineTotal(r, currency), currency)}</span>
              {r.vat ? <span className="text-text-faint"> (VAT포함)</span> : null}
            </p>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition"
      >
        <Plus className="size-3" /> 항목 추가
      </button>
    </div>
  );
}
