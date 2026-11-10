"use client";

import { TierStars } from "@/features/student-contribution/components/relative-score";
import type { Verdict } from "../../view-admin-levels";

const TONE: Record<Verdict["grade"], string> = { good: "bg-green-soft text-green", warn: "bg-amber-soft text-amber", bad: "bg-danger-soft text-danger", wait: "bg-bg-soft text-text-dim", none: "bg-bg-soft text-text-dim" };
const DOT: Record<Verdict["grade"], string> = { good: "bg-green", warn: "bg-amber", bad: "bg-danger", wait: "bg-text-placeholder", none: "bg-text-placeholder" };

/** 판정 배지 — 1~9등급(로열티와 같은 등급제 · 기한 준수율 기준) / 평가 대기 / 해당 없음(`judge` 한 곳의 결과를 그린다). */
export function VerdictBadge({ v, className = "" }: { v: Verdict; className?: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-bold ${TONE[v.grade]} ${className}`}>{v.label}</span>;
}

const pctOf = (part: number, due: number) => Math.round((part / due) * 100);
/**
 * 배지 + 별 + **결론 한 줄**, 그 아래 막대 하나 — 기한이 온 업무가 어떻게 끝났나(제때 초록 · 늦게 주황 · 안 함 빨강)와 건수.
 * 관리자가 숫자를 해석하지 않고 바로 읽게: 잘하고 있나 → 문제면 '늦게 하는' 쪽인가 '안 하는' 쪽인가 → 평균보다 얼마나.
 */
export function VerdictLine({ v, plain }: { v: Verdict; /** 등급 · 별 없이(반 · 학생 — 표본이 작아 등급이 한 건에 크게 흔들리고, 학생 옆 등급은 학생 평가로 읽힌다). */ plain?: boolean }) {
  const m = v.mix;
  return <div className="grid gap-1.5">
    <div className="flex flex-wrap items-center gap-2">
      {plain ? null : <VerdictBadge v={v} />}
      {v.tier && !plain ? <TierStars tier={`${v.tier}등급`} /> : null}
      {v.reason ? <span className="text-sm font-semibold">{v.reason}</span> : null}
      {v.gap ? <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${v.gap.diff > 0 ? "bg-green-soft text-green" : "bg-danger-soft text-danger"}`}>{v.gap.label} 평균보다 {Math.abs(v.gap.diff)}% {v.gap.diff > 0 ? "높음" : "낮음"}</span> : null}
    </div>
    {m && v.tier ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="bg-bg-soft flex h-2 w-56 max-w-full overflow-hidden rounded-full" aria-hidden>
        <span className="bg-green h-full" style={{ width: `${(m.ontime / m.due) * 100}%` }} />
        <span className="bg-amber h-full" style={{ width: `${(m.lateDone / m.due) * 100}%` }} />
        <span className="bg-danger h-full" style={{ width: `${(m.missed / m.due) * 100}%` }} />
      </span>
      <span className="text-xs font-semibold tabular-nums"><span className="text-green">{pctOf(m.ontime, m.due)}%</span> <span className="text-text-dim font-medium">{m.ontime.toLocaleString("ko-KR")}건</span></span>
      {m.lateDone ? <span className="text-xs font-semibold tabular-nums"><span className="text-amber">기한 후 완료 {pctOf(m.lateDone, m.due)}%</span> <span className="text-text-dim font-medium">{m.lateDone.toLocaleString("ko-KR")}건</span></span> : null}
      {m.missed ? <span className="text-xs font-semibold tabular-nums"><span className="text-danger">미처리 {pctOf(m.missed, m.due)}%</span> <span className="text-text-dim font-medium">{m.missed.toLocaleString("ko-KR")}건</span></span> : null}
    </div> : null}
  </div>;
}

/** 목록 줄 앞 점 — 트리·학생 표처럼 자리가 좁은 곳. */
export function VerdictDot({ grade }: { grade: Verdict["grade"] }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[grade]}`} aria-hidden />;
}
