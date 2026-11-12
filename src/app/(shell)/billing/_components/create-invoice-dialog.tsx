"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Plus, Save, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createInvoice, type CreateInvoiceState } from "@/features/billing/server/actions";
import type { StudentOption } from "@/features/billing/server/textbook-queries";
import { Field } from "@/components/form-field";

const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

const CATEGORY_OPTIONS = [
  { value: "tuition", label: "수강료" },
  { value: "material", label: "교재" },
  { value: "exam", label: "시험" },
  { value: "other", label: "기타" },
];

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      만들기
    </Button>
  );
}

export type InvoicePrefill = { amountTotal?: number; notes?: string };

function Dialog({
  students,
  defaultPeriod,
  prefill,
  onClose,
}: {
  students: StudentOption[];
  defaultPeriod: string;
  prefill?: InvoicePrefill;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState<CreateInvoiceState, FormData>(createInvoice, undefined);
  if (state?.ok) queueMicrotask(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">수납 관리</p>
            <h2 className="text-foreground mt-1 text-lg font-bold">청구서 만들기</h2>
          </div>
          <button type="button" onClick={onClose} className="text-text-dim hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-4">
          <Field label="학생 *" error={state?.fieldErrors?.studentId}>
            <SearchableSelect
              name="studentId"
              defaultValue=""
              options={students.map((s) => ({ value: s.id, label: s.name, hint: s.grade ?? undefined }))}
              placeholder="학생 선택..."
              searchPlaceholder="학생 이름 검색..."
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="청구월 *" error={state?.fieldErrors?.period}>
              <input name="period" type="month" defaultValue={defaultPeriod} className={inputCls} />
            </Field>
            <Field label="항목">
              <select name="category" defaultValue="tuition" className={inputCls}>
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="청구액 *" error={state?.fieldErrors?.amountTotal}>
              <input name="amountTotal" type="number" min="0" step="1000" defaultValue={prefill?.amountTotal ?? 0} className={`${inputCls} num text-right`} />
            </Field>
            <Field label="할인">
              <input name="amountDiscount" type="number" min="0" step="1000" defaultValue={0} className={`${inputCls} num text-right`} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="청구일">
              <input name="billedAt" type="date" className={inputCls} />
            </Field>
            <Field label="납부 기한">
              <input name="dueDate" type="date" className={inputCls} />
            </Field>
          </div>

          <Field label="할인 사유">
            <input name="discountReason" type="text" className={inputCls} placeholder="예: 형제 할인 (선택)" />
          </Field>

          <Field label="메모">
            <textarea name="notes" rows={2} defaultValue={prefill?.notes ?? ""} className={`${inputCls} resize-y`} placeholder="선택" />
          </Field>

          {state?.error ? (
            <p className="text-danger bg-danger-soft border-danger/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
              <AlertCircle className="size-4" />
              {state.error}
            </p>
          ) : null}

          <div className="border-line flex items-center justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <SubmitBtn />
          </div>
        </form>
      </div>
    </div>
  );
}

export function CreateInvoiceTrigger({
  students,
  defaultPeriod,
  variant = "button",
  label = "청구서 만들기",
  prefill,
}: {
  students: StudentOption[];
  defaultPeriod: string;
  variant?: "button" | "outline";
  label?: string;
  /** 견적→청구 전환 등에서 청구액·메모를 미리 채워 연다(학생은 다이얼로그에서 선택). */
  prefill?: InvoicePrefill;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant === "outline" ? "outline" : "default"} onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {label}
      </Button>
      {open ? (
        <Dialog
          students={students}
          defaultPeriod={defaultPeriod}
          prefill={prefill}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
