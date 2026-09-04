"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { AlertCircle, ArrowRight, Check, Loader2, UserCog, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  applyHandover,
  cancelHandover,
  scheduleHandover,
  type HandoverState,
} from "@/features/classes/server/actions";
// 강사뷰 화면 언어 — provider는 강사 미니셸·창에만 있어 관리자 풀셸은 한국어로 떨어진다.
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

const inputCls =
  "border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

type TeacherOption = { id: string; name: string; hint?: string };

function SaveBtn() {
  const { pending } = useFormStatus();
  const t = useSheetT();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      {t("cls.ho.book")}
    </Button>
  );
}

function HandoverDialog({
  classId,
  currentTeacherName,
  teacherOptions,
  onClose,
}: {
  classId: string;
  currentTeacherName: string | null;
  teacherOptions: TeacherOption[];
  onClose: () => void;
}) {
  const [state, formAction] = useActionState<HandoverState, FormData>(scheduleHandover, undefined);
  const t = useSheetT();
  const today = kstToday();

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      {/* ⚠️ overflow-y-auto/max-h를 두지 않는다 — SearchableSelect 팝업(absolute)이 잘린다(EnrollmentAssignDialog 패턴). 폼이 짧아 뷰포트 넘칠 일 없음. */}
      <div className="bg-background border-border w-full max-w-md rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <h2 className="text-foreground text-lg font-bold">{t("cls.ho.dialogTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("cls.ho.close")}
          >
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="classId" value={classId} />
          {/* 🔴 이름과 버튼 이름이 문장 가운데서 강조된다 — 그래서 **문장의 양 끝**만 사전에서 온다
              (조각을 새로 만든 게 아니라 옛 마크업의 강조를 그대로 지킨 것이다). */}
          <p className="text-muted-foreground text-xs">
            {t("cls.ho.introA")}
            <span className="text-foreground font-medium">
              {currentTeacherName ?? t("cls.ho.teacherNone")}
            </span>
            {t("cls.ho.introB")}
            <span className="text-foreground">{t("cls.ho.applyNow")}</span>
            {t("cls.ho.introC")}
          </p>

          <div className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">{t("cls.ho.newTeacher")}</span>
            <SearchableSelect
              name="newTeacherId"
              options={teacherOptions.map((t) => ({ value: t.id, label: t.name, hint: t.hint }))}
              placeholder={t("cls.ho.pickTeacher")}
              searchPlaceholder={t("cls.ho.searchName")}
              ariaLabel={t("cls.ho.newTeacherAria")}
            />
            <p className="text-text-faint text-xs">{t("cls.ho.poolHint")}</p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-foreground block text-sm font-medium">{t("cls.ho.effectiveDate")}</span>
            <input name="effectiveDate" type="date" min={today} defaultValue={today} className={`${inputCls} num`} />
          </label>

          <label className="block space-y-1.5">
            <span className="text-foreground block text-sm font-medium">{t("cls.ho.reason")}</span>
            <textarea name="reason" rows={2} className={`${inputCls} resize-y`} placeholder={t("cls.ho.optional")} />
          </label>

          {state?.error ? (
            <p className="text-danger inline-flex items-center gap-1.5 text-sm">
              <AlertCircle className="size-4" />
              {state.error}
            </p>
          ) : null}

          <div className="border-border flex items-center justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t("cls.ho.cancel")}
            </Button>
            <SaveBtn />
          </div>
        </form>
      </div>
    </div>
  );
}

/** 인수인계 예약 트리거 버튼 — 예약이 없을 때 헤더에 노출. */
export function HandoverAction({
  classId,
  currentTeacherName,
  teacherOptions,
}: {
  classId: string;
  currentTeacherName: string | null;
  teacherOptions: TeacherOption[];
}) {
  const [open, setOpen] = useState(false);
  const t = useSheetT();
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserCog className="size-4" />
        {t("cls.ho.open")}
      </Button>
      {open ? (
        <HandoverDialog
          classId={classId}
          currentTeacherName={currentTeacherName}
          teacherOptions={teacherOptions}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function MiniSubmit({ label, tone }: { label: string; tone: "primary" | "ghost" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        tone === "primary"
          ? "bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50"
          : "border-border text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs disabled:opacity-50"
      }
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : null}
      {label}
    </button>
  );
}

/** 예약된 인수인계 배너 — 적용/취소. due=적용일 도달(오늘 이하)이면 강조. */
export function HandoverBanner({
  classId,
  currentTeacherName,
  pendingTeacherName,
  pendingDate,
  reason,
  due,
}: {
  classId: string;
  currentTeacherName: string | null;
  pendingTeacherName: string | null;
  pendingDate: string | null;
  reason: string | null;
  due: boolean;
}) {
  const [, applyAction] = useActionState<HandoverState, FormData>(applyHandover, undefined);
  const [, cancelAction] = useActionState<HandoverState, FormData>(cancelHandover, undefined);
  const t = useSheetT();
  const tf = useSheetTf();

  return (
    <div className="border-primary/30 bg-primary-soft/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="min-w-0">
        <p className="text-primary inline-flex items-center gap-1.5 text-[13px] font-bold">
          <UserCog className="size-4" />
          {t("cls.ho.bannerTitle")}
          {due ? (
            <span className="bg-primary text-primary-foreground ml-1 rounded px-1.5 py-0.5 text-[10px]">
              {t("cls.ho.due")}
            </span>
          ) : null}
        </p>
        <p className="text-foreground mt-1 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium">{currentTeacherName ?? t("cls.ho.teacherNone")}</span>
          <ArrowRight className="text-text-faint size-3.5" />
          <span className="text-primary font-bold">{pendingTeacherName ?? "—"}</span>
          {pendingDate ? (
            <span className="text-text-dim num text-xs">
              {tf("cls.ho.effectiveOn", { date: pendingDate })}
            </span>
          ) : null}
        </p>
        {reason ? <p className="text-text-dim mt-0.5 text-xs">{reason}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <form action={applyAction}>
          <input type="hidden" name="classId" value={classId} />
          <MiniSubmit label={t("cls.ho.applyNow")} tone="primary" />
        </form>
        <form action={cancelAction}>
          <input type="hidden" name="classId" value={classId} />
          <MiniSubmit label={t("cls.ho.cancelBooking")} tone="ghost" />
        </form>
      </div>
    </div>
  );
}
