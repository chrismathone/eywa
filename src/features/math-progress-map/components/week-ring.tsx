"use client";

import { memo } from "react";
import { formatMdW } from "../calendar";
import { dayDescription } from "../day-schedule";
import { resolveWeek } from "../focus";
import { GAP, RINGS, arcPath, dayAngles, withGap } from "../geometry";
import { FOCUS_STROKE, HAIRLINE, NO_CLASS_FILL, TICK_FILL, TODAY_STROKE } from "../palette";
import { weekSessionLayout } from "../session-layout";
import { ringActive } from "../view-mode";
import { useProgressMap } from "./map-state";
import { RingOutline } from "./ring-outline";
import { Segment } from "./segment";
import { SELECTION_STROKE_WIDTH } from "./svg-consts";

/**
 * 주간 링 — 기존 주차 경계 안에 실제 수업만 배치한다. 보강도 같은 날짜순 눈금에 들어간다.
 * 오늘 = 호박색 테두리. 초점 주는 띠 바깥에 학원색 테두리를 두르고, 그 주가 안쪽 일간 링으로 펼쳐진다.
 */
export const WeekRing = memo(function WeekRing() {
  const { view, mode, focus, selectDay, years } = useProgressMap();
  const active = ringActive("week", mode);
  const week = resolveWeek(view, focus);
  const span = [dayAngles(week.start)[0], dayAngles(week.end)[1]];
  return (
    <g>
      <g aria-hidden="true" className="pointer-events-none">
        <path d={arcPath(RINGS.week[0], RINGS.week[1], 0, 180)} fill={NO_CLASS_FILL} />
        <path d={arcPath(RINGS.week[0], RINGS.week[1], 180, 360)} fill={NO_CLASS_FILL} />
      </g>
      {view.months.flatMap((m) =>
        m.weeks.flatMap((w) =>
          weekSessionLayout(w).map(({ day: d, angles }) => {
            const [a0, a1] = withGap(angles, GAP.dayTick);
            const noPlan = !d.record;
            return (
              <Segment
                key={d.date}
                d={arcPath(RINGS.week[0], RINGS.week[1], a0, a1)}
                fill={TICK_FILL[d.status]}
                stroke={d.isToday ? TODAY_STROKE : noPlan ? HAIRLINE : undefined}
                strokeWidth={d.isToday ? 2.5 : noPlan ? 1 : 0}
                selected={focus.day === d.date}
                label={`${formatMdW(d.date)} · ${dayDescription(d)}`}
                target={{ kind: "day", date: d.date }}
                onSelect={years.includes(Number(d.date.slice(0, 4))) ? () => selectDay(d.date) : undefined}
                focusable={false}
              />
            );
          }),
        ),
      )}
      {!week.inactive ? (
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
