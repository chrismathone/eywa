"use client";

import { useTransition } from "react";
import { Check, Loader2 } from "@/components/icons/aywa-icon-compat";
import { toggleConsultationStep } from "@/features/withdrawals/server/actions";
import type { WithdrawalConsultation } from "@/features/withdrawals/types";

type Step = {
  key: keyof WithdrawalConsultation;
  label: string;
  description: string;
};

const STEPS: Step[] = [
  {
    key: "adminCalledParent",
    label: "관리자 ↔ 학부모 통화",
    description: "원장/관리자가 학부모와 통화 완료",
  },
  {
    key: "teacherCalledParent",
    label: "담임 ↔ 학부모 통화",
    description: "담임 강사가 학부모와 통화 완료",
  },
  {
    key: "talkedWithStudent",
    label: "학생 직접 상담",
    description: "학생과 면담을 통해 복귀 가능성 확인",
  },
];

export function ConsultationTracker({
  studentId,
  initial,
}: {
  studentId: string;
  initial: WithdrawalConsultation;
}) {
  const [isPending, startTransition] = useTransition();

  function handleToggle(key: keyof WithdrawalConsultation, next: boolean) {
    const fd = new FormData();
    fd.append("studentId", studentId);
    fd.append("step", key);
    fd.append("next", String(next));
    startTransition(async () => {
      await toggleConsultationStep(undefined, fd);
    });
  }

  return (
    <ul className="space-y-2">
      {STEPS.map((s) => {
        const checked = !!initial[s.key];
        return (
          <li
            key={s.key}
            className={`border-border flex items-start gap-3 rounded-md border px-3 py-2.5 transition ${
              checked ? "bg-chart-2/5 border-chart-2/30" : "bg-card"
            }`}
          >
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleToggle(s.key, !checked)}
              className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md border ${
                checked
                  ? "bg-chart-2 border-chart-2 text-background"
                  : "border-border text-muted-foreground hover:border-foreground/40"
              }`}
              aria-pressed={checked}
              aria-label={s.label}
            >
              {isPending ? <Loader2 className="size-3 animate-spin" /> : checked ? <Check className="size-3" /> : null}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-medium">{s.label}</p>
              <p className="text-muted-foreground text-xs">{s.description}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
