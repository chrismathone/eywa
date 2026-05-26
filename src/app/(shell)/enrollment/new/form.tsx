"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createEnrollmentConsultation,
  type CreateConsultationState,
} from "@/features/enrollment/server/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "저장 중…" : "저장하고 상세로"}
      <ArrowRight className="size-4" />
    </Button>
  );
}

export function NewConsultationForm() {
  const [state, formAction] = useActionState<CreateConsultationState, FormData>(
    createEnrollmentConsultation,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-6">
      <Section title="학생 정보">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field id="prospectName" label="이름" required placeholder="홍길동" />
          <Field id="prospectGrade" label="학년" placeholder="예: 중2, 고1" />
          <Field id="prospectSchool" label="학교" placeholder="예: 인재중" />
        </div>
      </Section>

      <Section title="학부모 정보">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="parentName" label="학부모 성함" placeholder="예: 홍**" />
          <Field id="parentPhone" label="연락처" placeholder="010-0000-0000" />
        </div>
      </Section>

      <Section title="학습 이력 (선택)">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="prevAcademy" label="이전 학원" placeholder="예: ABC수학" />
          <Field id="lastScore" label="최근 성적" placeholder="예: 중2 1학기 중간 수학 74점" />
        </div>
      </Section>

      <Section title="학부모 요구사항">
        <div className="space-y-2">
          <Label htmlFor="parentRequest" className="eyebrow">
            상담 메모
          </Label>
          <textarea
            id="parentRequest"
            name="parentRequest"
            rows={5}
            placeholder="학부모가 전해준 요구사항 / 관찰 / 우려를 기록"
            className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
        </div>
      </Section>

      {state?.error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border-border rounded-lg border p-5">
      <h3 className="eyebrow mb-4">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  placeholder,
  required,
}: {
  id: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="eyebrow">
        {label}
        {required ? <span className="text-chart-4 ml-1">*</span> : null}
      </Label>
      <Input id={id} name={id} placeholder={placeholder} required={required} />
    </div>
  );
}
