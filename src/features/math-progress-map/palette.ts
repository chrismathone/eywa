/**
 * 진도맵 색 — **앱 토큰만** 쓴다(`globals.css`의 CSS 변수). 화면 파일에 hex를 적지 않는다.
 *
 * 축이 둘이다(의미색 캐논과 같은 규칙):
 *  ① **분기 = 자리 표시**(정체) — 파스텔 틴트 넷. 옅게 깔리는 배경이라 채도가 낮다(레퍼런스 이미지의 파랑·초록·
 *     주황·보라 사분면). 완료된 달은 같은 색을 조금 진하게, 미래 달은 더 옅게.
 *  ② **상태 = 의미색 캐논** — 완료 `--green`(positive) · 진행 중 `--primary`(brand = 현재 위치) · 미학습 회색
 *     (`--neutral-fill`, 글자색 토큰이 아니라 **면 회색** 토큰) · 예정 `--bg-soft` · 휴강/계획 없음 = 흰 칸.
 * 🔴 상태 색을 분기 색으로, 분기 색을 상태 색으로 쓰지 말 것 — 한 링에 두 축이 섞이면 "9월이 초록"인지
 *    "9월이 완료"인지 못 읽는다. 연간 링은 분기 틴트 + 완료 여부는 **진하기**로, 안쪽 링은 상태 색만.
 */
import type { PillColor } from "@/components/atoms/pill";
import type { ProgressStatus } from "./model";

export type QuarterTint = {
  /** 미래 달·바탕 */
  soft: string;
  /** 완료·현재 달 */
  mid: string;
  /** 분기 띠·분기 글자 */
  ink: string;
  pill: PillColor;
  label: string;
};

/** color-mix로 옅기를 단계 짓는다 — 토큰 값이 바뀌어도(브랜드 색 주입 등) 따라온다. */
function tint(token: string, pct: number): string {
  return `color-mix(in srgb, var(${token}) ${pct}%, white)`;
}

export const QUARTER_TINT: Record<1 | 2 | 3 | 4, QuarterTint> = {
  1: { soft: tint("--blue", 9), mid: tint("--blue", 22), ink: "var(--blue)", pill: "blue", label: "1분기" },
  2: { soft: tint("--green", 9), mid: tint("--green", 22), ink: "var(--green)", pill: "green", label: "2분기" },
  3: { soft: tint("--chart-3", 11), mid: tint("--chart-3", 26), ink: "var(--chart-3)", pill: "amber", label: "3분기" },
  4: { soft: tint("--purple", 9), mid: tint("--purple", 22), ink: "var(--purple)", pill: "purple", label: "4분기" },
};

/**
 * 화면 상태 — 저장 상태 4종에 **날짜**를 얹어 다섯으로 가른다(`not-started`가 기준일 뒤면 예정, 앞이면 미학습).
 * 주말·기록 없는 날은 `none`(흰 칸, 범례 밖).
 */
export type DisplayStatus = "completed" | "in-progress" | "missed" | "planned" | "no-plan" | "none";

export function displayStatusOf(status: ProgressStatus | null, date: string, asOf: string): DisplayStatus {
  if (status == null) return "none";
  if (status === "not-started") return date > asOf ? "planned" : "missed";
  return status;
}

export const STATUS_FILL: Record<DisplayStatus, string> = {
  completed: "var(--green)",
  "in-progress": "var(--primary)",
  missed: tint("--neutral-fill", 42),
  planned: "var(--bg-soft)",
  "no-plan": "white",
  none: "white",
};

/** 칸 위 글자색 — 진한 채움 위는 흰 글자, 옅은 채움 위는 잉크. */
export const STATUS_INK: Record<DisplayStatus, string> = {
  completed: "white",
  "in-progress": "white",
  missed: "var(--foreground)",
  planned: "var(--foreground)",
  "no-plan": "var(--foreground)",
  none: "var(--foreground)",
};

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  completed: "완료",
  "in-progress": "진행 중",
  missed: "미학습",
  planned: "예정",
  "no-plan": "휴강 · 계획 없음",
  none: "기록 없음",
};

/** 범례 순서 — 레퍼런스 이미지의 넷 + 예정. */
export const LEGEND_ORDER: readonly DisplayStatus[] = ["completed", "in-progress", "missed", "planned", "no-plan"];

/** 상태 → 알약 색(목록·상세 패널). */
export const STATUS_PILL: Record<DisplayStatus, PillColor> = {
  completed: "green",
  "in-progress": "primary",
  missed: "neutral",
  planned: "neutral",
  "no-plan": "neutral",
  none: "neutral",
};

/** 초점(선택)·오늘 강조 선. */
export const FOCUS_STROKE = "var(--primary)";
export const TODAY_STROKE = "var(--primary)";
export const HAIRLINE = "var(--line)";
