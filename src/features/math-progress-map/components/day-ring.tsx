"use client";

import { memo } from "react";
import { WEEKDAY_KO, formatMdW } from "../calendar";
import { dayDescription } from "../day-schedule";
import { resolveDay, resolveWeek, weekdaySlots } from "../focus";
import { GAP, RINGS, arcPath, dayAngles, dayRingAngles, midAngle, polar, withGap } from "../geometry";
import { FOCUS_INK, HAIRLINE, HOLIDAY_FILL, HOLIDAY_INK, HOLIDAY_SELECTED_INK, NO_CLASS_FILL, NO_CLASS_INK, RING_STROKE, STATUS_FILL, STATUS_INK, TODAY_STROKE } from "../palette";
import { ringActive } from "../view-mode";
import { useProgressMap } from "./map-state";
import { Segment } from "./segment";
import { CURRENT_STROKE_WIDTH, FONT, FOCUS_STROKE_WIDTH, SEGMENT_TEXT } from "./svg-consts";
import { ClockLabel } from "./clock-label";
import { periodCount } from "../learning-dashboard";

const WEEKDAY_R = 209;
const DAYNUM_R = 182;

/**
 * 일간 링 — 초점 주(기본 이번 주)의 7일을 **넓혀** 그린다(하루 11°).
 * 요일 자리는 늘 월~일 순서(달 첫·마지막 주는 빈 칸으로 채운다).
 * 선택한 날(미선택 시 해당 주의 기준일)의 칸 중심은 바깥의 같은 날짜 눈금과 나란히 맞춘다.
 * 링 이름표는 이 요일 부채꼴을 피해서 배치한다(`ring-labels.tsx`).
 */
export const DayRing = memo(function DayRing() {
  const { view, progress, mode, focus, selectDay } = useProgressMap();
  const active = ringActive("day", mode);
  const week = resolveWeek(view, focus);
  const slots = weekdaySlots(week);
  const anchorDay = resolveDay(view, focus);
  const anchorIndex = slots.findIndex((day) => day?.date === anchorDay.date);
  const cells = dayRingAngles(midAngle(dayAngles(anchorDay.date)), 7, anchorIndex);
  return (
    <g>
      {slots.map((d, i) => {
        const [a0, a1] = withGap(cells[i]!, GAP.dayRing);
        const cellMid = midAngle(cells[i]!);
        const wp = polar(WEEKDAY_R, cellMid);
        const np = polar(DAYNUM_R, cellMid);
        const dow = WEEKDAY_KO[(i + 1) % 7]!;
        const path = arcPath(RINGS.day[0], RINGS.day[1], a0, a1);
        if (!d) {
          return (
            <g key={`empty-${i}`} className={SEGMENT_TEXT} aria-hidden>
              <path d={path} fill={STATUS_FILL.none} />
              <ClockLabel x={wp.x} y={wp.y}><text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={FONT.weekday} fontWeight={500} fill="var(--neutral-fill)">
                {dow}
              </text></ClockLabel>
            </g>
          );
        }
        const focused = focus.day === d.date;
        const noClass = d.noClassReason !== null;
        const ink = d.holidayName ? focused ? HOLIDAY_SELECTED_INK : HOLIDAY_INK
          : focused ? FOCUS_INK : noClass ? NO_CLASS_INK : STATUS_INK[d.status];
        const fill = noClass ? d.holidayName ? HOLIDAY_FILL : NO_CLASS_FILL : STATUS_FILL[d.status];
        const light = d.status === "no-plan" || d.status === "planned" || d.status === "none";
        return (
          <g key={d.date}>
            <Segment
              d={path}
              fill={fill}
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
          d={arcPath(RINGS.day[0] - 3, RINGS.day[1] + 3, cells[0]![0] - 1, cells[6]![1] + 1)}
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
