"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  submitPublicIntake,
  type PublicIntakeState,
} from "@/features/enrollment/server/intake-actions";
import {
  BLOOD_OPTIONS,
  CONSULTATION_PATHS,
  RELATION_OPTIONS,
} from "@/features/enrollment/form-config";

// ijw 입학상담카드 충실 이식 — 컬러 구획(학생=gold·학부모=amber·셔틀=danger·동의서=ink) + 전체 필드/섹션.
// ⚠️ 셔틀 노선·동의서 전문은 데모(인재원) 정적 콘텐츠(실서비스는 테넌트 설정화 대상).

const input =
  "border-border bg-card text-foreground placeholder:text-text-faint h-11 w-full rounded-md border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30";
const label = "mb-1.5 block text-sm font-bold text-foreground";

const SCHOOL_TYPES = [
  { type: "초등학교", prefix: "초" },
  { type: "중학교", prefix: "중" },
  { type: "고등학교", prefix: "고" },
] as const;

const PRIVACY_TEXT = `1. 수집하는 개인정보의 항목 : 성명, 학년, 학교, 학생 연락처, 학부모 연락처, 제출한 과제의 동영상 및 음원

2. 원생들의 동기부여를 위해 원내 게시물, 가정통신문, 블로그 등 SNS에 학습성과를 홍보할 때 이용합니다.

3. 단, 온라인이나 배포용 홍보물에는 전체 이름을 노출하지 않고 '*'기호 등을 사용해서 개인정보 유출을 막습니다.

4. 동의를 거부할 권리 : 귀하는 위와 같이 개인정보를 수집·이용하는 데 대한 동의를 거부할 권리가 있습니다. 다만, 동의하지 않으실 경우 상담 제공 및 셔틀버스 운영 등 일부 서비스에 제한이 있을 수 있습니다.`;

const REFUND_BLOCKS: { title: string; body: string }[] = [
  {
    title: "수강 등록 및 환불 안내",
    body: `1. 매월 25일~28일까지 수강료 납부기간이며, 25일에 등록안내 및 학사일정이 모바일로 발송됩니다.

2. 수강료는 선불이며, 매월 1일부터 말일까지 수업횟수 기준으로 산정됩니다.

3. 원활한 학습관리를 위해 월 12회, 월 8회 수업이 최소 단위입니다. (단, 특강반·단과반 제외)

4. 등록기간 내 미등록 시, 대기생으로 자동 편성되어 기존 수강반 등록이 어려울 수 있습니다.`,
  },
  {
    title: "환불 규정 (공정거래위원회 표준약관 기준)",
    body: `교습 시작 전 → 전액 환불
총 수업의 1/3 경과 전 → 2/3 환불
총 수업의 1/2 경과 전 → 1/2 환불
총 수업의 1/2 경과 후 → 환불 불가`,
  },
  {
    title: "보강 및 퇴원 규정",
    body: `1. 규칙적인 학습을 위해 지각·결석에 대한 별도 보강이 없습니다. (단, 건강상의 문제나 증명 가능한 공식 사유는 1회 이내 예외 인정)

2. 규정·예의를 지키지 않거나 수업 분위기를 해칠 경우 경고를 받으며, 2회 경고 시 퇴원 조치됩니다.`,
  },
];

const SHUTTLE_ROUTES = [
  {
    title: "1호차 주요 노선",
    stops: ["서대구 센트럴자이", "고성동 오페라 아파트", "대구역 앞 북편네거리", "옥산초·경명여중 입구"],
  },
  {
    title: "2호차 주요 노선",
    stops: ["침산 푸르지오 1차", "달성초 앞", "달성파크 푸르지오 힐스테이트", "대구역 센트럴자이", "서희스타힐스 앞"],
  },
];

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
          상담 신청하기 <span className="text-lg">→</span>
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
}: {
  token: string;
  academyName: string;
  subjectOptions: { value: string; label: string }[];
  gradeLevels: string[];
}) {
  const [state, formAction] = useActionState<PublicIntakeState, FormData>(submitPublicIntake, undefined);

  // 버튼/다중선택은 상태로 보유 → hidden input으로 제출.
  const [subjects, setSubjects] = useState<string[]>([]);
  const [siblings, setSiblings] = useState("");
  const [shuttle, setShuttle] = useState<boolean | null>(null);
  const [schoolType, setSchoolType] = useState("");
  const [grade, setGrade] = useState("");

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
      <input type="hidden" name="shuttleBusRequest" value={shuttle ? "true" : ""} />

      {/* 헤더 (네이비/ink) */}
      <header className="bg-foreground px-6 pt-8 pb-6 text-center">
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
                  {on ? "✓ " : ""}
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
      </Section>

      {/* 셔틀버스 (danger) */}
      <Section title="셔틀버스 신청" tone="danger">
        <p className="text-foreground text-sm font-semibold">셔틀버스를 신청하시겠습니까? (월 20,000원)</p>
        <div className="flex gap-2">
          {[
            { v: true, label: "신청" },
            { v: false, label: "미신청" },
          ].map((opt) => {
            const on = shuttle === opt.v;
            return (
              <button
                key={String(opt.v)}
                type="button"
                onClick={() => setShuttle(opt.v)}
                className={`h-11 flex-1 rounded-md border text-sm font-medium transition-colors ${
                  on ? "border-danger bg-danger text-white" : "border-border bg-card text-text-dim"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="space-y-2">
          {SHUTTLE_ROUTES.map((r) => (
            <div key={r.title} className="bg-danger/5 rounded-md p-3">
              <p className="text-danger text-[13px] font-bold">{r.title}</p>
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
      </Section>

      {/* 동의서 (ink) */}
      <Section title="동의서 & 학칙 안내" tone="ink">
        <div className="space-y-3">
          <h4 className="text-foreground text-sm font-bold">
            개인정보 활용 동의서 <span className="text-danger">*</span>
          </h4>
          <div className="bg-bg-soft rounded-md p-4 text-[13px] leading-relaxed">
            <p className="text-foreground mb-2 font-bold">개인정보 수집 및 이용 동의서</p>
            <p className="text-text-dim whitespace-pre-line">{PRIVACY_TEXT}</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" name="privacyAgreement" value="true" required className="accent-danger size-5 shrink-0" />
            <span className="text-foreground text-sm">위 내용을 확인하였으며, 이에 동의합니다.</span>
          </label>
        </div>

        <div className="space-y-3 pt-2">
          <h4 className="text-foreground text-sm font-bold">환불 규정 안내 동의서</h4>
          <div className="bg-bg-soft space-y-3 rounded-md p-4 text-[13px] leading-relaxed">
            {REFUND_BLOCKS.map((b) => (
              <div key={b.title}>
                <p className="text-foreground mb-1 font-bold">{b.title}</p>
                <p className="text-text-dim whitespace-pre-line">{b.body}</p>
              </div>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" name="installmentAgreement" value="true" className="accent-danger size-5 shrink-0" />
            <span className="text-foreground text-sm">위 내용을 확인하였으며, 이에 동의합니다.</span>
          </label>
        </div>
      </Section>

      <div className="mx-3 mt-6 px-2">
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
