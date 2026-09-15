"use client";

import { memo } from "react";
import { GAP, RINGS, arcPath, midAngle, polar, weekAngles, withGap } from "../geometry";
import { FOCUS_INK, HAIRLINE, STATUS_FILL, STATUS_INK, STATUS_LABEL, TODAY_STROKE } from "../palette";
import { ringActive } from "../view-mode";
import { useProgressMap } from "./map-state";
import { RingOutline } from "./ring-outline";
import { Segment } from "./segment";
import { CURRENT_STROKE_WIDTH, FONT, SEGMENT_TEXT } from "./svg-consts";

const LABEL_R = (RINGS.month[0] + RINGS.month[1]) / 2;
/** 이보다 좁은 주(달 끝 2~3일짜리)는 글자를 감춘다 — 글자가 칸 밖으로 샌다. */
const MIN_LABEL_SPAN = 4.2;

/**
 * 월간 링 — 완료 민트 · 진행 중 호박색 · 미학습 회색 · 예정 옅은 회색 · 계획 없음 흰 칸.
 * 이번 주 = 호박색 점선, 고른 주 = 학원색 채움과 흰 글자. 주 칸을 누르면 주간 보기로.
 */
export const MonthRing = memo(function MonthRing() {
  const { view, mode, focus, selectWeek } = useProgressMap();
  const active = ringActive("month", mode);
  return (
    <g>
      {view.months.flatMap((m) =>
        m.weeks.map((w) => {
          const angles = weekAngles(view.year, m.month, w.index);
          if (!angles) return null;
          const [a0, a1] = withGap(angles, GAP.week);
          const focused = focus.month === m.month && focus.week === w.index;
          const light = w.status === "no-plan" || w.status === "planned" || w.status === "none";
          const stroke = w.isCurrent ? TODAY_STROKE : light ? HAIRLINE : undefined;
          const lp = polar(LABEL_R, midAngle(angles));
          return (
            <g key={`${m.month}-${w.index}`}>
              <Segment
                d={arcPath(RINGS.month[0], RINGS.month[1], a0, a1)}
                fill={STATUS_FILL[w.status]}
                stroke={stroke}
                strokeWidth={w.isCurrent ? CURRENT_STROKE_WIDTH : light ? 1 : 0}
                dashed={w.isCurrent}
                selected={focused}
                label={`${m.month}월 ${w.index}주차 · ${STATUS_LABEL[w.status]} · ${w.pct}%`}
                target={{ kind: "week", month: m.month, week: w.index }}
                onSelect={() => selectWeek(m.month, w.index)}
              />
              {angles[1] - angles[0] >= MIN_LABEL_SPAN ? (
                <text
                  x={lp.x}
                  y={lp.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={FONT.week}
                  fontWeight={700}
                  fill={focused ? FOCUS_INK : STATUS_INK[w.status]}
                  className={SEGMENT_TEXT}
                  aria-hidden
                >
                  {w.index}주
                </text>
              ) : null}
            </g>
          );
        }),
      )}
      {active ? <RingOutline inner={RINGS.month[0]} outer={RINGS.month[1]} /> : null}
    </g>
  );
});
