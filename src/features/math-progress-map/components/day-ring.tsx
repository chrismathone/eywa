"use client";

import { memo } from "react";
import { formatMdW, weekdayLabel } from "../calendar";
import { dayDescription } from "../day-schedule";
import { resolveDay, resolveWeek } from "../focus";
import { GAP, RINGS, arcPath, midAngle, polar, withGap } from "../geometry";
import { FOCUS_INK, HAIRLINE, HOLIDAY_COMPLETED_INK, HOLIDAY_INK, HOLIDAY_SELECTED_INK, RING_STROKE, STATUS_FILL, STATUS_INK, TODAY_STROKE } from "../palette";
import { daySessionLayout } from "../session-layout";
import { ringActive } from "../view-mode";
import { useProgressMap } from "./map-state";
import { Segment } from "./segment";
import { CURRENT_STROKE_WIDTH, FONT, FOCUS_STROKE_WIDTH, SEGMENT_TEXT } from "./svg-consts";
import { ClockLabel } from "./clock-label";
import { periodCount } from "../learning-dashboard";

const WEEKDAY_R = 209;
const DAYNUM_R = 182;

/**
 * 일간 링 — 초점 주의 실제 수업만 날짜순으로 펼친다(수업당 11°). 비수업 요일·빈칸은 만들지 않는다.
 * 선택한 날(미선택 시 해당 주의 기준일)의 칸 중심은 바깥의 같은 날짜 눈금과 나란히 맞춘다.
 * 링 이름표는 이 요일 부채꼴을 피해서 배치한다(`ring-labels.tsx`).
 */
export const DayRing = memo(function DayRing() {
  const { view, progress, mode, focus, selectDay } = useProgressMap();
  const active = ringActive("day", mode);
  const week = resolveWeek(view, focus);
  const sessions = daySessionLayout(week, resolveDay(view, focus).date);
  if (!sessions.length) return null;
  return (
    <g>
      {sessions.map(({ day: d, angles }) => {
        const [a0, a1] = withGap(angles, GAP.dayRing);
        const cellMid = midAngle(angles);
        const wp = polar(WEEKDAY_R, cellMid);
        const np = polar(DAYNUM_R, cellMid);
        const dow = weekdayLabel(d.date);
        const path = arcPath(RINGS.day[0], RINGS.day[1], a0, a1);
        const focused = focus.day === d.date;
        const ink = d.holidayName ? focused ? HOLIDAY_SELECTED_INK : d.status === "completed" ? HOLIDAY_COMPLETED_INK : HOLIDAY_INK
          : focused ? FOCUS_INK : STATUS_INK[d.status];
        const light = d.status === "no-plan" || d.status === "planned" || d.status === "none";
        return (
          <g key={d.date}>
            <Segment
              d={path}
              fill={STATUS_FILL[d.status]}
              stroke={d.isToday ? TODAY_STROKE : light ? HAIRLINE : undefined}
              strokeWidth={d.isToday ? CURRENT_STROKE_WIDTH : light ? 1 : 0}
              dashed={d.isToday}
              selected={focused}
              label={`${formatMdW(d.date)} · ${dayDescription(d)}${d.plannedPages ? ` · ${periodCount(progress, d.donePages, d.plannedPages)}` : ""}`}
              target={{ kind: "day", date: d.date }}
              onSelect={() => selectDay(d.date)}
            />
            <g className={SEGMENT_TEXT} aria-hidden>
              <ClockLabel x={wp.x} y={wp.y}><text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={FONT.weekday} fontWeight={700} fill={ink}>
                {dow}
              </text></ClockLabel>
              <ClockLabel x={np.x} y={np.y}><text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={FONT.dayNum} fontWeight={focused || d.holidayName ? 700 : 500} fill={ink} className="num">
                {Number(d.date.slice(8, 10))}
              </text></ClockLabel>
            </g>
          </g>
        );
      })}
      {active ? (
        <path
          d={arcPath(RINGS.day[0] - 3, RINGS.day[1] + 3, sessions[0].angles[0] - 1, sessions.at(-1)!.angles[1] + 1)}
          fill="none"
          stroke={RING_STROKE}
          strokeWidth={FOCUS_STROKE_WIDTH}
          className="pointer-events-none"
          aria-hidden
        />
      ) : null}
    </g>
  );
});
