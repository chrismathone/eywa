"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import { useTransition } from "react";
import type { OnboardingStep } from "@/features/onboarding/steps";
import { setOnboardingDismissed } from "@/features/onboarding/server/prefs";

/**
 * 새 학원 '시작하기' 카드 — 원장이 가입 뒤 무엇부터 할지 한 줄로 본다(2026-09-22 빈 지점 점검의 가장 큰 공백).
 * 서버(getOnboardingCard)가 일반판 학원의 원장일 때만 재료를 준다 — 침산에는 이 카드가 없다.
 * 닫기는 계정 귀속(ui_prefs.onboarding) — 다른 PC에서도 닫힌 채다.
 */
export function GettingStartedCard({ steps }: { steps: OnboardingStep[] }) {
  const [pending, start] = useTransition();
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  return (
    <section className="bg-card shadow-card mb-4 rounded-2xl p-5" aria-labelledby="getting-started-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="getting-started-title" className="text-foreground text-lg font-bold">
          시작하기 <span className="num text-text-dim text-base font-semibold">{done}/{steps.length}</span>
        </h2>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => void setOnboardingDismissed(true))}
          className="text-text-dim text-sm underline underline-offset-4 disabled:opacity-50"
        >
          닫기
        </button>
      </div>
      {next ? (
        <p className="text-text-dim mt-1 text-sm">
          다음 할 일: <WindowLink href={next.href} title={next.label} className="text-primary font-semibold underline underline-offset-4">{next.label}</WindowLink> — {next.hint}
        </p>
      ) : null}
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.key}>
            <WindowLink
              href={s.href}
              title={s.label}
              className={`border-line relative flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${s.done ? "text-text-dim" : "text-foreground font-semibold"}`}
            >
              <span
                aria-hidden
                className={`num grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${s.done ? "bg-green-soft text-green" : "bg-muted text-foreground"}`}
              >
                {s.done ? <EyIcon name="check" size={14} /> : i + 1}
              </span>
              <span className={s.done ? "line-through" : undefined}>{s.label}</span>
              <span className="sr-only">{s.done ? "완료" : "아직"}</span>
            </WindowLink>
          </li>
        ))}
      </ol>
    </section>
  );
}
