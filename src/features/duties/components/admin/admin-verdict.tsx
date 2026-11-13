"use client";

import { TierStars } from "@/features/student-contribution/components/relative-score";
import { mixPercents, type Verdict } from "../../view-admin-levels";
import type { MixKey } from "../../view-admin";
import { MIX_COLOR, MIX_LABEL } from "./admin-mix";

const TONE: Record<Verdict["grade"], string> = { good: "bg-green-soft text-green", warn: "bg-amber-soft text-amber", bad: "bg-danger-soft text-danger", wait: "bg-bg-soft text-text-dim", none: "bg-bg-soft text-text-dim" };
const DOT: Record<Verdict["grade"], string> = { good: "bg-green", warn: "bg-amber", bad: "bg-danger", wait: "bg-text-placeholder", none: "bg-text-placeholder" };

/** 판정 배지 — 1~9등급(로열티와 같은 등급제 · 기한 내 완료율 기준) / 평가 대기 / 해당 없음(`judge` 한 곳의 결과를 그린다). */
export function VerdictBadge({ v, className = "" }: { v: Verdict; className?: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-bold ${TONE[v.grade]} ${className}`}>{v.label}</span>;
}

const n = (v: number) => v.toLocaleString("ko-KR");
/** 막대의 한 몫 — 색 네모 · 이름 · % · 건수. */
function Part({ k, pct, count }: { k: MixKey; pct: number; count: number }) {
  return <span className="flex items-center gap-1 text-xs font-semibold whitespace-nowrap tabular-nums">
    <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: MIX_COLOR[k] }} />{MIX_LABEL[k]} {pct}% <span className="text-text-dim font-medium">{n(count)}건</span>
  </span>;
}
/**
 * 배지 + 별 + **결론 한 줄**, 그 아래 막대 하나 — 그 기간 업무가 어떻게 끝났나(기한 내 노랑 · 기한 후 완료 회색 · 미처리 차콜 · 남은 것은 빈 바탕)와 건수.
 * 첫 숫자(기한 내)가 곧 등급을 매긴 숫자다(내림). 관리자가 숫자를 해석하지 않고 바로 읽게: 다 했나 → 모자라면 안 한 쪽인가 늦은 쪽인가 남은 쪽인가.
 */
export function VerdictLine({ v, plain }: { v: Verdict; /** 등급 · 별 없이(반 · 학생 — 표본이 작아 등급이 한 건에 크게 흔들리고, 학생 옆 등급은 학생 평가로 읽힌다). */ plain?: boolean }) {
  const m = v.mix;
  const pc = m ? mixPercents(m) : null;
  return <div className="grid gap-1.5">
    <div className="flex flex-wrap items-center gap-2">
      {plain ? null : <VerdictBadge v={v} />}
      {v.tier && !plain ? <TierStars tier={`${v.tier}등급`} /> : null}
      {v.reason ? <span className="text-sm font-semibold">{v.reason}</span> : null}
      {v.gap ? <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${v.gap.diff > 0 ? "bg-green-soft text-green" : "bg-danger-soft text-danger"}`}>{v.gap.label} 평균보다 {Math.abs(v.gap.diff)}% {v.gap.diff > 0 ? "높음" : "낮음"}</span> : null}
    </div>
    {m && v.tier ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {/* 색은 표의 칸(가로 막대 하나를 몫대로)과 같다 — 이 줄의 색 네모와 이름이 곧 그 색의 풀이다. */}
      <span className="flex h-2.5 w-56 max-w-full overflow-hidden rounded-full" style={{ background: MIX_COLOR.left }} aria-hidden>
        <span className="h-full" style={{ width: `${(m.good / m.total) * 100}%`, background: MIX_COLOR.ontime }} />
        <span className="h-full" style={{ width: `${(m.lateDone / m.total) * 100}%`, background: MIX_COLOR.lateDone }} />
        <span className="h-full" style={{ width: `${(m.missed / m.total) * 100}%`, background: MIX_COLOR.missed }} />
      </span>
      {/* 첫 숫자(기한 내)가 곧 등급을 매긴 숫자다. %는 표의 칸과 같은 셈이다(`mixPercents` — 미처리는 올림). */}
      <Part k="ontime" pct={pc!.ontime} count={m.good} />
      {m.lateDone ? <Part k="lateDone" pct={pc!.lateDone} count={m.lateDone} /> : null}
      {m.missed ? <Part k="missed" pct={pc!.missed} count={m.missed} /> : null}
      {m.left ? <Part k="left" pct={pc!.left} count={m.left} /> : null}
    </div> : null}
  </div>;
}

/** 목록 줄 앞 점 — 트리·학생 표처럼 자리가 좁은 곳. */
export function VerdictDot({ grade }: { grade: Verdict["grade"] }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[grade]}`} aria-hidden />;
}
