"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Check, CheckCircle2, Loader2 } from "@/components/icons/eywa-icon-compat";
import {
  submitPublicIntake,
  type PublicIntakeState,
} from "@/features/enrollment/server/intake-actions";
import {
  BLOOD_OPTIONS,
  CONSULTATION_PATHS,
  RELATION_OPTIONS,
} from "@/features/enrollment/form-config";
import type { ShuttleSetting } from "@/features/owner/settings-types";
import { TurnstileWidget } from "./turnstile-widget";

// ijw 입학상담카드 충실 이식 — 컬러 구획(학생=gold·학부모=amber·셔틀=danger·동의서=ink) + 전체 필드/섹션.
// 셔틀(요금·노선)·동의서 문구는 학원설정에서 주입(operations.shuttle / notifications.privacyTerms·serviceTerms).

const input =
  "border-border bg-card text-foreground placeholder:text-text-faint h-11 w-full rounded-md border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30";
const label = "mb-1.5 block text-sm font-bold text-foreground";

const SCHOOL_TYPES = [
  { type: "초등학교", prefix: "초" },
  { type: "중학교", prefix: "중" },
  { type: "고등학교", prefix: "고" },
] as const;

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-danger inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-md text-base font-bold text-white transition-opacity disabled:opacity-50"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          제출 중…
        </>
      ) : (
        <>
          상담 신청하기 <ArrowRight className="size-4" />
        </>
      )}
    </button>
  );
}

export function PublicIntakeForm({
  token,
  academyName,
  subjectOptions,
  gradeLevels,
  shuttle,
  privacyTerms,
  serviceTerms,
  serverNow,
  turnstileSiteKey,
}: {
  token: string;
  academyName: string;
  subjectOptions: { value: string; label: string }[];
  gradeLevels: string[];
  shuttle: ShuttleSetting;
  privacyTerms: string;
  serviceTerms: string;
  serverNow: number;
  turnstileSiteKey: string | null;
}) {
  const [state, formAction] = useActionState<PublicIntakeState, FormData>(submitPublicIntake, undefined);

  // 버튼/다중선택은 상태로 보유 → hidden input으로 제출.
  const [subjects, setSubjects] = useState<string[]>([]);
  const [siblings, setSiblings] = useState("");
  const [applyShuttle, setApplyShuttle] = useState<boolean | null>(null);
  const [schoolType, setSchoolType] = useState("");
  const [grade, setGrade] = useState("");
  const showPrivacy = privacyTerms.trim().length > 0;
  const showService = serviceTerms.trim().length > 0;

  const gradeOptions = useMemo(() => {
    const st = SCHOOL_TYPES.find((s) => s.type === schoolType);
    if (!st) return [];
    return gradeLevels.filter((g) => g.startsWith(st.prefix));
  }, [schoolType, gradeLevels]);

  const toggleSubject = (v: string) =>
    setSubjects((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  if (state?.ok) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <CheckCircle2 className="text-primary size-14" />
        <p className="text-foreground text-lg font-bold">제출 완료</p>
        <p className="text-text-dim text-sm">
          입학상담카드가 접수되었습니다. {academyName}에서 빠른 시일 내에 연락드리겠습니다.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="mx-auto max-w-[460px] pb-12">
      <input type="hidden" name="token" value={token} />
      {/* time-trap — 서버 렌더 시각. 제출 시 경과시간으로 봇(즉시 제출) 차단. */}
      <input type="hidden" name="renderedAt" value={serverNow} />
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      {/* 버튼/다중선택 → hidden 제출 */}
      {subjects.map((s) => (
        <input key={s} type="hidden" name="subjects" value={s} />
      ))}
      <input type="hidden" name="siblings" value={siblings} />
      <input type="hidden" name="shuttleBusRequest" value={applyShuttle ? "true" : ""} />

      {/* 헤더 (네이비/ink) — 섹션 카드와 동일하게 mx-3 인셋(좌우 폭 일치). */}
      <header className="bg-foreground mx-3 mt-3 px-6 pt-8 pb-6 text-center">
        <p className="text-gold text-sm font-semibold">{academyName}</p>
        <h1 className="text-background mt-1 text-[26px] font-extrabold">입학상담카드</h1>
        <p className="text-background/60 mt-1.5 text-sm">상담 전 아래 정보를 입력해 주세요</p>
      </header>

      {/* 학생 정보 (gold) */}
      <Section title="학생 정보" tone="gold">
        <Field label="학생 이름" required>
          <input name="prospectName" required placeholder="이름 입력" className={input} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="성별" required>
            <select name="gender" defaultValue="" required className={input}>
              <option value="">성별 선택</option>
              <option value="male">남</option>
              <option value="female">여</option>
            </select>
          </Field>
          <Field label="혈액형">
            <select name="bloodType" defaultValue="" className={input}>
              <option value="">선택</option>
              {BLOOD_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b}형
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="학생 연락처">
          <input name="studentPhone" type="tel" inputMode="numeric" placeholder="- 없이 숫자만 입력" className={input} />
          <p className="text-text-faint mt-1 text-xs">예: 01012345678</p>
        </Field>
        <Field label="희망 진로">
          <input name="careerGoal" placeholder="의사, 교사 등" className={input} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="학교 구분" required>
            <select
              value={schoolType}
              onChange={(e) => {
                setSchoolType(e.target.value);
                setGrade("");
              }}
              className={input}
            >
              <option value="">선택</option>
              {SCHOOL_TYPES.map((s) => (
                <option key={s.type} value={s.type}>
                  {s.type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="학년" required>
            <select
              name="prospectGrade"
              required
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              disabled={!schoolType}
              className={input}
            >
              <option value="">선택</option>
              {gradeOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="학교 이름 (예: 경명여고, 칠성고)" required>
          <input name="prospectSchool" required placeholder="학교 이름 입력" className={input} />
        </Field>
        <Field label="상담 희망 과목">
          <div className="flex flex-wrap gap-2">
            {subjectOptions.map((s) => {
              const on = subjects.includes(s.value);
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleSubject(s.value)}
                  className={`h-11 flex-1 rounded-md border text-sm font-medium transition-colors ${
                    on ? "border-gold bg-gold text-foreground" : "border-border bg-card text-text-dim"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="형제자매">
          <div className="flex gap-2">
            {["있음", "없음(외동)"].map((opt) => {
              const on = siblings === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setSiblings(opt)}
                  className={`h-11 flex-1 rounded-md border text-sm font-medium transition-colors ${
                    on ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground"
                  }`}
                >
                  {on ? <Check className="mr-1 inline size-3.5" /> : null}
                  {opt}
                </button>
              );
            })}
          </div>
        </Field>
      </Section>

      {/* 학부모 정보 (amber) */}
      <Section title="학부모님 정보" tone="amber">
        <Field label="보호자 성함" required>
          <input name="parentName" required placeholder="이름 입력" className={input} />
        </Field>
        <Field label="학생과의 관계" required>
          <select name="parentRelation" defaultValue="" required className={input}>
            <option value="">관계 선택</option>
            {RELATION_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="보호자 연락처" required>
          <input name="parentPhone" type="tel" inputMode="numeric" required placeholder="- 없이 숫자만 입력" className={input} />
          <p className="text-text-faint mt-1 text-xs">예: 01012345678</p>
        </Field>
        <Field label="상담 경로" required>
          <select name="consultationPath" defaultValue="" required className={input}>
            <option value="">상담경로 선택</option>
            {CONSULTATION_PATHS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="집주소 (동 또는 아파트 이름)">
          <input name="address" placeholder="예: 침산동, 센트럴자이" className={input} />
        </Field>
        <Field label="상담 시 궁금한 점 / 요청사항">
          <textarea
            name="parentRequest"
            rows={4}
            placeholder="상담 시 문의하실 내용이나 학생에 대해 미리 알려주실 점을 자유롭게 적어주세요."
            className="border-border bg-card text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </Field>
      </Section>

      {/* 셔틀버스 (danger) — 학원설정 operations.shuttle. 표시 OFF면 섹션 자체를 숨김. */}
      {shuttle.enabled ? (
        <Section title="셔틀버스 신청" tone="danger">
          <p className="text-foreground text-sm font-semibold">
            셔틀버스를 신청하시겠습니까?{shuttle.fee ? ` (${shuttle.fee})` : ""}
          </p>
          <div className="flex gap-2">
            {[
              { v: true, label: "신청" },
              { v: false, label: "미신청" },
            ].map((opt) => {
              const on = applyShuttle === opt.v;
              return (
                <button
                  key={String(opt.v)}
                  type="button"
                  onClick={() => setApplyShuttle(opt.v)}
                  className={`h-11 flex-1 rounded-md border text-sm font-medium transition-colors ${
                    on ? "border-danger bg-danger text-white" : "border-border bg-card text-text-dim"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {shuttle.routes.length > 0 ? (
            <div className="space-y-2">
              {shuttle.routes.map((r, ri) => (
                <div key={ri} className="bg-danger/5 rounded-md p-3">
                  <p className="text-danger text-[13px] font-bold">{r.label}</p>
                  <div className="text-text-dim mt-0.5 text-xs leading-relaxed">
                    {r.stops.map((stop, i) => (
                      <p key={i}>
                        {i + 1}. {stop}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      {/* 동의서 (ink) — 문구는 학원설정 notifications.privacyTerms / serviceTerms. */}
      <Section title="동의서 & 학칙 안내" tone="ink">
        <div className="space-y-3">
          <h4 className="text-foreground text-sm font-bold">
            개인정보 활용 동의서 <span className="text-danger">*</span>
          </h4>
          {showPrivacy ? (
            <div className="bg-bg-soft rounded-md p-4 text-[13px] leading-relaxed">
              <p className="text-text-dim whitespace-pre-line">{privacyTerms}</p>
            </div>
          ) : null}
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" name="privacyAgreement" value="true" required className="accent-danger size-5 shrink-0" />
            <span className="text-foreground text-sm">개인정보 수집·이용에 동의합니다.</span>
          </label>
        </div>

        {showService ? (
          <div className="space-y-3 pt-2">
            <h4 className="text-foreground text-sm font-bold">환불·학칙 안내 동의서</h4>
            <div className="bg-bg-soft rounded-md p-4 text-[13px] leading-relaxed">
              <p className="text-text-dim whitespace-pre-line">{serviceTerms}</p>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input type="checkbox" name="installmentAgreement" value="true" className="accent-danger size-5 shrink-0" />
              <span className="text-foreground text-sm">위 내용을 확인하였으며, 이에 동의합니다.</span>
            </label>
          </div>
        ) : null}
      </Section>

      {turnstileSiteKey ? <TurnstileWidget siteKey={turnstileSiteKey} /> : null}

      <div className="mx-3 mt-6">
        {state?.error ? <p className="text-danger mb-3 text-sm">{state.error}</p> : null}
        <SubmitBtn />
        <p className="text-text-faint mt-3 text-center text-xs">제출하신 정보는 상담 목적으로만 사용됩니다.</p>
      </div>
    </form>
  );
}

const TONE: Record<string, { bar: string; barText: string; border: string }> = {
  gold: { bar: "bg-gold", barText: "text-foreground", border: "border-t-gold" },
  amber: { bar: "bg-amber", barText: "text-white", border: "border-t-amber" },
  danger: { bar: "bg-danger", barText: "text-white", border: "border-t-danger" },
  ink: { bar: "bg-foreground", barText: "text-background", border: "border-t-foreground" },
};

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: keyof typeof TONE;
  children: React.ReactNode;
}) {
  const t = TONE[tone]!;
  return (
    <>
      <div className={`mx-3 mt-5 px-5 py-3 ${t.bar}`}>
        <span className={`text-sm font-bold ${t.barText}`}>{title}</span>
      </div>
      <div className={`bg-card mx-3 space-y-4 border-t-[3px] px-5 py-5 shadow-sm ${t.border}`}>{children}</div>
    </>
  );
}

function Field({
  label: lbl,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className={label}>
        {lbl}
        {required ? <span className="text-danger ml-0.5">*</span> : null}
      </span>
      {children}
    </div>
  );
}
