"use client";

import { memo } from "react";
import { formatMdW } from "../calendar";
import { dayDescription } from "../day-schedule";
import { resolveWeek } from "../focus";
import { GAP, RINGS, arcPath, dayAngles, weekAngles, withGap } from "../geometry";
import { FOCUS_STROKE, HAIRLINE, HOLIDAY_TICK_FILL, NO_CLASS_FILL, NO_CLASS_TICK_FILL, TICK_FILL, TODAY_STROKE } from "../palette";
import { ringActive } from "../view-mode";
import { useProgressMap } from "./map-state";
import { RingOutline } from "./ring-outline";
import { Segment } from "./segment";
import { SELECTION_STROKE_WIDTH } from "./svg-consts";

/**
 * 주간 링 — 그 해 모든 날의 날짜 칸. 실제 수업·진도 색과 비수업일의 옅은 바탕을 구분한다.
 * 오늘 = 호박색 테두리. 초점 주는 띠 바깥에 학원색 테두리를 두르고, 그 주가 안쪽 일간 링으로 펼쳐진다.
 */
export const WeekRing = memo(function WeekRing() {
  const { view, mode, focus, selectDay, years } = useProgressMap();
  const active = ringActive("week", mode);
  const week = resolveWeek(view, focus);
  const span = weekAngles(view.year, focus.month, week.index);
  return (
    <g>
      <g aria-hidden="true" className="pointer-events-none">
        <path d={arcPath(RINGS.week[0], RINGS.week[1], 0, 180)} fill={NO_CLASS_FILL} />
        <path d={arcPath(RINGS.week[0], RINGS.week[1], 180, 360)} fill={NO_CLASS_FILL} />
      </g>
      {view.months.flatMap((m) =>
        m.weeks.flatMap((w) =>
          w.days.map((d) => {
            if (d.status === "none" && !d.holidayName && !d.noClassReason && !d.isClassDay) return null;
            const [a0, a1] = withGap(dayAngles(d.date), GAP.dayTick);
            const noPlan = d.status === "no-plan";
            const fill = d.noClassReason || (d.status === "none" && !d.isClassDay)
              ? d.holidayName ? HOLIDAY_TICK_FILL : NO_CLASS_TICK_FILL : TICK_FILL[d.status];
            return (
              <Segment
                key={d.date}
                d={arcPath(RINGS.week[0], RINGS.week[1], a0, a1)}
                fill={fill}
                stroke={d.isToday ? TODAY_STROKE : noPlan ? HAIRLINE : undefined}
                strokeWidth={d.isToday ? 2.5 : noPlan ? 1 : 0}
                label={`${formatMdW(d.date)} · ${dayDescription(d)}`}
                target={{ kind: "day", date: d.date }}
                onSelect={years.includes(Number(d.date.slice(0, 4))) ? () => selectDay(d.date) : undefined}
                focusable={false}
              />
            );
          }),
        ),
      )}
      {span ? (
        <g className="pointer-events-none" aria-hidden>
          <path
            d={arcPath(RINGS.week[0] - 2, RINGS.week[1] + 2, span[0] - 0.2, span[1] + 0.2)}
            fill="none"
            stroke="var(--background)"
            strokeWidth={SELECTION_STROKE_WIDTH + 4}
          />
          <path
            d={arcPath(RINGS.week[0] - 2, RINGS.week[1] + 2, span[0] - 0.2, span[1] + 0.2)}
            fill="none"
            stroke={FOCUS_STROKE}
            strokeWidth={SELECTION_STROKE_WIDTH}
          />
        </g>
      ) : null}
      {active ? <RingOutline inner={RINGS.week[0]} outer={RINGS.week[1]} /> : null}
    </g>
  );
});
