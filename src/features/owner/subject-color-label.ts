import type { SUBJECT_COLORS } from "./settings-types";

/** 과목 색 선택지의 화면 이름 — 값(영문 토큰)을 화면에 그대로 내보내지 않는다(raw 코드 노출 금지, 2026-09-22 빈 지점 점검). */
export const SUBJECT_COLOR_LABEL: Record<(typeof SUBJECT_COLORS)[number], string> = {
  primary: "남색",
  green: "초록",
  blue: "파랑",
  rose: "장밋빛",
  amber: "호박색",
  danger: "빨강",
  purple: "보라",
  gold: "금색",
  neutral: "회색",
};
