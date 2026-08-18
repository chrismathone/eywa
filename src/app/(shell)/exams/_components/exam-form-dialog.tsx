"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { AlertCircle, Loader2, Pencil, Plus, Save, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  createExam,
  updateExam,
  type ExamActionState,
} from "@/features/exams/server/actions";
import { useSubjectMaps, useGradeLevels } from "@/features/owner/operations-context";

export type ExamClassOption = { id: string; className: string; subject: string };
export type ExamScopeValue = { type: "class" | "grade" | "academy"; classIds?: string[]; grades?: string[] } | null;

const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

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
  scope?: ExamScopeValue;
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

function Dialog({
  exam,
  classOptions,
  onClose,
}: {
  exam?: ExamFormValue;
  classOptions: ExamClassOption[];
  onClose: () => void;
}) {
  const isEdit = !!exam;
  const subjects = useSubjectMaps();
  const gradeLevels = useGradeLevels();
  const [state, formAction] = useActionState<ExamActionState, FormData>(
    isEdit ? updateExam : createExam,
    undefined,
  );
  if (state?.ok) queueMicrotask(onClose);

  const today = kstToday();
  // 과목은 시험범위(반) 필터에 쓰여 상태로 — select는 name=subject로 그대로 제출.
  const [subject, setSubject] = useState(exam?.subject ?? subjects.options[0]?.value ?? "");
  const [scopeType, setScopeType] = useState<"academy" | "grade" | "class">(
    exam?.scope?.type ?? "academy",
  );
  const [classIds, setClassIds] = useState<Set<string>>(new Set(exam?.scope?.classIds ?? []));
  const [grades, setGrades] = useState<Set<string>>(new Set(exam?.scope?.grades ?? []));
  const subjectClasses = classOptions.filter((c) => c.subject === subject);
  const toggleIn = (set: Set<string>, v: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">시험 관리</p>
            <h2 className="text-foreground mt-1 text-lg font-bold">
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
              <select
                name="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={inputCls}
              >
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

          {/* 시험 범위(scope) — 전체 / 학년 / 반. ijw ExamScope 이식(school·subject는 eywa 스키마 밖이라 제외). */}
          <Field label="시험 범위">
            <input type="hidden" name="scopeType" value={scopeType} />
            <input type="hidden" name="scopeClassIds" value={[...classIds].join(",")} />
            <input type="hidden" name="scopeGrades" value={[...grades].join(",")} />
            <div className="flex gap-1.5">
              {([
                ["academy", "전체"],
                ["grade", "학년별"],
                ["class", "반별"],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setScopeType(v)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    scopeType === v
                      ? "border-primary bg-primary text-primary-foreground font-medium"
                      : "border-line text-text-dim hover:bg-bg-soft"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {scopeType === "grade" ? (
              <div className="border-line mt-2 flex flex-wrap gap-1.5 rounded-md border p-2">
                {gradeLevels.length === 0 ? (
                  <span className="text-text-faint text-xs">설정된 학년이 없습니다</span>
                ) : (
                  gradeLevels.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleIn(grades, g, setGrades)}
                      className={`rounded-full border px-2 py-0.5 text-xs transition ${
                        grades.has(g)
                          ? "border-primary bg-primary-soft text-primary font-medium"
                          : "border-line text-text-dim hover:bg-bg-soft"
                      }`}
                    >
                      {g}
                    </button>
                  ))
                )}
              </div>
            ) : null}
            {scopeType === "class" ? (
              <div className="border-line mt-2 max-h-32 overflow-y-auto rounded-md border p-2">
                {subjectClasses.length === 0 ? (
                  <span className="text-text-faint text-xs">해당 과목의 반이 없습니다</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {subjectClasses.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleIn(classIds, c.id, setClassIds)}
                        className={`rounded-full border px-2 py-0.5 text-xs transition ${
                          classIds.has(c.id)
                            ? "border-primary bg-primary-soft text-primary font-medium"
                            : "border-line text-text-dim hover:bg-bg-soft"
                        }`}
                      >
                        {c.className}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </Field>

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
            <p className="text-danger bg-danger-soft border-danger/20 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm">
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

/** 시험 등록 버튼(목록 헤더) — 클릭 시 생성 다이얼로그. classOptions=시험범위(반별) 선택지. */
export function CreateExamTrigger({ classOptions = [] }: { classOptions?: ExamClassOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        시험 등록
      </Button>
      {open ? <Dialog classOptions={classOptions} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** 시험 수정 버튼(상세 헤더) — 클릭 시 수정 다이얼로그. */
export function EditExamTrigger({
  exam,
  classOptions = [],
}: {
  exam: ExamFormValue;
  classOptions?: ExamClassOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
        수정
      </Button>
      {open ? <Dialog exam={exam} classOptions={classOptions} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
