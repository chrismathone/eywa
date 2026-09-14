"use client";

import { memo } from "react";
import { RINGS, polar } from "../geometry";
import { ringActive } from "../view-mode";
import { useProgressMap } from "./map-state";
import { RingPill } from "./ring-outline";

const mid = (b: readonly [number, number]) => (b[0] + b[1]) / 2;

/**
 * 맨 위(12시)에 한 줄로 서는 링 이름 알약 넷 — 연간·월간·주간·일간(레퍼런스 이미지와 같은 자리). 일간 알약은 가운데 원과
 * 일간 링 사이(r 147)에 앉아, 일간 링이 어느 각도에 펼쳐져도 겹치지 않는다.
 */
export const RingLabels = memo(function RingLabels() {
  const { mode } = useProgressMap();
  const year = polar(mid(RINGS.year), 0);
  const month = polar(mid(RINGS.month), 0);
  const week = polar(mid(RINGS.week), 0);
  const day = polar(RINGS.dayLabel, 0);
  return (
    <g>
      <RingPill x={year.x} y={year.y} label="연간" active={ringActive("year", mode)} />
      <RingPill x={month.x} y={month.y} label="월간" active={ringActive("month", mode)} />
      <RingPill x={week.x} y={week.y} label="주간" active={ringActive("week", mode)} />
      <RingPill x={day.x} y={day.y} label="일간" active={ringActive("day", mode)} />
    </g>
  );
});
