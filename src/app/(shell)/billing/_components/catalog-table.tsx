"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Pencil, Plus, Save, Trash2, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { BookText } from "@/components/icons/aywa-icon-compat";
import {
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  toggleCatalogActive,
  type CatalogActionState,
} from "@/features/billing/server/catalog-actions";
import type { CatalogRow } from "@/features/billing/server/catalog-queries";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { writeLockedPlaceholder } from "@/lib/write-lock";

const KRW = new Intl.NumberFormat("ko-KR");
const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

// 교재 학년은 초/중/고 coarse 버킷(교재 분류 축) — operations.gradeLevels(초1~고3)와 별개 고정 분류.
// catalog-panel 필터(초/중/고)와 동일 축이라 하드코딩 유지(운영 enum 아님).
const GRADES = ["", "초", "중", "고"];

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

function CatalogDialog({ item, onClose }: { item?: CatalogRow; onClose: () => void }) {
  const isEdit = !!item;
  const subjects = useSubjectMaps();
  const [state, formAction] = useActionState<CatalogActionState, FormData>(
    isEdit ? updateCatalogItem : createCatalogItem,
    undefined,
  );
  const [delState, delAction] = useActionState<CatalogActionState, FormData>(
    deleteCatalogItem,
    undefined,
  );
  const [confirmDel, setConfirmDel] = useState(false);
  if (state?.ok || delState?.ok) queueMicrotask(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">교재 단가표</p>
            <h2 className="text-foreground mt-1 text-lg font-bold">{isEdit ? "교재 수정" : "교재 추가"}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-text-dim hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={item.id} /> : null}
          <Field label="교재명 *">
            <input name="title" defaultValue={item?.title ?? ""} placeholder="예: 쎈 수학 중1-1" className={inputCls} />
          </Field>
          <Field label="단원·상세">
            <input name="bookDetail" defaultValue={item?.bookDetail ?? ""} placeholder="예: 3. 함수" className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="학년">
              <select name="gradeLevel" defaultValue={item?.gradeLevel ?? ""} className={inputCls}>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g || "—"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="과목">
              <select name="subject" defaultValue={item?.subject ?? ""} className={inputCls}>
                <option value="">—</option>
                {subjects.options.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="출판사">
              <input name="publisher" defaultValue={item?.publisher ?? ""} className={inputCls} />
            </Field>
            <Field label="단가">
              <input
                name="price"
                type="number"
                min="0"
                step="100"
                defaultValue={item?.price ?? 0}
                className={`${inputCls} num text-right`}
              />
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
            <button type="button" onClick={() => setConfirmDel(false)} className="border-line rounded-lg border px-2.5 py-1 text-xs">
              취소
            </button>
            <button type="submit" className="bg-danger rounded-lg px-2.5 py-1 text-xs text-white">
              예, 삭제
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function ToggleActive({ id, isActive, disabled }: { id: string; isActive: boolean; disabled: boolean }) {
  const [, action] = useActionState<CatalogActionState, FormData>(toggleCatalogActive, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="next" value={String(!isActive)} />
      {/* 읽기 권한이면 바로 저장되는 토글이라 비활성 + 안내(원장 2026-11-05). */}
      <button
        type="submit"
        disabled={disabled}
        className="disabled:cursor-not-allowed"
        title={disabled ? writeLockedPlaceholder("billing") : isActive ? "사용 중지" : "사용 재개"}
      >
        <Pill color={isActive ? "primary" : "neutral"} soft={!isActive}>
          {isActive ? "사용" : "중지"}
        </Pill>
      </button>
    </form>
  );
}

export function CatalogTable({
  rows,
  toolbar,
  canManage,
}: {
  rows: CatalogRow[];
  /**
   * 교재 추가·수정·삭제·사용 토글을 세울지 — 서버 패널이 액션과 **같은 판정**(canManageTenant billing = full)으로 정한 값.
   * 읽기 권한이면 추가·수정 단추는 그리지 않고 사용 토글은 비활성(원장 2026-11-05).
   */
  canManage: boolean;
  /**
   * '교재 추가' 버튼과 **한 행**을 나눠 쓸 결과 줄·필터 — 서버 패널이 넘긴다(원장 2026-09-22 *"넓은 화면까지 2행일 필요가
   * 없어보임"* — 종전엔 결과·필터 줄 아래에 버튼 하나만 선 둘째 줄이 있었다). 수강료 단가표의 `summary`와 같은 모양.
   */
  toolbar?: ReactNode;
}) {
  const subjects = useSubjectMaps();
  const [open, setOpen] = useState<CatalogRow | "new" | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">{toolbar}</div>
        {canManage ? (
          <Button size="sm" onClick={() => setOpen("new")}>
            <Plus className="size-4" />
            교재 추가
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          image="documents"
          icon={() => <BookText size={32} strokeWidth={1.8} />}
          title="등록된 교재가 없습니다"
          description={canManage ? "표준 교재·단가를 등록해두면 교재 신청 시 자동으로 채워집니다." : undefined}
        />
      ) : (
        <DragScrollArea className="bg-card shadow-card rounded-2xl">
          <table className="w-full text-sm [&_td]:whitespace-nowrap">
            <thead className="border-line text-text-dim border-b text-sm [&_th]:font-bold [&_th]:whitespace-nowrap">
              <tr>
                <th className="px-4 py-3 text-left">교재명</th>
                <th className="px-4 py-3 text-left">학년</th>
                <th className="px-4 py-3 text-left">과목</th>
                <th className="px-4 py-3 text-left">출판사</th>
                <th className="px-4 py-3 text-right">단가</th>
                <th className="px-4 py-3 text-left">상태</th>
                {canManage ? <th className="px-4 py-3 text-right">관리</th> : null}
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-bg-soft/50">
                  <td className="px-4 py-2.5">
                    <span className="text-foreground text-sm font-bold">{r.title}</span>
                    {r.syncAddedAt ? <MakeeduOriginTag className="ml-1.5" /> : null}
                    {r.bookDetail ? <span className="text-text-faint ml-1.5 text-xs">{r.bookDetail}</span> : null}
                  </td>
                  <td className="text-text-dim px-4 py-2.5 text-xs">{r.gradeLevel ?? "—"}</td>
                  <td className="text-text-dim px-4 py-2.5 text-xs">
                    {r.subject ? subjects.labelOf(r.subject) : "—"}
                  </td>
                  <td className="text-text-dim px-4 py-2.5 text-xs">{r.publisher ?? "—"}</td>
                  <td className="text-foreground num px-4 py-2.5 text-right text-xs font-bold">
                    {KRW.format(r.price)}
                  </td>
                  <td className="px-4 py-2.5">
                    <ToggleActive id={r.id} isActive={r.isActive} disabled={!canManage} />
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setOpen(r)}
                        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition"
                      >
                        <Pencil className="size-3.5" />
                        수정
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </DragScrollArea>
      )}

      {canManage && open === "new" ? <CatalogDialog onClose={() => setOpen(null)} /> : null}
      {canManage && open && open !== "new" ? <CatalogDialog item={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
