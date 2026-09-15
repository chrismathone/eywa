"use client";

import { memo } from "react";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { RINGS, strokeArcPath } from "../geometry";
import { PACE_META, paceLabel } from "../pace";
import { HAIRLINE } from "../palette";
import { CX, CY } from "./svg-consts";
import { useProgressMap } from "./map-state";

const ARC_R = (RINGS.yearArc[0] + RINGS.yearArc[1]) / 2;
const ARC_W = RINGS.yearArc[1] - RINGS.yearArc[0];

/** 의미색 tone → SVG 채움용 CSS 변수. */
const TONE_VAR: Record<string, string> = { green: "var(--green)", primary: "var(--primary)", danger: "var(--danger)" };

/**
 * 가운데 — "지금 어디인가"를 3초 안에: 연간 진도율(큰 숫자) · 교재 · 대단원 · 쪽 · 계획 대비.
 * 바깥 가는 호가 연간 진도율을 다시 한 번 그린다(숫자와 그림이 같은 값).
 */
export const CurrentPosition = memo(function CurrentPosition({ viewed = false }: { viewed?: boolean }) {
  const { view, progress, sourceProgress, focus, pace } = useProgressMap();
  const subjectLabel = useSubjectMaps().labelOf("math");
  const c = progress.curriculum;
  const otherYear = view.year !== sourceProgress.year;
  const selectedPlan = view.months[focus.month - 1]?.plan;
  const isActualMonth = view.year === sourceProgress.year && focus.month === Number(sourceProgress.asOf.slice(5, 7));
  const viewedBook = selectedPlan?.bookName ?? "계획 없음";
  const viewedChapter = isActualMonth ? c.chapter : selectedPlan?.chapter ?? "";
  const t = (dy: number) => CY + dy;
  const paceFill = TONE_VAR[TONE_COLOR[PACE_META[pace.status].tone]] ?? "var(--foreground)";
  return (
    <g className="pointer-events-none select-none" data-clock-center={viewed ? "" : undefined}>
      <circle cx={CX} cy={CY} r={RINGS.center} fill="var(--card)" stroke={HAIRLINE} strokeWidth={1} />
      <circle cx={CX} cy={CY} r={ARC_R} fill="none" stroke="var(--bg-soft)" strokeWidth={ARC_W} />
      {view.pct > 0 ? (
        <path d={strokeArcPath(ARC_R, 0, (360 * view.pct) / 100)} fill="none" stroke="var(--green)" strokeWidth={ARC_W} strokeLinecap="round" />
      ) : null}
      <text x={CX} y={t(-88)} textAnchor="middle" dominantBaseline="central" fontSize={18} fontWeight={500} fill="var(--text-dim)">
        {viewed ? `${view.year}년 ${focus.month}월 · ${subjectLabel}` : `${view.year}년 ${subjectLabel} ${progress.estimated ? "예상 진도" : "진도율"}`}
      </text>
      <text x={CX} y={t(-36)} textAnchor="middle" dominantBaseline="central" fontSize={progress.estimated ? 60 : 80} fontWeight={700} fill="var(--foreground)" className="num">
        {progress.estimated ? "예정" : `${view.pct}%`}
      </text>
      <text x={CX} y={t(12)} textAnchor="middle" dominantBaseline="central" fontSize={18} fontWeight={500} fill="var(--text-dim)" className="num">
        {progress.estimated ? `계획 ${view.plannedPages}쪽` : `${view.donePages} / ${view.plannedPages}쪽`}
      </text>
      <line x1={CX - 64} x2={CX + 64} y1={t(30)} y2={t(30)} stroke={HAIRLINE} strokeWidth={1} />
      <text x={CX} y={t(50)} textAnchor="middle" dominantBaseline="central" fontSize={22} fontWeight={700} fill="var(--foreground)">
        {viewed ? viewedBook : otherYear ? selectedPlan?.semester ?? "계획 없음" : c.bookName}
      </text>
      <text x={CX} y={t(76)} textAnchor="middle" dominantBaseline="central" fontSize={21} fontWeight={500} fill="var(--foreground)"
        textLength={viewed && viewedChapter.length > 14 ? 230 : undefined} lengthAdjust="spacingAndGlyphs">
        {viewed ? viewedChapter : otherYear ? selectedPlan?.chapter ?? "" : c.chapter}
      </text>
      <text x={CX} y={t(100)} textAnchor="middle" dominantBaseline="central" fontSize={17} fontWeight={500} fill="var(--foreground)" className="num">
        {viewed && !isActualMonth || otherYear ? selectedPlan ? `p.${selectedPlan.startPage}~${selectedPlan.endPage}` : "" : `p.${c.currentPage} / ${c.totalPages}`}
      </text>
      <text x={CX} y={t(120)} textAnchor="middle" dominantBaseline="central" fontSize={16} fontWeight={700} fill={otherYear ? "var(--amber)" : paceFill}>
        {viewed && !isActualMonth ? `${focus.month}월 진도 ${view.months[focus.month - 1]?.pct ?? 0}%` : otherYear ? progress.estimated ? "예상 학습 계획" : `${focus.month}월 학습 계획` : paceLabel(pace)}
      </text>
    </g>
  );
});
