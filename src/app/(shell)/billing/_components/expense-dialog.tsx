"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { AlertCircle, Loader2, Save, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import {
  createExpense,
  updateExpense,
  type ExpenseState,
} from "@/features/billing/server/expense-actions";
import type { ExpenseRow } from "@/features/billing/server/expense-queries";
import { DEFAULT_CURRENCY, formatMoney, roundMoney } from "@/features/billing/currencies";
import { ExpenseLineItems, lineTotal, type ExpenseItemRow } from "./expense-line-items";
import { Field } from "@/components/form-field";

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

  // 로컬 초안 자동저장 — 입력 중 IDB 보관, 다시 열면 복구 배너. 실제 저장(서버 커밋)은 그대로.
  // DOM 필드(제목·작성자·메모 등)는 자동 캡처/복원, 컨트롤드 state(라인아이템·통화)는 onRestore로 rehydrate.
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useFormDraft({
    scope: expense ? `expense:${expense.id}` : "expense:new",
    formRef,
    // 항상 기본값이 채워지는 필드(분류/일자/합계/통화)는 "의미 있는 입력" 판정에서 제외(빈 폼 오탐 배너 방지).
    ignoreForBanner: ["category", "expenseDate", "amount", "currency"],
    onRestore: (values) => {
      if (values.currency) setCurrency(values.currency);
      const raw = values.lineItems?.trim();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRows(
            parsed.map((r) => {
              const o = (r ?? {}) as Partial<ExpenseItemRow>;
              return {
                purpose: String(o.purpose ?? ""),
                vendor: String(o.vendor ?? ""),
                description: String(o.description ?? ""),
                quantity: Number(o.quantity) || 1,
                unitPrice: Number(o.unitPrice) || 0,
                vat: Boolean(o.vat),
              };
            }),
          );
        }
      } catch {
        /* 파싱 실패 무시 — DOM 필드는 이미 복원됨 */
      }
    },
  });

  // amount와 line_items는 동일한 "유효 행" 집합에서 도출(불일치 방지).
  const filteredRows = rows.filter(
    (r) => r.purpose.trim() || r.vendor.trim() || r.description.trim() || r.unitPrice !== 0, // 음수 금액 줄도 유효(2026-10-26)
  );
  // 합계도 통화 정밀도로 한 번 더 반올림 — 센트 단위 라인을 더하면 부동소수 꼬리($0.30000000000000004)가 붙는다.
  const amount = roundMoney(
    filteredRows.reduce((s, r) => s + lineTotal(r, currency), 0),
    currency,
  );

  // 성공(ok:true) 시 초안 비우고 닫기(다음 열기 때 stale 복구 방지). 다이얼로그는 성공 시 부모가
  // 언마운트(조건부 마운트)하므로 이 마이크로태스크는 사실상 1회 실행 — clear/onClose 모두 멱등이라 안전.
  if (state?.ok) {
    queueMicrotask(() => {
      draft.clear();
      onClose(true);
    });
  }

  // 항목이 없으면 빈 문자열(초안 판정에서 "의미 없음"). 액션 parse()는 ""·"[]" 둘 다 null 처리(동치).
  const lineItemsJson = filteredRows.length
    ? JSON.stringify(filteredRows.map((r) => ({ ...r, total: lineTotal(r, currency) })))
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">{editing ? "지출 수정" : "지출 등록"}</p>
            <h2 className="text-foreground mt-1 text-lg font-bold">
              {editing ? expense.title : "새 지출결의서"}
            </h2>
          </div>
          <button type="button" onClick={() => onClose(false)} className="text-text-dim hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>

        <form ref={formRef} action={formAction} className="space-y-4">
          <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
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
                defaultValue={expense?.expenseDate ?? kstToday()}
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
            <span className="text-foreground num font-bold">{formatMoney(amount, currency)}</span>
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
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

