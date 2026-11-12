import { palette } from "@/components/analytics/chart-math";

/**
 * '강사별 퇴원율 추이' 선 색 — 표의 이름 고르기 · 표 아래 선 비교 · 한 차트 보기가 같은 값을 쓴다(같은 강사 = 같은 색).
 * 강조 셋 = 계기판 색(차콜 · 노랑 · 회색) · 고른 차례 = 이 차례. 나머지 강사 = 옅은 회색(전체 흐름의 바탕).
 */
export const LINE_COLORS = [palette[0]!, palette[1]!, palette[2]!];
export const CONTEXT_COLOR = palette[4]!;
