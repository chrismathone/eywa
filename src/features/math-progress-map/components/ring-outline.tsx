import { CX, CY, FOCUS_STROKE_WIDTH } from "./svg-consts";
import { FOCUS_STROKE, HAIRLINE, RING_STROKE } from "../palette";

/** 활성 링(지금 보기 단위)의 경계 두 원 — 다른 링을 흐리지 않고 자리만 가리킨다. */
export function RingOutline({ inner, outer }: { inner: number; outer: number }) {
  return (
    <g className="pointer-events-none" aria-hidden>
      <circle cx={CX} cy={CY} r={inner - 3} fill="none" stroke={RING_STROKE} strokeWidth={FOCUS_STROKE_WIDTH} />
      <circle cx={CX} cy={CY} r={outer + 3} fill="none" stroke={RING_STROKE} strokeWidth={FOCUS_STROKE_WIDTH} />
    </g>
  );
}

/** 링 이름 알약("연간"·"월간"…) — 활성 링은 학원색으로 채운다. */
export function RingPill({ x, y, label, active }: { x: number; y: number; label: string; active: boolean }) {
  return (
    <g className="pointer-events-none select-none" aria-hidden>
      <rect x={x - 30} y={y - 14} width={60} height={28} rx={14} fill={active ? FOCUS_STROKE : "white"} stroke={active ? FOCUS_STROKE : HAIRLINE} strokeWidth={1.5} />
      <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="central" fontSize={17} fontWeight={700} fill={active ? "white" : "var(--foreground)"}>
        {label}
      </text>
    </g>
  );
}
