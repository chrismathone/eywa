"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createExpense,
  updateExpense,
  type ExpenseState,
} from "@/features/billing/server/expense-actions";
import type { ExpenseRow } from "@/features/billing/server/expense-queries";

const CATEGORIES = ["인건비", "운영비", "매입", "마케팅", "기타"];
const PAYMENTS = ["카드", "현금", "계좌이체", "법인카드"];
const KRW = new Intl.NumberFormat("ko-KR");

type Row = { description: string; quantity: number; unitPrice: number; vat: boolean };
const lineTotal = (r: Row) => Math.round(r.quantity * r.unitPrice * (r.vat ? 1.1 : 1));

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

export function ExpenseDialog({
  expense,
  onClose,
}: {
  expense: ExpenseRow | null;
  onClose: (saved: boolean) => void;
}) {
  const editing = !!expense;
  const [state, formAction] = useActionState<ExpenseState, FormData>(
    editing ? updateExpense : createExpense,
    undefined,
  );

  const [rows, setRows] = useState<Row[]>(() =>
    expense?.lineItems?.length
      ? expense.lineItems.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vat: l.vat,
        }))
      : [{ description: expense?.title ?? "", quantity: 1, unitPrice: expense?.amount ?? 0, vat: false }],
  );
  const amount = rows.reduce((s, r) => s + lineTotal(r), 0);

  // 성공(ok:true) 시 닫기
  if (state?.ok) {
    queueMicrotask(() => onClose(true));
  }

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const lineItemsJson = JSON.stringify(
    rows
      .filter((r) => r.description.trim() || r.unitPrice > 0)
      .map((r) => ({ ...r, total: lineTotal(r) })),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">{editing ? "지출 수정" : "지출 등록"}</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">
              {editing ? expense.title : "새 지출"}
            </h2>
          </div>
          <button type="button" onClick={() => onClose(false)} className="text-text-dim hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-4">
          {editing ? <input type="hidden" name="id" value={expense.id} /> : null}
          <input type="hidden" name="lineItems" value={lineItemsJson} />
          <input type="hidden" name="amount" value={amount} />

          <Field label="항목명" error={state?.fieldErrors?.title}>
            <input name="title" defaultValue={expense?.title ?? ""} className={inputCls} placeholder="예: 6월 운영비 정산" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="분류">
              <select name="category" defaultValue={expense?.category ?? "운영비"} className={inputCls}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="지출일" error={state?.fieldErrors?.expenseDate}>
              <input
                name="expenseDate"
                type="date"
                defaultValue={expense?.expenseDate ?? new Date().toISOString().slice(0, 10)}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="거래처">
              <input name="vendor" defaultValue={expense?.vendor ?? ""} className={inputCls} placeholder="선택" />
            </Field>
            <Field label="결제수단">
              <select name="paymentMethod" defaultValue={expense?.paymentMethod ?? ""} className={inputCls}>
                <option value="">선택</option>
                {PAYMENTS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* 항목(line items) */}
          <div className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">항목</span>
            <div className="space-y-1.5">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    value={r.description}
                    onChange={(e) => setRow(i, { description: e.target.value })}
                    placeholder="내역"
                    className={`${inputCls} flex-1`}
                  />
                  <input
                    type="number"
                    min="1"
                    value={r.quantity}
                    onChange={(e) => setRow(i, { quantity: Number(e.target.value) || 0 })}
                    className={`${inputCls} num w-14 text-right`}
                    aria-label="수량"
                  />
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={r.unitPrice}
                    onChange={(e) => setRow(i, { unitPrice: Number(e.target.value) || 0 })}
                    className={`${inputCls} num w-24 text-right`}
                    aria-label="단가"
                  />
                  <button
                    type="button"
                    onClick={() => setRow(i, { vat: !r.vat })}
                    className={`shrink-0 rounded-sm border px-1.5 py-1 text-[11px] transition ${
                      r.vat ? "border-primary bg-primary-soft text-primary" : "border-line text-text-faint"
                    }`}
                    title="부가세 10%"
                  >
                    VAT
                  </button>
                  <button
                    type="button"
                    onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))}
                    className="text-text-faint hover:text-danger shrink-0"
                    aria-label="행 삭제"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, { description: "", quantity: 1, unitPrice: 0, vat: false }])}
              className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs transition"
            >
              <Plus className="size-3" /> 항목 추가
            </button>
          </div>

          <div className="border-line bg-bg-soft/40 flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span className="text-text-dim">합계</span>
            <span className="text-foreground num font-semibold">{KRW.format(amount)}원</span>
          </div>
          {state?.fieldErrors?.amount ? <p className="text-danger text-xs">{state.fieldErrors.amount}</p> : null}

          <Field label="메모">
            <textarea name="memo" defaultValue={expense?.memo ?? ""} rows={2} className={`${inputCls} resize-y`} placeholder="선택" />
          </Field>

          {state?.error ? (
            <p className="text-danger bg-danger-soft border-danger/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
              <AlertCircle className="size-4" />
              {state.error}
            </p>
          ) : null}

          <div className="border-line flex items-center justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => onClose(false)}>취소</Button>
            <SubmitBtn />
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-foreground block text-sm font-medium">{label}</span>
      {children}
      {error ? <p className="text-danger text-xs">{error}</p> : null}
    </div>
  );
}
