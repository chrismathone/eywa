"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  submitPublicIntake,
  type PublicIntakeState,
} from "@/features/enrollment/server/intake-actions";
import {
  CONSULTATION_PATHS,
  GENDER_OPTIONS,
  RELATION_OPTIONS,
  SIBLINGS_OPTIONS,
} from "@/features/enrollment/form-config";

const input =
  "border-border bg-card text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex w-full items-center justify-center gap-2 rounded-md py-3 text-sm font-bold transition disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      상담 신청하기
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
  const [state, formAction] = useActionState<PublicIntakeState, FormData>(
    submitPublicIntake,
    undefined,
  );

  if (state?.ok) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <CheckCircle2 className="text-primary size-12" />
        <p className="text-foreground text-lg font-bold">접수가 완료되었습니다</p>
        <p className="text-text-dim text-sm">
          {academyName}에서 빠른 시일 내에 연락드리겠습니다. 감사합니다.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 py-8">
      <header className="mb-6 text-center">
        <p className="text-primary text-xs font-bold tracking-wide">{academyName}</p>
        <h1 className="text-foreground mt-1 text-xl font-extrabold">입학 상담 신청</h1>
        <p className="text-text-dim mt-1 text-xs">
          간단한 정보를 남겨주시면 상담 후 연락드립니다. (<span className="text-danger">*</span> 필수)
        </p>
      </header>

      <form action={formAction} className="space-y-5">
        <input type="hidden" name="token" value={token} />
        {/* 봇 허니팟 — 화면에 안 보이는 필드. 채워지면 서버가 무시. */}
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />

        <Group title="학생 정보">
          <L label="학생 이름" required>
            <input name="prospectName" required placeholder="홍길동" className={input} />
          </L>
          <div className="grid grid-cols-2 gap-3">
            <L label="성별">
              <select name="gender" defaultValue="" className={input}>
                <option value="">선택</option>
                {GENDER_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </L>
            <L label="학년">
              <select name="prospectGrade" defaultValue="" className={input}>
                <option value="">선택</option>
                {gradeLevels.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </L>
          </div>
          <L label="학교">
            <input name="prospectSchool" placeholder="예: 인재중학교" className={input} />
          </L>
          <div className="grid grid-cols-2 gap-3">
            <L label="희망 진로">
              <input name="careerGoal" placeholder="예: 의대" className={input} />
            </L>
            <L label="형제관계">
              <select name="siblings" defaultValue="" className={input}>
                <option value="">선택</option>
                {SIBLINGS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </L>
          </div>
        </Group>

        {subjectOptions.length > 0 ? (
          <Group title="희망 과목">
            <div className="flex flex-wrap gap-2">
              {subjectOptions.map((s) => (
                <label
                  key={s.value}
                  className="border-border bg-card has-checked:border-primary has-checked:bg-primary-soft inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                >
                  <input type="checkbox" name="subjects" value={s.value} className="size-3.5" />
                  {s.label}
                </label>
              ))}
            </div>
          </Group>
        ) : null}

        <Group title="학부모 정보">
          <div className="grid grid-cols-2 gap-3">
            <L label="보호자 성함">
              <input name="parentName" placeholder="홍**" className={input} />
            </L>
            <L label="관계">
              <select name="parentRelation" defaultValue="" className={input}>
                <option value="">선택</option>
                {RELATION_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </L>
          </div>
          <L label="연락처">
            <input
              name="parentPhone"
              type="tel"
              inputMode="numeric"
              placeholder="010-0000-0000"
              className={input}
            />
          </L>
          <L label="상담 경로">
            <select name="consultationPath" defaultValue="" className={input}>
              <option value="">선택</option>
              {CONSULTATION_PATHS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </L>
          <L label="주소 (동/아파트)">
            <input name="address" placeholder="예: 침산동 / 센트럴자이" className={input} />
          </L>
        </Group>

        <Group title="요청 사항">
          <textarea
            name="parentRequest"
            rows={3}
            placeholder="궁금한 점이나 상담 시 참고할 내용을 적어주세요."
            className={`${input} resize-y`}
          />
          <label className="text-foreground flex items-center gap-2 text-sm">
            <input type="checkbox" name="shuttleBusRequest" value="true" className="size-4" />
            셔틀버스 이용을 희망합니다
          </label>
        </Group>

        <div className="space-y-2">
          <label className="text-foreground flex items-start gap-2 text-[13px]">
            <input type="checkbox" name="privacyAgreement" value="true" required className="mt-0.5 size-4" />
            <span>
              <span className="text-danger">*</span> 개인정보 수집·이용에 동의합니다(상담 목적, 보관 후 파기).
            </span>
          </label>
          <label className="text-foreground flex items-start gap-2 text-[13px]">
            <input type="checkbox" name="installmentAgreement" value="true" className="mt-0.5 size-4" />
            <span>수강료 납부/환불 규정 안내에 동의합니다.</span>
          </label>
        </div>

        {state?.error ? <p className="text-danger text-sm">{state.error}</p> : null}

        <SubmitBtn />
      </form>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card/40 border-border space-y-3 rounded-lg border p-4">
      <h2 className="text-text-dim text-xs font-bold">{title}</h2>
      {children}
    </section>
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
