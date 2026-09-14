"use client";

import { memo } from "react";
import { formatMdW } from "../calendar";
import { resolveWeek } from "../focus";
import { GAP, RINGS, arcPath, dayAngles, weekAngles, withGap } from "../geometry";
import { FOCUS_STROKE, HAIRLINE, STATUS_FILL, STATUS_LABEL, TODAY_STROKE } from "../palette";
import { ringActive } from "../view-mode";
import { useProgressMap } from "./map-state";
import { RingOutline } from "./ring-outline";
import { Segment } from "./segment";

/**
 * 주간 링 — 그 해 **모든 날**을 가는 눈금으로(주말·기록 없는 날은 흰 틈). 한 해의 학습 리듬이 히트맵처럼 보인다.
 * 오늘 = 학원색 테두리. 초점 주는 띠 바깥에 학원색 테두리를 두르고, 그 주가 안쪽 일간 링으로 펼쳐진다.
 */
export const WeekRing = memo(function WeekRing() {
  const { view, mode, focus, selectDay } = useProgressMap();
  const active = ringActive("week", mode);
  const week = resolveWeek(view, focus);
  const span = weekAngles(view.year, focus.month, week.index);
  return (
    <g>
      {view.months.flatMap((m) =>
        m.weeks.flatMap((w) =>
          w.days.map((d) => {
            if (d.status === "none") return null;
            const [a0, a1] = withGap(dayAngles(d.date), GAP.dayTick);
            const noPlan = d.status === "no-plan";
            return (
              <Segment
                key={d.date}
                d={arcPath(RINGS.week[0], RINGS.week[1], a0, a1)}
                fill={STATUS_FILL[d.status]}
                stroke={d.isToday ? TODAY_STROKE : noPlan ? HAIRLINE : undefined}
                strokeWidth={d.isToday ? 2.5 : noPlan ? 1 : 0}
                label={`${formatMdW(d.date)} · ${STATUS_LABEL[d.status]}`}
                target={{ kind: "day", date: d.date }}
                onSelect={() => selectDay(d.date)}
                focusable={false}
              />
            );
          }),
        ),
      )}
      {span ? (
        <path
          d={arcPath(RINGS.week[0] - 2, RINGS.week[1] + 2, span[0] - 0.2, span[1] + 0.2)}
          fill="none"
          stroke={FOCUS_STROKE}
          strokeWidth={2}
          className="pointer-events-none"
          aria-hidden
        />
      ) : null}
      {active ? <RingOutline inner={RINGS.week[0]} outer={RINGS.week[1]} /> : null}
    </g>
  );
});
