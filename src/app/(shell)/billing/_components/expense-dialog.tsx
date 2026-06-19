"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createExpense,
  updateExpense,
  type ExpenseState,
} from "@/features/billing/server/expense-actions";
import type { ExpenseRow } from "@/features/billing/server/expense-queries";
import { DEFAULT_CURRENCY, formatMoney } from "@/features/billing/currencies";
import { ExpenseLineItems, lineTotal, type ExpenseItemRow } from "./expense-line-items";

const CATEGORIES = ["인건비", "운영비", "매입", "마케팅", "기타"];
const PAYMENTS = ["카드결제", "현금", "계좌이체", "법인카드"];

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

  const [rows, setRows] = useState<ExpenseItemRow[]>(() =>
    expense?.lineItems?.length
      ? expense.lineItems.map((l) => ({
          purpose: l.purpose ?? "",
          vendor: l.vendor ?? "",
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vat: l.vat,
        }))
      : [
          {
            purpose: "",
            vendor: expense?.vendor ?? "",
            description: expense?.title ?? "",
            quantity: 1,
            unitPrice: expense?.amount ?? 0,
            vat: false,
          },
        ],
  );
  const [currency, setCurrency] = useState(expense?.currency ?? DEFAULT_CURRENCY);

  // amount와 line_items는 동일한 "유효 행" 집합에서 도출(불일치 방지).
  const filteredRows = rows.filter(
    (r) => r.purpose.trim() || r.vendor.trim() || r.description.trim() || r.unitPrice > 0,
  );
  const amount = filteredRows.reduce((s, r) => s + lineTotal(r), 0);

  // 성공(ok:true) 시 닫기
  if (state?.ok) {
    queueMicrotask(() => onClose(true));
  }

  const lineItemsJson = JSON.stringify(filteredRows.map((r) => ({ ...r, total: lineTotal(r) })));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">{editing ? "지출 수정" : "지출 등록"}</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">
              {editing ? expense.title : "새 지출결의서"}
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
          <input type="hidden" name="currency" value={currency} />

          <Field label="제목" error={state?.fieldErrors?.title}>
            <input name="title" defaultValue={expense?.title ?? ""} className={inputCls} placeholder="예: [고등관]타운보드 광고" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="작성자">
              <input name="author" defaultValue={expense?.author ?? ""} className={inputCls} placeholder="성명" />
            </Field>
            <Field label="직위">
              <input name="position" defaultValue={expense?.position ?? ""} className={inputCls} placeholder="예: 실장" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="부서명">
              <input name="department" defaultValue={expense?.department ?? ""} className={inputCls} placeholder="예: 운영팀" />
            </Field>
            <Field label="지출일자" error={state?.fieldErrors?.expenseDate}>
              <input
                name="expenseDate"
                type="date"
                defaultValue={expense?.expenseDate ?? new Date().toISOString().slice(0, 10)}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="분류">
              <select name="category" defaultValue={expense?.category ?? "운영비"} className={inputCls}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="정산방법">
              <select name="paymentMethod" defaultValue={expense?.paymentMethod ?? ""} className={inputCls}>
                <option value="">선택</option>
                {PAYMENTS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="은행명 / 카드명">
              <input name="bankName" defaultValue={expense?.bankName ?? ""} className={inputCls} placeholder="예: 대구은행" />
            </Field>
            <Field label="계좌번호 / 카드번호">
              <input name="accountNumber" defaultValue={expense?.accountNumber ?? ""} className={inputCls} placeholder="예: 504-10-196074-7" />
            </Field>
          </div>

          <ExpenseLineItems rows={rows} onChange={setRows} currency={currency} onCurrencyChange={setCurrency} />

          <div className="border-line bg-bg-soft/40 flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span className="text-text-dim">합계</span>
            <span className="text-foreground num font-semibold">{formatMoney(amount, currency)}</span>
          </div>
          {state?.fieldErrors?.amount ? <p className="text-danger text-xs">{state.fieldErrors.amount}</p> : null}

          <Field label="비고">
            <textarea name="memo" defaultValue={expense?.memo ?? ""} rows={2} className={`${inputCls} resize-y`} placeholder="예: 예금주 ㈜유엔아이미디어벤처" />
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
