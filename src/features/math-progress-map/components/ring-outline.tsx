import { CX, CY, FOCUS_STROKE_WIDTH } from "./svg-consts";
import { RING_STROKE } from "../palette";

/** 활성 링(지금 보기 단위)의 경계 두 원 — 다른 링을 흐리지 않고 자리만 가리킨다. */
export function RingOutline({ inner, outer }: { inner: number; outer: number }) {
  return (
    <g className="pointer-events-none" aria-hidden>
      <circle cx={CX} cy={CY} r={inner - 3} fill="none" stroke={RING_STROKE} strokeWidth={FOCUS_STROKE_WIDTH} />
      <circle cx={CX} cy={CY} r={outer + 3} fill="none" stroke={RING_STROKE} strokeWidth={FOCUS_STROKE_WIDTH} />
    </g>
  );
}
