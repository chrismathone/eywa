"use client";

import { memo } from "react";
import { GAP, RINGS, arcPath, midAngle, polar, weekAngles, withGap } from "../geometry";
import { AFTER_END_FILL, AFTER_END_OPACITY, FOCUS_INK, HAIRLINE, STATUS_LABEL, TODAY_STROKE, WEEK_FILL, WEEK_INK } from "../palette";
import { ringActive } from "../view-mode";
import { useProgressMap } from "./map-state";
import { RingOutline } from "./ring-outline";
import { Segment } from "./segment";
import { CURRENT_STROKE_WIDTH, FONT, SEGMENT_TEXT } from "./svg-consts";
import { ClockLabel } from "./clock-label";

const LABEL_R = (RINGS.month[0] + RINGS.month[1]) / 2;
/** 이보다 좁은 주(달 끝 2~3일짜리)는 글자를 감춘다 — 글자가 칸 밖으로 샌다. */
const MIN_LABEL_SPAN = 4.2;

/**
 * 주차 띠는 요일·날짜 칸보다 진한 상태색. 이번 주 = 호박색 점선, 고른 주 = 노란 채움과 남색 글자.
 * 주 칸을 누르면 주간 보기로.
 */
export const MonthRing = memo(function MonthRing({ showYear = false }: { showYear?: boolean }) {
  const { view, mode, focus, selectWeek, years } = useProgressMap();
  const active = ringActive("month", mode);
  return (
    <g>
      {view.months.flatMap((m) =>
        m.weeks.map((w) => {
          const year = Number(w.start.slice(0, 4));
          const angles = weekAngles(year, m.month, w.index);
          if (!angles) return null;
          const [a0, a1] = withGap(angles, GAP.week);
          // 종강 뒤 달의 주차 — 칸만 남기고 글자·클릭을 뺀다(연간 링과 같은 판정 한 곳: `m.afterEnd`).
          const dead = m.afterEnd;
          const focused = year === view.year && focus.month === m.month && focus.week === w.index;
          const light = w.status === "no-plan" || w.status === "planned" || w.status === "none";
          const stroke = w.isCurrent ? TODAY_STROKE : light ? HAIRLINE : undefined;
          const lp = polar(LABEL_R, midAngle(angles));
          return (
            <g key={`${m.month}-${w.index}`} opacity={dead ? AFTER_END_OPACITY : undefined}>
              <Segment
                d={arcPath(RINGS.month[0], RINGS.month[1], a0, a1)}
                fill={dead ? AFTER_END_FILL : WEEK_FILL[w.status]}
                stroke={stroke}
                strokeWidth={w.isCurrent ? CURRENT_STROKE_WIDTH : light ? 1 : 0}
                dashed={w.isCurrent}
                selected={focused}
                label={dead ? `${showYear ? `${year}년 ` : ""}${m.month}월 ${w.index}주차 · 종강 이후` : `${showYear ? `${year}년 ` : ""}${m.month}월 ${w.index}주차 · ${STATUS_LABEL[w.status]} · ${w.pct}%`}
                target={{ kind: "week", month: m.month, week: w.index }}
                onSelect={dead || !years.includes(year) ? undefined : () => selectWeek(m.month, w.index, year)}
              />
              {!dead && angles[1] - angles[0] >= MIN_LABEL_SPAN ? (
                <ClockLabel x={lp.x} y={lp.y}><text
                  x={0}
                  y={0}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={FONT.week}
                  fontWeight={700}
                  fill={focused ? FOCUS_INK : WEEK_INK[w.status]}
                  className={SEGMENT_TEXT}
                  aria-hidden
                >
                  {w.index}주
                </text></ClockLabel>
              ) : null}
            </g>
          );
        }),
      )}
      {active ? <RingOutline inner={RINGS.month[0]} outer={RINGS.month[1]} /> : null}
    </g>
  );
});
