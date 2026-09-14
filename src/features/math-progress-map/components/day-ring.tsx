"use client";

import { memo } from "react";
import { WEEKDAY_KO, formatMdW } from "../calendar";
import { resolveWeek, weekdaySlots } from "../focus";
import { GAP, RINGS, arcPath, dayRingAngles, midAngle, polar, weekAngles, withGap } from "../geometry";
import { HAIRLINE, STATUS_FILL, STATUS_INK, STATUS_LABEL, TODAY_STROKE } from "../palette";
import { ringActive } from "../view-mode";
import { useProgressMap } from "./map-state";
import { Segment } from "./segment";
import { CURRENT_STROKE_WIDTH, FONT, FOCUS_STROKE_WIDTH, SEGMENT_TEXT } from "./svg-consts";

const WEEKDAY_R = 209;
const DAYNUM_R = 182;

/**
 * 일간 링 — 초점 주(기본 이번 주)의 7일을 **넓혀** 그린다(하루 11°). 주간 링의 그 주에서 이 호로 점선 두 가닥이
 * 이어져 "이 부분을 확대한 것"으로 읽힌다. 요일 자리는 늘 월~일 순서(달 첫·마지막 주는 빈 칸으로 채운다).
 * '일간' 이름 알약은 다른 셋과 함께 12시에 선다(`ring-labels.tsx`) — 호를 따라다니게 두면 9시·3시 방향에서 가로 알약이
 * 일간 칸 위로 삐져나왔다(실측 2026-09-14).
 */
export const DayRing = memo(function DayRing() {
  const { view, mode, focus, selectDay } = useProgressMap();
  const active = ringActive("day", mode);
  const week = resolveWeek(view, focus);
  const span = weekAngles(view.year, focus.month, week.index);
  if (!span) return null;
  const mid = midAngle(span);
  const slots = weekdaySlots(week);
  const cells = dayRingAngles(mid, 7);
  const lens0 = { from: polar(RINGS.week[0], span[0]), to: polar(RINGS.day[1] + 3, cells[0]![0]) };
  const lens1 = { from: polar(RINGS.week[0], span[1]), to: polar(RINGS.day[1] + 3, cells[6]![1]) };
  return (
    <g>
      <g className="pointer-events-none" aria-hidden>
        <line x1={lens0.from.x} y1={lens0.from.y} x2={lens0.to.x} y2={lens0.to.y} stroke="var(--line-strong)" strokeWidth={1.5} strokeDasharray="4 4" />
        <line x1={lens1.from.x} y1={lens1.from.y} x2={lens1.to.x} y2={lens1.to.y} stroke="var(--line-strong)" strokeWidth={1.5} strokeDasharray="4 4" />
      </g>
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
              <path d={path} fill="white" stroke={HAIRLINE} strokeWidth={1} strokeDasharray="3 3" />
              <text x={wp.x} y={wp.y} textAnchor="middle" dominantBaseline="central" fontSize={FONT.weekday} fontWeight={500} fill="var(--foreground)" opacity={0.45}>
                {dow}
              </text>
            </g>
          );
        }
        const focused = focus.day === d.date && !d.isToday;
        const light = d.status === "no-plan" || d.status === "planned" || d.status === "none";
        return (
          <g key={d.date}>
            <Segment
              d={path}
              fill={STATUS_FILL[d.status]}
              stroke={d.isToday || focused ? TODAY_STROKE : light ? HAIRLINE : undefined}
              strokeWidth={d.isToday || focused ? CURRENT_STROKE_WIDTH : light ? 1 : 0}
              dashed={focused}
              label={`${formatMdW(d.date)} · ${STATUS_LABEL[d.status]}${d.plannedPages ? ` · ${d.donePages}/${d.plannedPages}쪽` : ""}`}
              target={{ kind: "day", date: d.date }}
              onSelect={() => selectDay(d.date)}
            />
            <g className={SEGMENT_TEXT} aria-hidden>
              <text x={wp.x} y={wp.y} textAnchor="middle" dominantBaseline="central" fontSize={FONT.weekday} fontWeight={700} fill={STATUS_INK[d.status]}>
                {dow}
              </text>
              <text x={np.x} y={np.y} textAnchor="middle" dominantBaseline="central" fontSize={FONT.dayNum} fontWeight={500} fill={STATUS_INK[d.status]} className="num">
                {Number(d.date.slice(8, 10))}
              </text>
            </g>
          </g>
        );
      })}
      {active ? (
        <path
          d={arcPath(RINGS.day[0] - 3, RINGS.day[1] + 3, cells[0]![0] - 1, cells[6]![1] + 1)}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={FOCUS_STROKE_WIDTH}
          className="pointer-events-none"
          aria-hidden
        />
      ) : null}
    </g>
  );
});
