"use client";

import type { Verdict } from "../../view-admin-levels";

const TONE: Record<Verdict["grade"], string> = { good: "bg-green-soft text-green", warn: "bg-amber-soft text-amber", bad: "bg-danger-soft text-danger", wait: "bg-bg-soft text-text-dim", none: "bg-bg-soft text-text-dim" };
const DOT: Record<Verdict["grade"], string> = { good: "bg-green", warn: "bg-amber", bad: "bg-danger", wait: "bg-text-placeholder", none: "bg-text-placeholder" };

/** 판정 배지 — 잘하고 있음 / 주의 / 미흡 / 평가 대기 / 의무 없음(`judge` 한 곳의 결과를 그린다). */
export function VerdictBadge({ v, className = "" }: { v: Verdict; className?: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-bold ${TONE[v.grade]} ${className}`}>{v.label}</span>;
}

/** 배지 + 근거 한 줄(숫자). */
export function VerdictLine({ v }: { v: Verdict }) {
  return <div className="flex flex-wrap items-center gap-2">
    <VerdictBadge v={v} />
    {v.reason ? <span className="text-text-dim text-xs font-medium">{v.reason}</span> : null}
  </div>;
}

/** 목록 줄 앞 점 — 트리·학생 표처럼 자리가 좁은 곳. */
export function VerdictDot({ grade }: { grade: Verdict["grade"] }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[grade]}`} aria-hidden />;
}
