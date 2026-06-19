"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Pencil, Plus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createExam,
  updateExam,
  type ExamActionState,
} from "@/features/exams/server/actions";
import { useSubjectMaps } from "@/features/owner/operations-context";

const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

const TYPE_OPTIONS = [
  { value: "weekly", label: "주간" },
  { value: "mock", label: "모의" },
  { value: "school", label: "학교" },
];

export type ExamFormValue = {
  id: string;
  name: string;
  subject: string;
  examType: string;
  examDate: string;
  maxScore: number | null;
  notes: string | null;
};

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
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

function Dialog({ exam, onClose }: { exam?: ExamFormValue; onClose: () => void }) {
  const isEdit = !!exam;
  const subjects = useSubjectMaps();
  const [state, formAction] = useActionState<ExamActionState, FormData>(
    isEdit ? updateExam : createExam,
    undefined,
  );
  if (state?.ok) queueMicrotask(onClose);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">시험 관리</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">
              {isEdit ? "시험 수정" : "시험 등록"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-dim hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={exam.id} /> : null}

          <Field label="시험명 *">
            <input
              name="name"
              defaultValue={exam?.name ?? ""}
              placeholder="예: 3월 2주차 주간테스트"
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="과목 *">
              <select name="subject" defaultValue={exam?.subject ?? subjects.options[0]?.value ?? ""} className={inputCls}>
                {subjects.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="유형">
              <select name="examType" defaultValue={exam?.examType ?? "weekly"} className={inputCls}>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="시험일 *">
              <input
                name="examDate"
                type="date"
                defaultValue={exam?.examDate ?? today}
                className={inputCls}
              />
            </Field>
            <Field label="만점">
              <input
                name="maxScore"
                type="number"
                min="0"
                step="1"
                defaultValue={exam?.maxScore ?? 100}
                className={`${inputCls} num text-right`}
              />
            </Field>
          </div>

          <Field label="메모">
            <textarea
              name="notes"
              rows={2}
              defaultValue={exam?.notes ?? ""}
              className={`${inputCls} resize-y`}
              placeholder="선택"
            />
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

/** 시험 등록 버튼(목록 헤더) — 클릭 시 생성 다이얼로그. */
export function CreateExamTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        시험 등록
      </Button>
      {open ? <Dialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** 시험 수정 버튼(상세 헤더) — 클릭 시 수정 다이얼로그. */
export function EditExamTrigger({ exam }: { exam: ExamFormValue }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition"
      >
        <Pencil className="size-3.5" />
        수정
      </button>
      {open ? <Dialog exam={exam} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
