"use client";

import { memo } from "react";
import { GAP, RINGS, arcPath, midAngle, monthAngles, polar, withGap } from "../geometry";
import { FOCUS_INK, HAIRLINE, QUARTER_TINT, STATUS_FILL, STATUS_INK, TODAY_STROKE } from "../palette";
import { ringActive } from "../view-mode";
import { useProgressMap } from "./map-state";
import { RingOutline } from "./ring-outline";
import { Segment } from "./segment";
import { CURRENT_STROKE_WIDTH, FONT, SEGMENT_TEXT } from "./svg-consts";

/**
 * 달 이름·진도율 알약은 칸의 **중심점 하나**(r 428)에서 위·아래로 쌓는다(반지름을 달리해 방사형으로 놓으면 9시·3시
 * 방향에서 방사 = 수평이라 "10월"과 "0%"가 옆으로 나란히 서서 겹쳤다 — 실측 2026-09-14). 세로로 쌓으면 어느 각도든
 * 띠(84폭) 안에 들어간다.
 */
const LABEL_R = (RINGS.year[0] + RINGS.year[1]) / 2;
const STACK_DY = 16;

/** 달 진도율 알약 — 완료는 민트, 이번 달은 호박색, 그 외는 흰 바탕. */
function pctPill(status: "completed" | "in-progress" | "other"): { fill: string; ink: string } {
  if (status === "completed") return { fill: STATUS_FILL.completed, ink: STATUS_INK.completed };
  if (status === "in-progress") return { fill: STATUS_FILL["in-progress"], ink: STATUS_INK["in-progress"] };
  return { fill: "white", ink: "var(--foreground)" };
}

/**
 * 연간 링 — 열두 달. 칸 색은 **분기 틴트**(지난·이번 달 = 진하게, 앞 달 = 옅게)이고 완료 여부는 알약 색이 말한다.
 * 이번 달 = 호박색 점선, 고른 달(초점) = 학원색 바탕과 실선. 진도율 알약은 상태색을 유지한다.
 */
export const YearRing = memo(function YearRing() {
  const { view, mode, focus, selectMonth } = useProgressMap();
  const active = ringActive("year", mode);
  return (
    <g>
      {view.months.map((m) => {
        const angles = monthAngles(m.month);
        const [a0, a1] = withGap(angles, GAP.month);
        const mid = midAngle(angles);
        const tint = QUARTER_TINT[m.quarter];
        const focused = focus.month === m.month;
        const c = polar(LABEL_R, mid);
        const lp = { x: c.x, y: c.y - STACK_DY };
        const pp = { x: c.x, y: c.y + STACK_DY + 1 };
        const pill = pctPill(m.status === "completed" ? "completed" : m.isCurrent ? "in-progress" : "other");
        return (
          <g key={m.month}>
            <Segment
              d={arcPath(RINGS.year[0], RINGS.year[1], a0, a1)}
              fill={m.plannedPages === 0 ? "white" : m.isPast || m.isCurrent ? tint.mid : tint.soft}
              stroke={m.isCurrent ? TODAY_STROKE : undefined}
              strokeWidth={m.isCurrent ? CURRENT_STROKE_WIDTH : 0}
              dashed={m.isCurrent}
              selected={focused}
              label={`${m.month}월 · ${m.plan?.chapter ?? "계획 없음"} · 진도율 ${m.pct}%`}
              target={{ kind: "month", month: m.month }}
              onSelect={() => selectMonth(m.month)}
            />
            <g className={SEGMENT_TEXT} aria-hidden>
              <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="central" fontSize={FONT.month} fontWeight={700} fill={focused ? FOCUS_INK : "var(--foreground)"}>
                {m.month}월
              </text>
              <rect x={pp.x - 33} y={pp.y - 14} width={66} height={28} rx={14} fill={pill.fill} stroke={pill.fill === "white" ? HAIRLINE : "none"} />
              <text x={pp.x} y={pp.y + 1} textAnchor="middle" dominantBaseline="central" fontSize={FONT.monthPct} fontWeight={700} fill={pill.ink} className="num">
                {m.plannedPages > 0 ? `${m.pct}%` : "—"}
              </text>
            </g>
          </g>
        );
      })}
      {active ? <RingOutline inner={RINGS.year[0]} outer={mode === "quarter" ? RINGS.quarter[1] : RINGS.year[1]} /> : null}
    </g>
  );
});
