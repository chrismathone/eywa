/**
 * 진도맵 색 — **앱 토큰만** 쓴다(`globals.css`의 CSS 변수). 화면 파일에 hex를 적지 않는다.
 *
 * 분기는 옅은 배경, 학습 상태는 민트·호박색·회색으로 읽는다. 선택은 학원색 채움과 흰 글자,
 * 현재 날짜는 호박색 점선으로 구분한다. 진행 중의 호박색은 이 지도 안에서 현재 위치를 뜻한다.
 * 글자가 있는 완료 칸은 민트 바탕 + 진한 잉크, 가는 날짜 눈금은 같은 초록을 더 진하게 쓴다.
 * 색은 칸에만 적용하고 글자나 다른 링 전체의 투명도를 낮추지 않는다.
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
  1: { soft: tint("--blue", 5), mid: tint("--blue", 13), ink: "var(--blue)", pill: "blue", label: "1분기" },
  2: { soft: tint("--green", 5), mid: tint("--green", 13), ink: "var(--green)", pill: "green", label: "2분기" },
  3: { soft: tint("--chart-3", 6), mid: tint("--chart-3", 15), ink: "var(--amber)", pill: "amber", label: "3분기" },
  4: { soft: tint("--purple", 5), mid: tint("--purple", 13), ink: "var(--purple)", pill: "purple", label: "4분기" },
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
  completed: tint("--green", 20),
  "in-progress": tint("--chart-3", 30),
  missed: tint("--neutral-fill", 42),
  planned: "var(--bg-soft)",
  "no-plan": "white",
  none: "white",
};

/** 좁은 날짜 눈금은 글자가 없어 더 진한 색으로 학습 리듬을 드러낸다. */
export const TICK_FILL: Record<DisplayStatus, string> = {
  ...STATUS_FILL,
  completed: tint("--green", 74),
  "in-progress": "var(--amber)",
};

/** 작은 글자는 옅은 칸 위에 진한 잉크로 — 앱 토큰을 따라가면서 명도 대비를 확보한다. */
export const STATUS_INK: Record<DisplayStatus, string> = {
  completed: "color-mix(in srgb, var(--green) 80%, var(--foreground))",
  "in-progress": "color-mix(in srgb, var(--amber) 80%, var(--foreground))",
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
  "in-progress": "amber",
  missed: "neutral",
  planned: "neutral",
  "no-plan": "neutral",
  none: "neutral",
};

/** 선택은 진한 채움 + 흰 글자·여백, 현재 위치는 호박색 점선. 보기 단위의 원 테두리는 더 옅게. */
export const FOCUS_FILL = "var(--primary)";
export const FOCUS_INK = "var(--primary-foreground)";
export const FOCUS_STROKE = "var(--primary)";
export const TODAY_STROKE = "var(--amber)";
export const RING_STROKE = tint("--primary", 35);
export const HAIRLINE = "var(--line)";

/** 날짜 표식은 학습 상태와 별개다. 선택된 공휴일은 남색 위에서도 읽히는 밝은 붉은 잉크. */
export const HOLIDAY_INK = "var(--danger)";
export const HOLIDAY_SELECTED_INK = tint("--danger", 28);
export const HOLIDAY_FILL = tint("--danger", 7);
export const HOLIDAY_TICK_FILL = tint("--danger", 42);
export const NO_CLASS_FILL = "var(--bg-soft)";
export const NO_CLASS_INK = "var(--neutral-fill)";
export const NO_CLASS_TICK_FILL = tint("--neutral-fill", 18);
