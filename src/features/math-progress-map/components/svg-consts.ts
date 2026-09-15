/**
 * 링 컴포넌트가 함께 쓰는 SVG 상수 — 글자 크기·선 굵기는 **viewBox 단위**다(1100 기준, 화면에선 약 0.55~0.7배로 줄어든다).
 * 화면 글자 하한(14px)을 지키려면 viewBox 글자는 20 이상이어야 한다(700px 지도에서 20 → 13.5px, 24 → 16px).
 */
export { CX, CY } from "../geometry";

export const FONT = {
  /** 달 이름 "9월" */
  month: 24,
  /** 달 진도율 알약 */
  monthPct: 18,
  /** "3주" */
  week: 18,
  /** 요일 글자 "수" */
  weekday: 21,
  /** 요일 아래 날짜 "16" */
  dayNum: 16,
  /** 분기 이름 */
  quarter: 20,
} as const;

export const FOCUS_STROKE_WIDTH = 1.5;
export const CURRENT_STROKE_WIDTH = 3;
export const SELECTION_STROKE_WIDTH = 4;
export const SEGMENT_TEXT = "pointer-events-none select-none";
