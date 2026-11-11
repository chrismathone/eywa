"use client";

import { useState, type KeyboardEvent } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import {
  deltaOf, deltaText, rateText, yyMm, type ChurnMonth, type ChurnTeacherRow,
} from "@/features/withdrawals/teacher-churn";
import { chartMonths, monthBrief, pointsOf, segmentsOf, tenureBand } from "@/features/withdrawals/teacher-churn-view";
import { bandBg } from "./teacher-churn-table";
import { churnTip } from "./teacher-churn-tip";

/** 같은 이름의 강사가 둘이면 뒤 사람에 번호(칸끼리 구별되게). */
function nameOf(rows: readonly ChurnTeacherRow[], i: number): string {
  const same = rows.slice(0, i).filter((r) => r.name === rows[i]!.name).length;
  return same ? `${rows[i]!.name} (${same + 1})` : rows[i]!.name;
}

/**
 * '강사별 퇴원율 추이' **차트 보기**(원장 2026-11-11 *"차트로 전환도 가능하게 표/차트"*) — 강사마다 작은 선 차트를 표와 같은 차례로
 * 나란히(Claude·Codex 협의: 한 판에 선 15~20개는 읽히지 않는다). 모든 칸이 같은 세로 눈금(`chartCeil` — 카드가 잰다)이라 높이로 견준다.
 * 점 = 마감한 퇴원율만(`pointsOf` — 표 칸과 같은 값) · 속 빈 점 = 담당 10명 미만 · 칸 바탕 = 입사 전 빗금 / 퇴사 뒤 회색(표와 같은 판정).
 * 칸 위 오른쪽 = 표 '증감' 열과 같은 두 달(`pair`)의 뒤 달 퇴원율과 증감.
 */
export function TeacherChurnChart({ rows, months, pair, ceil, portfolioLink }: {
  rows: readonly ChurnTeacherRow[];
  months: readonly ChurnMonth[];
  pair: readonly [string, string] | null;
  /** 모든 칸 공통 세로 눈금 끝(%) — 카드가 `chartCeil`로 한 번 재서 범례와 함께 쓴다. */
  ceil: number;
  portfolioLink: boolean;
}) {
  const axis = chartMonths(months);
  if (!axis.length) {
    return <p className="bg-bg-soft rounded-lg px-4 py-3 text-sm" role="status">고른 기간에 마감한 달이 없습니다.</p>;
  }
  return (
    <div className="-mx-1 max-h-[34rem] overflow-auto px-1">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        {rows.map((r, i) => <Tile key={r.id} row={r} name={nameOf(rows, i)} axis={axis} pair={pair} ceil={ceil} portfolioLink={portfolioLink} />)}
      </ul>
    </div>
  );
}

function Tile({ row: r, name, axis, pair, ceil, portfolioLink }: {
  row: ChurnTeacherRow; name: string; axis: readonly ChurnMonth[]; pair: readonly [string, string] | null; ceil: number; portfolioLink: boolean;
}) {
  // 고른 달 — 탭·클릭·좌우 화살표로(마우스 오버 카드는 터치·키보드에 닿지 않는다). 없으면 칸 아래에 처음·끝 달.
  // 달 글자 + 고를 때의 축으로 들고 있다 — 기간·필터가 바뀌어 축이 달라지면 고른 달은 풀린다(되돌려도 되살아나지 않게).
  const axisKey = axis.map((m) => m.month).join(",");
  const [pick, setPick] = useState<{ month: string; axisKey: string } | null>(null);
  const setActiveMonth = (month: string | null) => setPick(month === null ? null : { month, axisKey });
  const n = axis.length;
  const found = !pick || pick.axisKey !== axisKey ? -1 : axis.findIndex((m) => m.month === pick.month);
  const active = found < 0 ? null : found;
  const xPct = (k: number) => ((k + 0.5) / n) * 100;
  const yPct = (rate: number) => 100 - (Math.min(rate, ceil) / ceil) * 100;
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
  const pts = pointsOf(r, axis);
  const last = pair ? r.cells[pair[1]] : undefined;
  const lastOk = !!last && last.closed && last.state === "ok";
  const d = deltaOf(r, pair);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? -1 : 1;
    setActiveMonth(axis[Math.min(n - 1, Math.max(0, active === null ? (step < 0 ? n - 1 : 0) : active + step))]!.month);
  };
  const picked = active !== null ? axis[active] : undefined;
  return (
    <li className="border-line rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold break-keep">
            {name}
            {portfolioLink ? (
              <WindowLink href={`/class-review?tab=portfolio&teacher=${encodeURIComponent(r.id)}`} title={`${r.name} 직원 포트폴리오`}
                className="hover:text-primary shrink-0 text-xs" ariaLabel={`${r.name} 직원 포트폴리오 열기`}>↗</WindowLink>
            ) : null}
          </p>
          {r.subjects.length ? <p className="text-xs font-medium break-keep">{r.subjects.join(" · ")}</p> : null}
        </div>
        {/* 표 '증감' 열과 같은 판정 — 값 · 마감 전 · 비교 없음(—). */}
        <div className="num shrink-0 text-right">
          <p className="text-sm font-bold">{lastOk ? rateText(last!.rate!) : last && !last.closed ? <span className="text-xs font-medium">마감 전</span> : "—"}</p>
          {d.kind === "value" ? <p className="text-xs">{deltaText(d.delta)}</p>
            : d.kind === "open" && lastOk ? <p className="text-xs">마감 전</p>
              : lastOk ? <p className="text-xs">—</p> : null}
        </div>
      </div>
      <div tabIndex={0} role="group" aria-label={`${name} 달별 퇴원율 — 좌우 화살표로 달을 고릅니다`} onKeyDown={onKey}
        className="focus-visible:outline-primary relative mt-2 h-20 rounded-sm focus-visible:outline-2">
        {/* 재직 밖 바탕 — 표 칸 색과 같은 판정·같은 색 · 고른 달은 옅게 표시. */}
        <div aria-hidden className="absolute inset-0 grid" style={cols}>
          {axis.map((m, k) => (
            <span key={m.month} className={k === active ? "bg-primary-softer" : undefined} style={k === active ? undefined : bandBg(tenureBand(r, m.month))} />
          ))}
        </div>
        <div aria-hidden className="text-primary absolute inset-x-0 inset-y-2">
          <span className="border-line absolute inset-x-0 top-0 border-t border-dashed" />
          <span className="border-line absolute inset-x-0 bottom-0 border-b" />
          <svg className="absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none">
            {segmentsOf(pts).filter((s) => s.length > 1).map((s) => (
              <polyline key={s[0]} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke"
                strokeLinejoin="round" strokeLinecap="round" points={s.map((k) => `${k + 0.5},${yPct(pts[k]!.rate)}`).join(" ")} />
            ))}
          </svg>
          {pts.map((p, k) => p ? (
            <span key={axis[k]!.month} style={{ left: `${xPct(k)}%`, top: `${yPct(p.rate)}%` }}
              className={`absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-current ${p.small ? "bg-card" : "bg-current"}`} />
          ) : null)}
        </div>
        {/* 마우스 오버 = 그 달 칸 전체(작은 점을 겨누지 않게 · 카드 문구는 표 칸과 같다) · 누르면 그 달을 아래에 글로. */}
        <div aria-hidden className="absolute inset-0 grid" style={cols}>
          {axis.map((m, k) => <span key={m.month} onClick={() => setActiveMonth(k === active ? null : m.month)} {...churnTip(r, m, r.cells[m.month])} />)}
        </div>
      </div>
      <p aria-live="polite" className="num text-text-faint mt-1 flex justify-between gap-2 text-xs">
        {picked ? (
          <span className="text-foreground">{yyMm(picked.month)} · {monthBrief(r, picked.month, r.cells[picked.month])}</span>
        ) : (
          <><span>{yyMm(axis[0]!.month)}</span><span>{n > 1 ? yyMm(axis.at(-1)!.month) : ""}</span></>
        )}
      </p>
    </li>
  );
}
