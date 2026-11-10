"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Coins, Loader2, Pencil, Plus, Save, Trash2, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import {
  createTuitionItem,
  updateTuitionItem,
  deleteTuitionItem,
  setTuitionPricingMode,
  toggleTuitionActive,
  type TuitionCatalogActionState,
} from "@/features/billing/server/tuition-catalog-actions";
import {
  DISCOUNT_CATEGORY,
  PRICING_MODES,
  PRICING_MODE_EFFECT,
  type TuitionCatalogRow,
} from "@/features/billing/tuition-catalog";
import { writeLockedPlaceholder } from "@/lib/write-lock";
import { Field } from "@/components/form-field";

const KRW = new Intl.NumberFormat("ko-KR");
const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {label}
    </Button>
  );
}

function TuitionDialog({
  item,
  categories,
  onClose,
}: {
  item?: TuitionCatalogRow;
  /** 분류 선택지 — 학원설정 과목 ∪ 이미 쓰인 분류 ∪ 기타·할인(감사 D7, 서버가 넘긴다). */
  categories: string[];
  onClose: () => void;
}) {
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
      <div className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">수강료 단가표</p>
            <h2 className="text-foreground mt-1 text-lg font-bold">
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
              <select name="category" defaultValue={item?.category ?? categories[0] ?? "기타"} className={inputCls}>
                {(item?.category && !categories.includes(item.category) ? [item.category, ...categories] : categories).map((c) => (
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
            <Field label="단가 종류">
              <select
                name="pricing_mode"
                defaultValue={item ? (item.pricingMode ?? "") : "per_session"}
                className={inputCls}
              >
                {PRICING_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
                <option value="">미지정</option>
              </select>
            </Field>
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
          </div>
          {/* 단가표와 계산기가 서로 다른 말을 쓰면(여긴 '월 단가', 저긴 '월 고정') 같은 것을 두 이름으로
              배우게 된다 — 여기서 고른 종류가 **계산기에서 무엇이 되는지**를 적어 둔다. */}
          <p className="text-text-faint -mt-1 text-xs leading-snug">
            <span className="text-primary font-medium">회당 단가</span> → 계산기에서 &lsquo;회당&rsquo;(단가 ×
            시수) · <span className="font-medium">월 단가</span> → &lsquo;월 고정&rsquo;(금액을 그대로).
            <br />
            비워 두면(미지정) 계산기가 안전하게 <b>월 고정</b>으로 넣고 &lsquo;구분을 골라 주세요&rsquo;라고
            표시합니다. 회당 단가로 지정한 항목만 수납 · <span className="font-medium">회차 확정</span>의 단가
            후보로도 나타납니다.
          </p>
          <Field label="비고">
            <input name="note" defaultValue={item?.note ?? ""} placeholder="시수·조건" className={inputCls} />
          </Field>

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

/**
 * 단가 종류를 **목록에서 바로** 바꾸는 칩 묶음. 고른 것을 다시 누르면 미지정으로 되돌아간다.
 *
 * 🔴 미지정은 흐린 글씨가 아니라 **경고색**으로 둔다 — 이 화면에서 "아직 안 정한 것"이 가장 중요한
 *    정보다(계산기가 그 항목을 월 고정으로 넣고, 회당 수업이면 한 달치가 한 회차 금액으로 줄어든다).
 */
function PricingModeCell({ id, mode, disabled }: { id: string; mode: string | null; disabled: boolean }) {
  const [, action] = useActionState<TuitionCatalogActionState, FormData>(setTuitionPricingMode, undefined);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PRICING_MODES.map((m) => {
        const on = mode === m.value;
        return (
          <form key={m.value} action={action}>
            <input type="hidden" name="id" value={id} />
            {/* 켜진 것을 다시 누르면 빈 값 → 미지정으로 되돌린다(잘못 고른 값을 되돌릴 문). */}
            <input type="hidden" name="pricing_mode" value={on ? "" : m.value} />
            {/* 읽기 권한이면 바로 저장되는 칩이라 비활성 + 안내(원장 2026-11-05). */}
            <button
              type="submit"
              aria-pressed={on}
              disabled={disabled}
              title={
                disabled
                  ? `${m.label} · ${writeLockedPlaceholder("billing")}`
                  : on
                    ? `${m.label} — 다시 누르면 미지정으로`
                    : PRICING_MODE_EFFECT[m.value]
              }
              className={`shrink-0 rounded-full border px-2 py-0.5 text-xs transition disabled:cursor-not-allowed ${
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : disabled
                    ? "border-line text-text-dim"
                    : "border-line text-text-dim hover:bg-bg-soft hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          </form>
        );
      })}
      {!mode ? (
        <span className="border-amber/40 bg-amber-soft text-amber rounded-full border px-2 py-0.5 text-xs font-bold">
          미지정
        </span>
      ) : null}
    </div>
  );
}

function ToggleActive({ id, isActive, disabled }: { id: string; isActive: boolean; disabled: boolean }) {
  const [, action] = useActionState<TuitionCatalogActionState, FormData>(toggleTuitionActive, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="next" value={String(!isActive)} />
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

export function TuitionPricesTable({
  rows,
  categories,
  summary,
  canManage,
}: {
  rows: TuitionCatalogRow[];
  categories: string[];
  /**
   * 항목 추가·수정·삭제·단가 종류·사용 토글을 세울지 — 서버 패널이 tuition-catalog-actions와 **같은 판정**
   * (canManageTenant billing = full)으로 정한 값. 읽기 권한이면 추가·수정은 그리지 않고 칩·토글은 비활성(원장 2026-11-05).
   */
  canManage: boolean;
  /** 좌측에 놓을 요약(건수·페이지)과 필터·검색 — 서버 패널이 넘긴다. 이 줄과 '항목 추가'가 **한 행**을 나눠 쓴다
   *  (원장 2026-08-07: *"단가 104개·1/3 페이지 랑 항목 추가 버튼이 2개 행으로 공간차지하고 있는데 한개 행으로"* →
   *  2026-09-22 필터 줄도 같은 행으로 *"넓은화면까지 2행일 필요가 없어보임"*). */
  summary?: React.ReactNode;
}) {
  const [open, setOpen] = useState<TuitionCatalogRow | "new" | null>(null);
  // 중지 항목은 아래로 몬다 — 서버가 이미 그 순서로 주므로(is_active desc) 여기서는 **가르기만** 한다.
  const active = rows.filter((r) => r.isActive);
  const stopped = rows.filter((r) => !r.isActive);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">{summary}</div>
        {canManage ? (
          <Button size="sm" onClick={() => setOpen("new")}>
            <Plus className="size-4" />
            항목 추가
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          image="billing"
          icon={() => <Coins size={32} strokeWidth={1.8} />}
          title="등록된 단가가 없습니다"
          description={canManage ? "과목 단가·할인 프리셋을 등록하면 계산기에서 골라 자동으로 채워집니다." : undefined}
        />
      ) : (
        <DragScrollArea className="bg-card shadow-card rounded-2xl">
          <table className="w-full text-sm [&_td]:whitespace-nowrap">
            <thead className="border-line text-text-dim border-b text-sm [&_th]:font-bold [&_th]:whitespace-nowrap">
              <tr>
                <th className="px-4 py-3 text-left">분류</th>
                <th className="px-4 py-3 text-left">단가 종류</th>
                <th className="px-4 py-3 text-left">항목명</th>
                <th className="px-4 py-3 text-right">단가 · 할인액</th>
                <th className="px-4 py-3 text-left">상태</th>
                {canManage ? <th className="px-4 py-3 text-right">관리</th> : null}
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {active.map((r) => (
                <tr key={r.id} className={r.pricingMode ? "hover:bg-bg-soft/50" : "bg-amber-soft/20 hover:bg-amber-soft/30"}>
                  <td className="px-4 py-2.5">
                    <Pill color={r.category === DISCOUNT_CATEGORY ? "rose" : "neutral"} soft>
                      {r.category}
                    </Pill>
                  </td>
                  <td className="px-4 py-2.5">
                    <PricingModeCell id={r.id} mode={r.pricingMode} disabled={!canManage} />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-foreground text-sm font-bold">{r.name}</span>
                    {r.note ? <span className="text-text-faint ml-1.5 text-xs">{r.note}</span> : null}
                  </td>
                  <td className="text-foreground num px-4 py-2.5 text-right text-xs font-bold">
                    {r.category === DISCOUNT_CATEGORY ? "−" : ""}
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
            {/* ── 중지된 항목 — **아래로 몰아 섹션으로 가른다**(원장 2026-08-07). 계산기 과목·교재/기타·할인
                   picker와 수납 '회차 확정' 단가 후보 어디에도 안 나오는 것들이라, 살아 있는 목록과 섞여
                   있으면 "왜 계산기엔 없지?"가 된다. 지우진 않으므로 되살릴 수 있다는 것도 함께 적는다. ── */}
            {stopped.length ? (
              <tbody className="divide-line divide-y">
                <tr className="bg-bg-soft">
                  <td colSpan={canManage ? 6 : 5} className="px-4 py-2">
                    <span className="text-text-dim text-xs font-bold">
                      중지됨 <span className="num">{stopped.length}</span>개
                    </span>
                    <span className="text-text-faint ml-1.5 text-xs">
                      — 계산기·수납 어디에도 나오지 않습니다.
                      {canManage ? <> &lsquo;중지&rsquo;를 누르면 다시 사용합니다.</> : null}
                    </span>
                  </td>
                </tr>
                {stopped.map((r) => (
                  <tr key={r.id} className="hover:bg-bg-soft/50 opacity-60">
                    <td className="px-4 py-2.5">
                      <Pill color={r.category === DISCOUNT_CATEGORY ? "rose" : "neutral"} soft>
                        {r.category}
                      </Pill>
                    </td>
                    <td className="px-4 py-2.5">
                      <PricingModeCell id={r.id} mode={r.pricingMode} disabled={!canManage} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-foreground text-sm font-bold">{r.name}</span>
                      {r.note ? <span className="text-text-faint ml-1.5 text-xs">{r.note}</span> : null}
                    </td>
                    <td className="text-foreground num px-4 py-2.5 text-right text-xs font-bold">
                      {r.category === DISCOUNT_CATEGORY ? "−" : ""}
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
            ) : null}
          </table>
        </DragScrollArea>
      )}

      {canManage && open === "new" ? <TuitionDialog categories={categories} onClose={() => setOpen(null)} /> : null}
      {canManage && open && open !== "new" ? <TuitionDialog item={open} categories={categories} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
