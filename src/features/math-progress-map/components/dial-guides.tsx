import { CX, CY, DRILL_RINGS, RINGS, polar } from "../geometry";

const FULL_RADII = [RINGS.day[1] + 4, RINGS.week[1] + 4, RINGS.month[1] + 4, RINGS.year[1] + 4];
const DRILL_RADII = [DRILL_RINGS.period[0] - 5, DRILL_RINGS.period[1] + 4];

/** 실제 기간 경계에 맞춘 보조 눈금. 데이터 레이어 아래에서 링의 깊이를 읽도록 돕는다. */
export function DialGuides({ periods = 12, full = false }: { periods?: number; full?: boolean }) {
  return (
    <g className="pointer-events-none" aria-hidden fill="none">
      {(full ? FULL_RADII : DRILL_RADII).map((radius) => (
        <circle key={radius} cx={CX} cy={CY} r={radius} stroke="var(--map-grid, var(--line))" strokeWidth={1} />
      ))}
      {Array.from({ length: periods }, (_, index) => {
        const angle = index * 360 / periods;
        const start = polar(RINGS.quarter[1] + 4, angle);
        const end = polar(RINGS.quarter[1] + 13, angle);
        return <line key={index} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="var(--neutral-fill)" strokeWidth={1.5} />;
      })}
    </g>
  );
}
