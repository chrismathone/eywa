"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { AlertCircle, ArrowRight, Check, Loader2, UserCog, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  applyHandover,
  cancelHandover,
  scheduleHandover,
  type HandoverState,
} from "@/features/classes/server/actions";

const inputCls =
  "border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

type TeacherOption = { id: string; name: string; hint?: string };

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      예약
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
  const today = kstToday();

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      {/* ⚠️ overflow-y-auto/max-h를 두지 않는다 — SearchableSelect 팝업(absolute)이 잘린다(EnrollmentAssignDialog 패턴). 폼이 짧아 뷰포트 넘칠 일 없음. */}
      <div className="bg-background border-border w-full max-w-md rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <h2 className="text-foreground text-lg font-semibold">강사 인수인계 예약</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="classId" value={classId} />
          <p className="text-muted-foreground text-xs">
            현재 담임 <span className="text-foreground font-medium">{currentTeacherName ?? "미정"}</span> →
            새 담임으로 교체를 예약합니다. 적용일에 <span className="text-foreground">지금 적용</span> 버튼으로 반영됩니다.
          </p>

          <div className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">새 담임 *</span>
            <SearchableSelect
              name="newTeacherId"
              options={teacherOptions.map((t) => ({ value: t.id, label: t.name, hint: t.hint }))}
              placeholder="강사 선택"
              searchPlaceholder="이름으로 검색..."
              ariaLabel="새 담임 강사"
            />
            <p className="text-text-faint text-xs">
              이 반 과목 담당 강사가 위에 표시됩니다. 신입·타 과목 강사도 이름으로 검색해 선택할 수 있어요.
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-foreground block text-sm font-medium">적용일 *</span>
            <input name="effectiveDate" type="date" min={today} defaultValue={today} className={`${inputCls} num`} />
          </label>

          <label className="block space-y-1.5">
            <span className="text-foreground block text-sm font-medium">사유 메모</span>
            <textarea name="reason" rows={2} className={`${inputCls} resize-y`} placeholder="선택" />
          </label>

          {state?.error ? (
            <p className="text-danger inline-flex items-center gap-1.5 text-sm">
              <AlertCircle className="size-4" />
              {state.error}
            </p>
          ) : null}

          <div className="border-border flex items-center justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              취소
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
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserCog className="size-4" />
        강사 인수인계
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
          ? "bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50"
          : "border-border text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
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

  return (
    <div className="border-primary/30 bg-primary-soft/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="min-w-0">
        <p className="text-primary inline-flex items-center gap-1.5 text-[13px] font-bold">
          <UserCog className="size-4" />
          강사 인수인계 예약됨
          {due ? (
            <span className="bg-primary text-primary-foreground ml-1 rounded px-1.5 py-0.5 text-[10px]">
              적용일 도달
            </span>
          ) : null}
        </p>
        <p className="text-foreground mt-1 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium">{currentTeacherName ?? "미정"}</span>
          <ArrowRight className="text-text-faint size-3.5" />
          <span className="text-primary font-semibold">{pendingTeacherName ?? "—"}</span>
          {pendingDate ? <span className="text-text-dim num text-xs">· 적용일 {pendingDate}</span> : null}
        </p>
        {reason ? <p className="text-text-dim mt-0.5 text-xs">{reason}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <form action={applyAction}>
          <input type="hidden" name="classId" value={classId} />
          <MiniSubmit label="지금 적용" tone="primary" />
        </form>
        <form action={cancelAction}>
          <input type="hidden" name="classId" value={classId} />
          <MiniSubmit label="예약 취소" tone="ghost" />
        </form>
      </div>
    </div>
  );
}
