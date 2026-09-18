"use client";

import { memo } from "react";
import { GAP, RINGS, arcPath, midAngle, polar, quarterAngles, withGap } from "../geometry";
import { AFTER_END_OPACITY, QUARTER_TINT } from "../palette";
import { useProgressMap } from "./map-state";
import { Segment } from "./segment";
import { FONT, SEGMENT_TEXT } from "./svg-consts";
import { ClockLabel } from "./clock-label";
import { periodPercent } from "../learning-dashboard";

/**
 * 분기 링 — 맨 바깥 가는 띠 넷 + 바깥 라벨. 색은 분기 정체(파스텔 잉크)이고, 초점 분기는 학원색 테두리.
 * 열두 달 링을 감싸는 활성 테두리는 연간 링이 그린다(분기 보기 = 바깥 띠 + 열두 달 함께).
 */
export const QuarterRing = memo(function QuarterRing() {
  const { view, progress, mode, focus, selectQuarter } = useProgressMap();
  const focusQ = Math.floor((focus.month - 1) / 3) + 1;
  return (
    <g>
      {view.quarters.map((q) => {
        const angles = quarterAngles(q.q);
        const [a0, a1] = withGap(angles, GAP.quarter);
        const tint = QUARTER_TINT[q.q];
        const lp = polar(RINGS.quarterLabel, midAngle(angles));
        const focused = mode === "quarter" && focusQ === q.q;
        // 석 달이 **모두** 종강 뒤일 때만 — 종강이 낀 분기는 살아 있다.
        const dead = q.afterEnd;
        return (
          <g key={q.q} opacity={dead ? AFTER_END_OPACITY : undefined}>
            <Segment
              d={arcPath(RINGS.quarter[0], RINGS.quarter[1], a0, a1)}
              fill={tint.ink}
              selected={focused}
              label={dead ? `${tint.label} · 종강 이후` : `${tint.label} · 진도율 ${periodPercent(progress, q.pct, q.plannedPages)}`}
              target={{ kind: "quarter", q: q.q }}
              onSelect={dead ? undefined : () => selectQuarter(q.q)}
              className={focused ? "" : "opacity-75"}
            />
            <ClockLabel x={lp.x} y={lp.y}><text
              x={0}
              y={0}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={FONT.quarter}
              fontWeight={700}
              fill={`var(--map-exterior-ink, ${tint.ink})`}
              className={SEGMENT_TEXT}
            >
              {tint.label}
            </text></ClockLabel>
          </g>
        );
      })}
    </g>
  );
});
