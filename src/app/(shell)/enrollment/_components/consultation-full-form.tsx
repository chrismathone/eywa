"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertCircle, ArrowRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGradeLevels, useSubjectMaps } from "@/features/owner/operations-context";
import {
  createEnrollmentConsultation,
  updateEnrollmentConsultation,
  type CreateConsultationState,
  type UpdateConsultationState,
} from "@/features/enrollment/server/actions";
import {
  BLOOD_OPTIONS,
  CONSULTATION_PATHS,
  ENGLISH_GROUPS,
  ENGLISH_TEST_TYPES,
  GENDER_OPTIONS,
  REGISTRATION_STATUSES,
  RELATION_OPTIONS,
  SIBLINGS_OPTIONS,
  SUBJECT_TABS,
  type FieldGroup,
  type SubjectDetails,
} from "@/features/enrollment/form-config";

const input =
  "border-border bg-card text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

export type ConsultationFormInitial = {
  id?: string;
  prospectName?: string | null;
  prospectGrade?: string | null;
  prospectSchool?: string | null;
  englishName?: string | null;
  gender?: string | null;
  bloodType?: string | null;
  birthDate?: string | null;
  studentPhone?: string | null;
  homePhone?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentRelation?: string | null;
  address?: string | null;
  zipCode?: string | null;
  addressDetail?: string | null;
  consultationPath?: string | null;
  subject?: string | null;
  careerGoal?: string | null;
  siblings?: string | null;
  safetyNotes?: string | null;
  registrationStatus?: string | null;
  paymentAmount?: string | null;
  paymentDate?: string | null;
  registrar?: string | null;
  followUpDate?: string | null;
  followUpContent?: string | null;
  nonRegistrationReason?: string | null;
  parentRequest?: string | null;
  shuttleBusRequest?: boolean;
  privacyAgreement?: boolean;
  installmentAgreement?: boolean;
  subjectDetails?: SubjectDetails | null;
};

function SubmitBtn({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "저장 중…" : mode === "create" ? "저장하고 상세로" : "저장"}
      {mode === "create" ? <ArrowRight className="size-4" /> : <Save className="size-4" />}
    </Button>
  );
}

export function ConsultationFullForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: ConsultationFormInitial;
}) {
  const subjects = useSubjectMaps();
  const gradeLevels = useGradeLevels();
  const v = initial ?? {};

  const router = useRouter();
  const action = mode === "create" ? createEnrollmentConsultation : updateEnrollmentConsultation;
  const [state, formAction] = useActionState<
    CreateConsultationState | UpdateConsultationState,
    FormData
  >(action, undefined);

  // 수정 성공 시 상세로 복귀(생성은 서버 redirect가 처리).
  useEffect(() => {
    if (mode === "edit" && (state as UpdateConsultationState)?.ok && v.id) {
      router.push(`/enrollment/${v.id}`);
      router.refresh();
    }
  }, [state, mode, v.id, router]);

  // 과목 점수 탭 — 클라 상태로 보유, 제출 시 hidden input(JSON)으로 직렬화.
  const [details, setDetails] = useState<SubjectDetails>(() => v.subjectDetails ?? {});
  const [activeTab, setActiveTab] = useState(SUBJECT_TABS[0]!.key);
  const setField = (subj: string, key: string, val: string) =>
    setDetails((d) => ({ ...d, [subj]: { ...(d[subj] ?? {}), [key]: val } }));
  const englishType = details.english?.testType ?? "ai";

  return (
    <form action={formAction} className="space-y-5">
      {mode === "edit" && v.id ? <input type="hidden" name="id" value={v.id} /> : null}
      <input type="hidden" name="subjectDetails" value={JSON.stringify(details)} />

      <Section title="학생 정보">
        <Grid cols={3}>
          <L label="이름" required>
            <input name="prospectName" required defaultValue={v.prospectName ?? ""} className={input} />
          </L>
          <L label="영문 이름">
            <input name="englishName" defaultValue={v.englishName ?? ""} className={input} />
          </L>
          <L label="학년">
            <select name="prospectGrade" defaultValue={v.prospectGrade ?? ""} className={input}>
              <option value="">선택</option>
              {gradeLevels.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </L>
          <L label="학교">
            <input name="prospectSchool" defaultValue={v.prospectSchool ?? ""} className={input} />
          </L>
          <L label="성별">
            <select name="gender" defaultValue={v.gender ?? ""} className={input}>
              <option value="">선택</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </L>
          <L label="혈액형">
            <select name="bloodType" defaultValue={v.bloodType ?? ""} className={input}>
              <option value="">선택</option>
              {BLOOD_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b}형
                </option>
              ))}
            </select>
          </L>
          <L label="생년월일">
            <input name="birthDate" type="date" defaultValue={v.birthDate ?? ""} className={`${input} num`} />
          </L>
          <L label="학생 연락처">
            <input name="studentPhone" defaultValue={v.studentPhone ?? ""} className={input} />
          </L>
          <L label="희망 과목">
            <select name="subject" defaultValue={v.subject ?? ""} className={input}>
              <option value="">선택</option>
              {subjects.options.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </L>
          <L label="희망 진로">
            <input name="careerGoal" defaultValue={v.careerGoal ?? ""} className={input} />
          </L>
          <L label="형제관계">
            <select name="siblings" defaultValue={v.siblings ?? ""} className={input}>
              <option value="">선택</option>
              {SIBLINGS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </L>
        </Grid>
      </Section>

      <Section title="학부모 / 연락처">
        <Grid cols={3}>
          <L label="보호자 성함">
            <input name="parentName" defaultValue={v.parentName ?? ""} className={input} />
          </L>
          <L label="관계">
            <select name="parentRelation" defaultValue={v.parentRelation ?? ""} className={input}>
              <option value="">선택</option>
              {RELATION_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </L>
          <L label="보호자 연락처">
            <input name="parentPhone" defaultValue={v.parentPhone ?? ""} className={input} />
          </L>
          <L label="집 전화">
            <input name="homePhone" defaultValue={v.homePhone ?? ""} className={input} />
          </L>
          <L label="상담 경로">
            <select name="consultationPath" defaultValue={v.consultationPath ?? ""} className={input}>
              <option value="">선택</option>
              {CONSULTATION_PATHS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </L>
        </Grid>
        <Grid cols={3}>
          <L label="주소 (동/아파트)">
            <input name="address" defaultValue={v.address ?? ""} className={input} />
          </L>
          <L label="상세주소">
            <input name="addressDetail" defaultValue={v.addressDetail ?? ""} className={input} />
          </L>
          <L label="우편번호">
            <input name="zipCode" defaultValue={v.zipCode ?? ""} className={input} />
          </L>
        </Grid>
      </Section>

      <Section title="상담 내용">
        <textarea
          name="parentRequest"
          rows={4}
          defaultValue={v.parentRequest ?? ""}
          placeholder="상담 내용 / 학부모 요구사항 / 관찰"
          className={`${input} resize-y`}
        />
      </Section>

      {/* 과목별 점수 탭 */}
      <Section title="과목별 점수">
        <div className="border-border mb-3 flex flex-wrap gap-1 border-b">
          {SUBJECT_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
                activeTab === t.key
                  ? "border-primary text-primary font-semibold"
                  : "text-text-dim border-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {SUBJECT_TABS.map((tab) => {
          if (tab.key !== activeTab) return null;
          if (tab.english) {
            return (
              <div key={tab.key} className="space-y-4">
                <L label="테스트 유형">
                  <select
                    value={englishType}
                    onChange={(e) => setField("english", "testType", e.target.value)}
                    className={`${input} max-w-xs`}
                  >
                    {ENGLISH_TEST_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </L>
                {(ENGLISH_GROUPS[englishType] ?? []).map((g, i) => (
                  <GroupInputs
                    key={i}
                    group={g}
                    subjectKey="english"
                    details={details}
                    onChange={setField}
                  />
                ))}
              </div>
            );
          }
          return (
            <div key={tab.key} className="space-y-4">
              {(tab.groups ?? []).map((g, i) => (
                <GroupInputs key={i} group={g} subjectKey={tab.key} details={details} onChange={setField} />
              ))}
            </div>
          );
        })}
      </Section>

      <Section title="학원 관리 (선택)">
        <Grid cols={2}>
          <L label="안전사항 (알레르기 등)">
            <input name="safetyNotes" defaultValue={v.safetyNotes ?? ""} className={input} />
          </L>
          <L label="이전 학원">
            <input name="prevAcademy" defaultValue={undefined} className={input} />
          </L>
        </Grid>
      </Section>

      <Section title="후속 / 등록·결제 (선택)">
        <Grid cols={3}>
          <L label="등록 상태">
            <select name="registrationStatus" defaultValue={v.registrationStatus ?? ""} className={input}>
              <option value="">선택</option>
              {REGISTRATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </L>
          <L label="결제 금액">
            <input name="paymentAmount" defaultValue={v.paymentAmount ?? ""} placeholder="예: 150000" className={input} />
          </L>
          <L label="결제일">
            <input name="paymentDate" type="date" defaultValue={v.paymentDate ?? ""} className={`${input} num`} />
          </L>
          <L label="등록자">
            <input name="registrar" defaultValue={v.registrar ?? ""} className={input} />
          </L>
          <L label="후속 조치일">
            <input name="followUpDate" type="date" defaultValue={v.followUpDate ?? ""} className={`${input} num`} />
          </L>
          <L label="조치 내용">
            <input name="followUpContent" defaultValue={v.followUpContent ?? ""} className={input} />
          </L>
        </Grid>
        <L label="미등록 사유">
          <input name="nonRegistrationReason" defaultValue={v.nonRegistrationReason ?? ""} className={input} />
        </L>
        <div className="flex flex-wrap gap-4 pt-1">
          <Check name="shuttleBusRequest" label="셔틀버스 신청" defaultChecked={v.shuttleBusRequest} />
          <Check name="privacyAgreement" label="개인정보 활용 동의" defaultChecked={v.privacyAgreement} />
          <Check name="installmentAgreement" label="할부 규정 동의" defaultChecked={v.installmentAgreement} />
        </div>
      </Section>

      {state?.error ? (
        <p className="text-danger bg-danger/5 border-danger/20 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <AlertCircle className="size-4" />
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <SubmitBtn mode={mode} />
      </div>
    </form>
  );
}

function GroupInputs({
  group,
  subjectKey,
  details,
  onChange,
}: {
  group: FieldGroup;
  subjectKey: string;
  details: SubjectDetails;
  onChange: (subj: string, key: string, val: string) => void;
}) {
  return (
    <div className="space-y-2">
      {group.title ? <p className="text-text-dim text-xs font-semibold">{group.title}</p> : null}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${group.cols ?? 2}, minmax(0, 1fr))` }}
      >
        {group.fields.map((f) => (
          <label key={f.key} className="block space-y-1">
            <span className="text-text-dim text-[11px]">{f.label}</span>
            <input
              type={f.type === "date" ? "date" : "text"}
              value={details[subjectKey]?.[f.key] ?? ""}
              onChange={(e) => onChange(subjectKey, f.key, e.target.value)}
              className={input}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border-border space-y-3 rounded-lg border p-5">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}

function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${cols >= 3 ? "lg:grid-cols-3" : ""}`}>
      {children}
    </div>
  );
}

function L({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-foreground block text-xs font-medium">
        {label}
        {required ? <span className="text-danger ml-0.5">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="text-foreground inline-flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}
