"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { EMPLOYMENT_TYPES, WORKDAYS, emptyResume, type StaffResumeData } from "@/features/staff/resume";
import { saveStaffResume, type ResumeActionState } from "@/features/staff/server/resume-actions";

// 직원 이력서 작성/수정 폼 — 종이 서식(인적사항/학력/경력/자격·외국어/계약) 그대로.
// 저장 성공(nonce) 시 초안 clear + 이력서 뷰로 이동(로컬 초안 자동저장 규약 ④).

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

const EDU_HINTS = ["대학 (전문대 등)", "대학교", "대학원", "기타"];

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {mode === "create" ? "저장" : "변경 저장"}
    </Button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border-line rounded-md border p-4">
      <h2 className="text-foreground text-sm font-bold">
        {title}
        {hint ? <span className="text-text-faint ml-2 text-xs font-normal">{hint}</span> : null}
      </h2>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <label className="text-foreground block text-sm font-medium">
        {label}
        {required ? <span className="text-danger ml-0.5">*</span> : null}
      </label>
      {children}
    </div>
  );
}

export function ResumeForm({
  mode,
  id,
  initial,
}: {
  mode: "create" | "edit";
  id?: string;
  initial?: StaffResumeData;
}) {
  const [state, formAction] = useActionState<ResumeActionState, FormData>(saveStaffResume, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const v = initial ?? emptyResume();
  // 근무형태는 SearchableSelect(컨트롤드) — 초안 복원 시 onRestore로 rehydrate.
  const [empType, setEmpType] = useState(v.contract.employmentType);

  const draft = useFormDraft({
    scope: mode === "create" ? "staff-resume:new" : `staff-resume:${id ?? "edit"}`,
    formRef,
    onRestore: (vals) => setEmpType(vals.c_employmentType ?? ""),
  });
  const clearDraft = draft.clear;

  // 저장 성공 확정(nonce) 1회만: 초안 삭제 → 이력서 뷰로 이동(#67 id-키 가드).
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      clearDraft();
      if (state.redirectTo) router.push(state.redirectTo);
    }
  }, [state, router, clearDraft]);

  return (
    <form action={formAction} ref={formRef} className="space-y-5">
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      {mode === "edit" && id ? <input type="hidden" name="id" value={id} /> : null}

      <Section title="1. 인적사항">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="성명" required>
            <input name="p_name" defaultValue={v.personal.name} required className={inputClass} />
          </Field>
          <Field label="영문 이름">
            <input name="p_nameEn" defaultValue={v.personal.nameEn} className={inputClass} />
          </Field>
          <Field label="주민등록번호">
            <input name="p_residentId" defaultValue={v.personal.residentId} placeholder="000000-0000000" className={inputClass} />
          </Field>
          <Field label="전화번호">
            <input name="p_phone" defaultValue={v.personal.phone} placeholder="010-0000-0000" className={inputClass} />
          </Field>
          <Field label="E-mail">
            <input type="email" name="p_email" defaultValue={v.personal.email} className={inputClass} />
          </Field>
          <Field label="주소">
            <input name="p_address" defaultValue={v.personal.address} className={inputClass} />
          </Field>
        </div>
      </Section>

      <Section title="2. 학력사항" hint="재학 기간 · 학교명 · 전공 · 학점 · 소재지">
        {v.education.map((row, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-5">
            <input name={`edu_${i}_period`} defaultValue={row.period} placeholder="0000.00 ~ 0000.00" className={inputClass} />
            <input name={`edu_${i}_school`} defaultValue={row.school} placeholder={EDU_HINTS[i] ?? "학교명"} className={inputClass} />
            <input name={`edu_${i}_major`} defaultValue={row.major} placeholder="전공" className={inputClass} />
            <input name={`edu_${i}_gpa`} defaultValue={row.gpa} placeholder="학점" className={inputClass} />
            <input name={`edu_${i}_location`} defaultValue={row.location} placeholder="소재지" className={inputClass} />
          </div>
        ))}
      </Section>

      <Section title="3. 경력사항" hint="직장명 · 근무 기간 · 담당 업무 · 월급여 · 퇴직 사유">
        {v.career.map((row, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-5">
            <input name={`car_${i}_company`} defaultValue={row.company} placeholder="직장명" className={inputClass} />
            <input name={`car_${i}_period`} defaultValue={row.period} placeholder="0000.00 ~ 0000.00" className={inputClass} />
            <input name={`car_${i}_duties`} defaultValue={row.duties} placeholder="담당 업무" className={inputClass} />
            <input name={`car_${i}_salary`} defaultValue={row.salary} placeholder="월급여" className={inputClass} />
            <input name={`car_${i}_leaveReason`} defaultValue={row.leaveReason} placeholder="퇴직 사유" className={inputClass} />
          </div>
        ))}
      </Section>

      <Section title="4. 자격증 및 외국어 능력">
        <p className="micro">자격증 (자격증명 · 취득년월일 · 발행처)</p>
        {v.certificates.map((row, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input name={`cert_${i}_name`} defaultValue={row.name} placeholder="자격증명" className={inputClass} />
            <input name={`cert_${i}_date`} defaultValue={row.date} placeholder="취득년월일" className={inputClass} />
            <input name={`cert_${i}_issuer`} defaultValue={row.issuer} placeholder="발행처" className={inputClass} />
          </div>
        ))}
        <p className="micro mt-3">외국어 능력 (외국어·시험명 · 시험일 · 점수/등급)</p>
        {v.languages.map((row, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input name={`lang_${i}_name`} defaultValue={row.name} placeholder="외국어 (시험명)" className={inputClass} />
            <input name={`lang_${i}_testDate`} defaultValue={row.testDate} placeholder="시험일" className={inputClass} />
            <input name={`lang_${i}_score`} defaultValue={row.score} placeholder="점수/등급" className={inputClass} />
          </div>
        ))}
      </Section>

      <Section title="5. 계약사항">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="근무부서">
            <input name="c_department" defaultValue={v.contract.department} className={inputClass} />
          </Field>
          <Field label="입사일">
            <input type="date" name="c_startDate" defaultValue={v.contract.startDate} className={inputClass} />
          </Field>
          <Field label="근무형태">
            <SearchableSelect
              name="c_employmentType"
              value={empType}
              onValueChange={setEmpType}
              options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t }))}
              placeholder="선택..."
            />
          </Field>
          <Field label="급여 계약 (월급)">
            <input name="c_salaryMonthly" defaultValue={v.contract.salaryMonthly} placeholder="예: 2,800,000원" className={inputClass} />
          </Field>
          <Field label="급여 계약 (연봉)">
            <input name="c_salaryAnnual" defaultValue={v.contract.salaryAnnual} className={inputClass} />
          </Field>
          <Field label="계좌 은행">
            <input name="c_bank" defaultValue={v.contract.bank} placeholder="은행명" className={inputClass} />
          </Field>
          <Field label="계좌번호">
            <input name="c_account" defaultValue={v.contract.account} className={inputClass} />
          </Field>
        </div>
        <div className="mt-1">
          <p className="text-foreground mb-1.5 text-sm font-medium">근무요일</p>
          <div className="flex flex-wrap gap-3">
            {WORKDAYS.map((d) => (
              <label key={d.key} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name={`c_workday_${d.key}`}
                  value="1"
                  defaultChecked={v.contract.workDays.includes(d.key)}
                  className="accent-primary size-4"
                />
                {d.label}
              </label>
            ))}
          </div>
        </div>
      </Section>

      {state?.error ? (
        <p className="text-danger flex items-center gap-1.5 text-sm">
          <AlertCircle className="size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <div className="border-line flex items-center justify-end gap-2 border-t pt-5">
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}
