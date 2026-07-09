"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Coins, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import {
  createTuitionItem,
  updateTuitionItem,
  deleteTuitionItem,
  toggleTuitionActive,
  type TuitionCatalogActionState,
} from "@/features/billing/server/tuition-catalog-actions";
import {
  TUITION_CATEGORIES,
  DISCOUNT_CATEGORY,
  type TuitionCatalogRow,
} from "@/features/billing/tuition-catalog";

const KRW = new Intl.NumberFormat("ko-KR");
const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {label}
    </Button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-foreground block text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function TuitionDialog({ item, onClose }: { item?: TuitionCatalogRow; onClose: () => void }) {
  const isEdit = !!item;
  const [state, formAction] = useActionState<TuitionCatalogActionState, FormData>(
    isEdit ? updateTuitionItem : createTuitionItem,
    undefined,
  );
  const [delState, delAction] = useActionState<TuitionCatalogActionState, FormData>(
    deleteTuitionItem,
    undefined,
  );
  const [confirmDel, setConfirmDel] = useState(false);
  if (state?.ok || delState?.ok) queueMicrotask(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">수강료 단가표</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">
              {isEdit ? "항목 수정" : "항목 추가"}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="text-text-dim hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={item.id} /> : null}
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
            <Field label="분류">
              <select name="category" defaultValue={item?.category ?? "수학"} className={inputCls}>
                {TUITION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="항목명 *">
              <input
                name="name"
                defaultValue={item?.name ?? ""}
                placeholder="예: 중등M 정규반 (3T2H) / 형제 할인"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="단가 · 할인액">
              <input
                name="price"
                type="number"
                min="0"
                step="100"
                defaultValue={item?.price ?? 0}
                className={`${inputCls} num text-right`}
              />
            </Field>
            <Field label="비고">
              <input name="note" defaultValue={item?.note ?? ""} placeholder="시수·조건" className={inputCls} />
            </Field>
          </div>

          {state?.error ? (
            <p className="text-danger bg-danger-soft border-danger/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
              <AlertCircle className="size-4" />
              {state.error}
            </p>
          ) : null}

          <div className="border-line flex items-center justify-between border-t pt-4">
            <div>
              {isEdit && !confirmDel ? (
                <button
                  type="button"
                  onClick={() => setConfirmDel(true)}
                  className="text-text-dim hover:text-danger inline-flex items-center gap-1 text-xs"
                >
                  <Trash2 className="size-3.5" />
                  삭제
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                취소
              </Button>
              <SubmitBtn label="저장" />
            </div>
          </div>
        </form>

        {isEdit && confirmDel ? (
          <form action={delAction} className="border-line mt-3 flex items-center justify-end gap-2 border-t pt-3">
            <input type="hidden" name="id" value={item.id} />
            <span className="text-danger mr-auto text-xs">정말 삭제할까요?</span>
            <button type="button" onClick={() => setConfirmDel(false)} className="border-line rounded-md border px-2.5 py-1 text-xs">
              취소
            </button>
            <button type="submit" className="bg-danger rounded-md px-2.5 py-1 text-xs text-white">
              예, 삭제
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function ToggleActive({ id, isActive }: { id: string; isActive: boolean }) {
  const [, action] = useActionState<TuitionCatalogActionState, FormData>(toggleTuitionActive, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="next" value={String(!isActive)} />
      <button type="submit" title={isActive ? "사용 중지" : "사용 재개"}>
        <Pill color={isActive ? "primary" : "neutral"} soft={!isActive}>
          {isActive ? "사용" : "중지"}
        </Pill>
      </button>
    </form>
  );
}

export function TuitionPricesTable({ rows }: { rows: TuitionCatalogRow[] }) {
  const [open, setOpen] = useState<TuitionCatalogRow | "new" | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen("new")}>
          <Plus className="size-4" />
          항목 추가
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          image="billing"
          icon={() => <Coins size={32} strokeWidth={1.5} />}
          title="등록된 단가가 없습니다"
          description="과목 단가·할인 프리셋을 등록하면 계산기에서 골라 자동으로 채워집니다."
        />
      ) : (
        <div className="bg-card border-line shadow-card overflow-auto rounded-md border">
          <table className="w-full text-sm [&_td]:whitespace-nowrap">
            <thead className="border-line border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-4 py-3 text-left">분류</th>
                <th className="micro px-4 py-3 text-left">항목명</th>
                <th className="micro px-4 py-3 text-right">단가 · 할인액</th>
                <th className="micro px-4 py-3 text-left">상태</th>
                <th className="micro px-4 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-bg-soft/50">
                  <td className="px-4 py-2.5">
                    <Pill color={r.category === DISCOUNT_CATEGORY ? "rose" : "neutral"} soft>
                      {r.category}
                    </Pill>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-foreground text-[13px] font-bold">{r.name}</span>
                    {r.note ? <span className="text-text-faint ml-1.5 text-[11px]">{r.note}</span> : null}
                  </td>
                  <td className="text-foreground num px-4 py-2.5 text-right text-[12px] font-semibold">
                    {r.category === DISCOUNT_CATEGORY ? "−" : ""}
                    {KRW.format(r.price)}
                  </td>
                  <td className="px-4 py-2.5">
                    <ToggleActive id={r.id} isActive={r.isActive} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setOpen(r)}
                      className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition"
                    >
                      <Pencil className="size-3.5" />
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open === "new" ? <TuitionDialog onClose={() => setOpen(null)} /> : null}
      {open && open !== "new" ? <TuitionDialog item={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
