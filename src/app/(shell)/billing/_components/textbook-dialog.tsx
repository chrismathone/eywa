"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  createTextbookOrder,
  updateTextbookOrder,
  type TextbookState,
} from "@/features/billing/server/textbook-actions";
import type { StudentOption, TextbookOrderRow } from "@/features/billing/server/textbook-queries";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

export function TextbookDialog({
  order,
  students,
  catalog,
  onClose,
}: {
  order: TextbookOrderRow | null;
  students: StudentOption[];
  catalog: CatalogOption[];
  onClose: (saved: boolean) => void;
}) {
  const editing = !!order;
  const [state, formAction] = useActionState<TextbookState, FormData>(
    editing ? updateTextbookOrder : createTextbookOrder,
    undefined,
  );
  // 교재명·상세·금액은 '교재 검색'(단가표) 선택으로 자동 채워지므로 controlled.
  const [bookName, setBookName] = useState(order?.bookName ?? "");
  const [bookDetail, setBookDetail] = useState(order?.bookDetail ?? "");
  const [price, setPrice] = useState<number | string>(order?.price ?? 0);

  if (state?.ok) {
    queueMicrotask(() => onClose(true));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">{editing ? "교재신청 수정" : "교재신청 등록"}</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">
              {editing ? order.bookName : "새 교재신청"}
            </h2>
          </div>
          <button type="button" onClick={() => onClose(false)} className="text-text-dim hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-4">
          {editing ? <input type="hidden" name="id" value={order.id} /> : null}

          {catalog.length > 0 ? (
            <Field label="교재 검색 (단가표에서 불러오기)">
              <SearchableSelect
                options={catalog.map((c) => ({
                  value: c.id,
                  label: c.title,
                  hint: c.bookDetail ?? undefined,
                }))}
                placeholder="단가표에서 선택..."
                searchPlaceholder="교재명 검색..."
                onValueChange={(id) => {
                  const c = catalog.find((x) => x.id === id);
                  if (c) {
                    setBookName(c.title);
                    setBookDetail(c.bookDetail ?? "");
                    setPrice(c.price);
                  }
                }}
              />
            </Field>
          ) : null}

          <Field label="교재명" error={state?.fieldErrors?.bookName}>
            <input
              name="bookName"
              value={bookName}
              onChange={(e) => setBookName(e.target.value)}
              className={inputCls}
              placeholder="예: 가우스 중2-1 1권"
            />
          </Field>
          <Field label="상세 (단원 등)">
            <input
              name="bookDetail"
              value={bookDetail}
              onChange={(e) => setBookDetail(e.target.value)}
              className={inputCls}
              placeholder="선택"
            />
          </Field>

          <Field label="학생">
            <SearchableSelect
              name="studentId"
              defaultValue={order?.studentId ?? ""}
              options={students.map((s) => ({ value: s.id, label: s.name, hint: s.grade ?? undefined }))}
              placeholder="학생 선택..."
              searchPlaceholder="학생 이름 검색..."
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="강사">
              <input name="teacherName" defaultValue={order?.teacherName ?? ""} className={inputCls} placeholder="선택" />
            </Field>
            <Field label="신청일">
              <input
                name="requestDate"
                type="date"
                defaultValue={order?.requestDate ?? new Date().toISOString().slice(0, 10)}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="금액">
            <input
              name="price"
              type="number"
              min="0"
              step="500"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`${inputCls} num text-right`}
            />
          </Field>

          <Field label="메모">
            <textarea name="notes" rows={2} defaultValue={order?.notes ?? ""} className={`${inputCls} resize-y`} placeholder="선택" />
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
