"use client";

import Image from "next/image";
import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2 } from "@/components/icons/eywa-icon-compat";
import { isPreschoolGrade } from "@/lib/format/school-grade";
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
import { ChecklistStep } from "./checklist-step";
import { AutoTextarea, Field, Section, inputCls as input } from "./intake-ui";

// ijw 입학상담카드 충실 이식 — 컬러 구획(학생=gold·학부모=amber·셔틀=danger·동의서=ink) + 전체 필드/섹션.
// 셔틀(요금·노선)·동의서 문구는 학원설정에서 주입(operations.shuttle / notifications.privacyTerms·serviceTerms).
//
// 2단계 구성(2026-07-15): 1단계=접수 정보(위 섹션들), 2단계=신규 상담 사전 체크리스트.
// ⚠️ 스텝 전환은 **언마운트가 아니라 hidden** — 1단계 입력이 DOM에서 빠지면 제출 FormData에서 통째로 사라진다.
// 필수 검증은 1단계에서 `reportValidity()`로 먼저 통과시키므로, 숨겨진 required가 제출을 막지 않는다.

// 학교 구분 → 학년 후보. **학년 목록 자체는 학원설정(operations.gradeLevels)이 단일 소스**라
// 여기엔 학년을 적지 않고 표기 모양으로만 가른다. 미취학(6세·7세)은 급이 없어 접두사로 못 걸러
// 판별 함수를 쓴다(원장 2026-08-18: 7세반 문의가 들어온다).
const SCHOOL_TYPES = [
  {
    type: "미취학",
    match: (g: string) => isPreschoolGrade(g),
    schoolLabel: "유치원 이름 (다니지 않으면 '미취학')",
    schoolPlaceholder: "유치원 이름 입력",
  },
  { type: "초등학교", match: (g: string) => g.startsWith("초"), schoolLabel: null, schoolPlaceholder: null },
  { type: "중학교", match: (g: string) => g.startsWith("중"), schoolLabel: null, schoolPlaceholder: null },
  { type: "고등학교", match: (g: string) => g.startsWith("고"), schoolLabel: null, schoolPlaceholder: null },
] as const;

function SubmitBtn({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="bg-danger inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-full text-base font-bold text-white transition-opacity disabled:opacity-50"
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

  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [goalCount, setGoalCount] = useState(0);

  // 버튼/다중선택은 상태로 보유 → hidden input으로 제출.
  const [subjects, setSubjects] = useState<string[]>([]);
  const [siblings, setSiblings] = useState("");
  const [applyShuttle, setApplyShuttle] = useState<boolean | null>(null);
  const [schoolType, setSchoolType] = useState("");
  const [grade, setGrade] = useState("");
  const showPrivacy = privacyTerms.trim().length > 0;
  const showService = serviceTerms.trim().length > 0;

  // 학년이 하나도 없는 구분은 아예 안 보여준다 — 학원이 미취학을 안 받으면 학원설정에서 6세·7세를
  // 빼는 것만으로 이 선택지가 사라진다(코드 수정 불요).
  const schoolTypes = useMemo(
    () => SCHOOL_TYPES.filter((s) => gradeLevels.some((g) => s.match(g))),
    [gradeLevels],
  );
  const selectedSchoolType = SCHOOL_TYPES.find((s) => s.type === schoolType) ?? null;
  const gradeOptions = useMemo(() => {
    const st = SCHOOL_TYPES.find((s) => s.type === schoolType);
    if (!st) return [];
    return gradeLevels.filter((g) => st.match(g));
  }, [schoolType, gradeLevels]);

  const toggleSubject = (v: string) =>
    setSubjects((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  // 1단계 → 2단계: 브라우저 기본 검증(required)으로 먼저 걸러내고, 버튼 그룹(HTML 검증 불가)은 직접 확인.
  function goStep2() {
    if (!formRef.current?.reportValidity()) return;
    if (subjects.length === 0) {
      setStepError("상담 희망 과목을 1개 이상 선택해주세요");
      return;
    }
    // ⚠️ 셔틀은 답을 비워도 DB엔 false(미신청)로 저장된다 — 무응답과 미신청이 구분되지 않는다.
    //    상담 사전 브리프가 이 값을 "학부모가 신청하지 않음"으로 읽고 셔틀 질문을 생략하므로,
    //    빈 채로 넘어가면 셔틀이 필요한 학부모가 상담에서 안내를 못 받는다 → 명시 선택을 받는다.
    if (shuttle.enabled && applyShuttle === null) {
      setStepError("셔틀버스 신청 여부를 선택해주세요");
      return;
    }
    setStepError(null);
    setStep(2);
    window.scrollTo({ top: 0 });
  }
  function goStep1() {
    setStepError(null);
    setStep(1);
    window.scrollTo({ top: 0 });
  }

  // 2단계에서 고른 과목 = 5·6번 문항 노출 판정 재료(라벨까지 필요).
  const selectedSubjectMeta = useMemo(
    () =>
      subjects.map((v) => ({ key: v, label: subjectOptions.find((o) => o.value === v)?.label ?? v })),
    [subjects, subjectOptions],
  );

  if (state?.ok) {
    // 제출 완료 — Editorial 문법 ④: 환영 사진 카드 + 또렷한 완료 위계 (학부모 첫인상의 마지막 장면)
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-10 text-center">
        <div className="shadow-card w-full overflow-hidden rounded-3xl">
          <Image
            src="/photos/intake-done.webp"
            alt=""
            width={600}
            height={400}
            sizes="(max-width: 480px) 100vw, 400px"
            className="w-full object-cover"
          />
        </div>
        <CheckCircle2 className="text-primary mt-1 size-12" />
        <p className="text-foreground text-xl font-bold">제출 완료</p>
        {/* ⚠️ "빠른 시일 내에 연락드리겠습니다"는 쓰지 말 것 — 이 폼은 대부분 **학원에 방문한 학부모가
            상담 직전 그 자리에서** 작성한다. 눈앞에 상담 선생님이 있는데 나중에 전화하겠다고 하면 어긋난다.
            원격 링크로 작성한 경우에도 어색하지 않도록 "전달됨 + 곧 안내"까지만 말한다(연락 수단·시점 약속 금지). */}
        <p className="text-text-dim text-sm leading-relaxed">
          입학상담카드가 접수되었습니다.<br />
          작성해 주신 내용은 {academyName} 상담 선생님께 전달되었습니다.
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="mx-auto max-w-[460px] pb-12">
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
      {/* 미선택("")·미신청("false") 모두 서버에선 false로 저장된다 — 무응답을 남기지 않으려고 위 goStep2가 선택을 강제한다. */}
      <input
        type="hidden"
        name="shuttleBusRequest"
        value={applyShuttle === null ? "" : applyShuttle ? "true" : "false"}
      />

      {/* 헤더 — Editorial 문법 ④: 학원 공간 사진 + 잉크 오버레이(구 단색 ink 블록의 대비는 유지).
          사진은 public/photos/intake-header.webp (placeholder → 실사 덮어쓰기, docs/photo-generation-prompts.md). */}
      <header className="relative mx-3 mt-3 overflow-hidden rounded-2xl px-6 pt-8 pb-6 text-center">
        <Image
          src="/photos/intake-header.webp"
          alt=""
          fill
          sizes="(max-width: 480px) 100vw, 460px"
          preload
          className="object-cover"
        />
        <div className="bg-foreground/70 absolute inset-0" aria-hidden />
        <div className="relative">
          <p className="text-gold text-sm font-bold">{academyName}</p>
          <h1 className="text-background mt-1 text-[26px] font-bold">
            {step === 1 ? "입학상담카드" : "사전 체크리스트"}
          </h1>
          <p className="text-background/70 mt-1.5 text-sm">
            {step === 1
              ? "상담 전 아래 정보를 입력해 주세요"
              : "학생에게 맞는 수업을 제안하기 위한 설문입니다"}
          </p>
          {/* 진행 표시 — 2단계뿐이라 점 2개로 충분(막대 게이지는 과함). */}
          <div className="mt-4 flex items-center justify-center gap-2">
            {[1, 2].map((n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all ${
                  step === n ? "bg-gold w-8" : "bg-background/30 w-4"
                }`}
              />
            ))}
            <span className="text-background/60 num ml-1.5 text-xs">{step}/2</span>
          </div>
        </div>
      </header>

      {/* ⚠️ 1단계는 hidden으로만 감춘다(언마운트 금지 — FormData에서 사라짐). */}
      <div className={step === 1 ? undefined : "hidden"}>
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
              {schoolTypes.map((s) => (
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
        <Field label={selectedSchoolType?.schoolLabel ?? "학교 이름 (예: 경명여고, 칠성고)"} required>
          <input
            name="prospectSchool"
            required
            placeholder={selectedSchoolType?.schoolPlaceholder ?? "학교 이름 입력"}
            className={input}
          />
        </Field>
        {/* 과목은 사전 체크리스트의 과목별 문항(수학·영어) 노출을 가르므로 필수 — 서버도 재검증. */}
        <Field label="상담 희망 과목" required>
          <div className="flex flex-wrap gap-2">
            {subjectOptions.map((s) => {
              const on = subjects.includes(s.value);
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleSubject(s.value)}
                  className={`h-11 flex-1 rounded-xl border text-sm font-medium transition-colors ${
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
                  className={`h-11 flex-1 rounded-xl border text-sm font-medium transition-colors ${
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
          <AutoTextarea
            name="parentRequest"
            minRows={4}
            placeholder="상담 시 문의하실 내용이나 학생에 대해 미리 알려주실 점을 자유롭게 적어주세요."
          />
        </Field>
      </Section>

      {/* 셔틀버스 (danger) — 학원설정 operations.shuttle. 표시 OFF면 섹션 자체를 숨김. */}
      {shuttle.enabled ? (
        <Section title="셔틀버스 신청" tone="danger">
          <p className="text-foreground text-sm font-bold">
            셔틀버스를 신청하시겠습니까?{shuttle.fee ? ` (${shuttle.fee})` : ""}{" "}
            <span className="text-danger">*</span>
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
                  className={`h-11 flex-1 rounded-xl border text-sm font-medium transition-colors ${
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
                <div key={ri} className="bg-danger/5 rounded-xl p-3">
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
            <div className="bg-bg-soft rounded-xl p-4 text-[13px] leading-relaxed">
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
            <div className="bg-bg-soft rounded-xl p-4 text-[13px] leading-relaxed">
              <p className="text-text-dim whitespace-pre-line">{serviceTerms}</p>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input type="checkbox" name="installmentAgreement" value="true" className="accent-danger size-5 shrink-0" />
              <span className="text-foreground text-sm">위 내용을 확인하였으며, 이에 동의합니다.</span>
            </label>
          </div>
        ) : null}
      </Section>
      </div>

      {/* 2단계 — 사전 체크리스트. 1단계에서 넘어온 뒤에만 마운트(문항이 많아 초기 렌더 비용을 아낀다). */}
      {step === 2 ? (
        <ChecklistStep selectedSubjects={selectedSubjectMeta} onGoalsCountChange={setGoalCount} />
      ) : null}

      {turnstileSiteKey ? <TurnstileWidget siteKey={turnstileSiteKey} /> : null}

      <div className="mx-3 mt-6">
        {stepError ? <p className="text-danger mb-3 text-sm">{stepError}</p> : null}
        {state?.error ? <p className="text-danger mb-3 text-sm">{state.error}</p> : null}
        {step === 1 ? (
          <button
            type="button"
            onClick={goStep2}
            className="bg-foreground text-background inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-md text-base font-bold"
          >
            다음 (사전 체크리스트) <ArrowRight className="size-4" />
          </button>
        ) : (
          <div className="space-y-2.5">
            <SubmitBtn disabled={goalCount === 0} />
            {goalCount === 0 ? (
              <p className="text-text-faint text-center text-xs">
                &lsquo;학습 상담을 통해 가장 알고 싶은 문제&rsquo;를 1개 이상 선택하면 제출할 수 있어요.
              </p>
            ) : null}
            <button
              type="button"
              onClick={goStep1}
              className="border-border text-text-dim inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-md border text-sm font-medium"
            >
              <ArrowLeft className="size-4" /> 이전 (접수 정보)
            </button>
          </div>
        )}
        <p className="text-text-faint mt-3 text-center text-xs">제출하신 정보는 상담 목적으로만 사용됩니다.</p>
      </div>
    </form>
  );
}

// Section·Field·입력 클래스는 ./intake-ui 로 이동(체크리스트 스텝과 공유).
