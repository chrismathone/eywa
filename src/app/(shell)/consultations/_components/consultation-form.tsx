"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createStudentConsultation,
  updateStudentConsultation,
  type ConsultationFormState,
} from "@/features/consultations/server/actions";
import type {
  StudentConsultationAudience,
  StudentConsultationCategory,
  StudentOption,
} from "@/features/consultations/server/queries";
import type { TeacherOption } from "@/features/students/server/queries";

type Mode = "create" | "edit";

export type ConsultationFormValue = {
  id?: string;
  studentId: string;
  counselorId: string | null;
  consultedAt: string; // ISO
  category: StudentConsultationCategory | null;
  subject: string | null;
  audience: StudentConsultationAudience | null;
  summary: string;
  followUpAction: string | null;
  followUpDate: string | null;
  followUpDone: boolean;
};

const CATEGORY_OPTIONS: { value: StudentConsultationCategory; label: string }[] = [
  { value: "general", label: "일반" },
  { value: "academic", label: "학습/성적" },
  { value: "emotional", label: "정서/심리" },
  { value: "career", label: "진로" },
  { value: "social", label: "교우관계" },
  { value: "other", label: "기타" },
];

const AUDIENCE_OPTIONS: { value: StudentConsultationAudience; label: string }[] = [
  { value: "parent", label: "학부모" },
  { value: "student", label: "학생" },
  { value: "both", label: "학부모+학생" },
];

function nowLocalIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SubmitButton({ mode }: { mode: Mode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {mode === "create" ? "등록" : "저장"}
    </Button>
  );
}

export function ConsultationForm({
  mode,
  initialValue,
  students,
  counselors,
}: {
  mode: Mode;
  initialValue?: ConsultationFormValue;
  students: StudentOption[];
  counselors: TeacherOption[];
}) {
  const action = mode === "create" ? createStudentConsultation : updateStudentConsultation;
  const [state, formAction] = useActionState<ConsultationFormState, FormData>(action, undefined);

  const v: ConsultationFormValue = initialValue ?? {
    studentId: "",
    counselorId: null,
    consultedAt: nowLocalIso(),
    category: "general",
    subject: null,
    audience: "parent",
    summary: "",
    followUpAction: null,
    followUpDate: null,
    followUpDone: false,
  };

  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      {mode === "edit" && initialValue?.id ? (
        <input type="hidden" name="id" value={initialValue.id} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="학생 *" htmlFor="studentId" error={errors.studentId}>
          <select
            id="studentId"
            name="studentId"
            defaultValue={v.studentId}
            required
            className={inputClass}
          >
            <option value="">선택</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.grade ? `(${s.grade})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="상담사" htmlFor="counselorId">
          <select
            id="counselorId"
            name="counselorId"
            defaultValue={v.counselorId ?? ""}
            className={inputClass}
          >
            <option value="">본인</option>
            {counselors.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="상담 일시 *" htmlFor="consultedAt" error={errors.consultedAt}>
          <input
            id="consultedAt"
            name="consultedAt"
            type="datetime-local"
            defaultValue={isoToLocal(v.consultedAt || new Date().toISOString())}
            required
            className={inputClass}
          />
        </Field>
        <Field label="대상" htmlFor="audience">
          <select
            id="audience"
            name="audience"
            defaultValue={v.audience ?? "parent"}
            className={inputClass}
          >
            {AUDIENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="범주" htmlFor="category">
          <select
            id="category"
            name="category"
            defaultValue={v.category ?? "general"}
            className={inputClass}
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="과목 (선택)" htmlFor="subject">
        <input
          id="subject"
          name="subject"
          defaultValue={v.subject ?? ""}
          placeholder="예: 수학"
          className={inputClass}
        />
      </Field>

      <Field label="요약 *" htmlFor="summary" error={errors.summary}>
        <textarea
          id="summary"
          name="summary"
          defaultValue={v.summary}
          required
          rows={4}
          placeholder="상담 내용 요약"
          className={`${inputClass} resize-y`}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="후속 조치" htmlFor="followUpAction">
          <input
            id="followUpAction"
            name="followUpAction"
            defaultValue={v.followUpAction ?? ""}
            placeholder="예: 다음주 화요일 학부모 통화"
            className={inputClass}
          />
        </Field>
        <Field label="후속 조치 기한" htmlFor="followUpDate">
          <input
            id="followUpDate"
            name="followUpDate"
            type="date"
            defaultValue={v.followUpDate ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <label className="text-foreground inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="followUpDone"
          value="true"
          defaultChecked={v.followUpDone}
          className="size-4"
        />
        후속 조치 완료
      </label>

      {state?.error ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
          <AlertCircle className="size-4" />
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-5">
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-foreground block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? <p className="text-chart-4 text-xs">{error}</p> : null}
    </div>
  );
}
