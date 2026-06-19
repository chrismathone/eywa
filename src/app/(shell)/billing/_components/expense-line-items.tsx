"use client";

import { Plus, Trash2 } from "lucide-react";

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

const KRW = new Intl.NumberFormat("ko-KR");
export const lineTotal = (r: ExpenseItemRow) =>
  Math.round(r.quantity * r.unitPrice * (r.vat ? 1.1 : 1));

const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

export function ExpenseLineItems({
  rows,
  onChange,
}: {
  rows: ExpenseItemRow[];
  onChange: (rows: ExpenseItemRow[]) => void;
}) {
  const setRow = (i: number, patch: Partial<ExpenseItemRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () =>
    onChange([...rows, { purpose: "", vendor: "", description: "", quantity: 1, unitPrice: 0, vat: false }]);
  const removeRow = (i: number) =>
    onChange(rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows);

  return (
    <div className="space-y-2">
      <span className="text-foreground block text-sm font-medium">지출 항목</span>
      <div className="space-y-2.5">
        {rows.map((r, i) => (
          <div key={i} className="border-line bg-bg-soft/40 space-y-1.5 rounded-md border p-2.5">
            <div className="flex items-center justify-between">
              <span className="micro">No.{i + 1}</span>
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="text-text-faint hover:text-danger shrink-0"
                aria-label="항목 삭제"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                value={r.purpose}
                onChange={(e) => setRow(i, { purpose: e.target.value })}
                placeholder="용도"
                className={inputCls}
              />
              <input
                value={r.vendor}
                onChange={(e) => setRow(i, { vendor: e.target.value })}
                placeholder="거래처"
                className={inputCls}
              />
            </div>
            <input
              value={r.description}
              onChange={(e) => setRow(i, { description: e.target.value })}
              placeholder="사용내역"
              className={inputCls}
            />
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="1"
                value={r.quantity}
                onChange={(e) => setRow(i, { quantity: Number(e.target.value) || 0 })}
                className={`${inputCls} num w-16 text-right`}
                aria-label="수량"
              />
              <input
                type="number"
                min="0"
                step="1000"
                value={r.unitPrice}
                onChange={(e) => setRow(i, { unitPrice: Number(e.target.value) || 0 })}
                className={`${inputCls} num flex-1 text-right`}
                aria-label="금액"
              />
              <button
                type="button"
                onClick={() => setRow(i, { vat: !r.vat })}
                className={`shrink-0 rounded-sm border px-2 py-1.5 text-[11px] transition ${
                  r.vat ? "border-primary bg-primary-soft text-primary" : "border-line text-text-faint"
                }`}
                title="부가세 10% 포함"
              >
                VAT
              </button>
            </div>
            <p className="text-text-dim text-right text-[11px]">
              총액 <span className="num text-foreground font-semibold">{KRW.format(lineTotal(r))}원</span>
              {r.vat ? <span className="text-text-faint"> (VAT포함)</span> : null}
            </p>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs transition"
      >
        <Plus className="size-3" /> 항목 추가
      </button>
    </div>
  );
}
