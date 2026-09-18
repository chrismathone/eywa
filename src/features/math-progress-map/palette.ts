/**
 * 진도맵 색 — CSS 토큰으로만 정의한다. 남색 지도는 progress-map.module.css의 지역 토큰,
 * 바깥의 목록·상세는 기존 앱 토큰을 쓴다. 상태 판정은 두 표면에서 같다.
 * 현재 날짜는 호박색 점선, 선택은 노란 채움과 남색 글자로 구분한다.
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
  return `color-mix(in srgb, var(${token}) ${pct}%, var(--map-tint-base, white))`;
}

function quarterTint(q: number, token: string, pct: number): string {
  return `color-mix(in srgb, var(--map-quarter-${q}, var(${token})) ${pct}%, var(--map-tint-base, white))`;
}

export const QUARTER_TINT: Record<1 | 2 | 3 | 4, QuarterTint> = {
  1: { soft: quarterTint(1, "--blue", 5), mid: quarterTint(1, "--blue", 13), ink: "var(--map-quarter-1, var(--blue))", pill: "blue", label: "1분기" },
  2: { soft: quarterTint(2, "--green", 5), mid: quarterTint(2, "--green", 13), ink: "var(--map-quarter-2, var(--green))", pill: "green", label: "2분기" },
  3: { soft: quarterTint(3, "--chart-3", 6), mid: quarterTint(3, "--chart-3", 15), ink: "var(--map-quarter-3, var(--amber))", pill: "amber", label: "3분기" },
  4: { soft: quarterTint(4, "--purple", 5), mid: quarterTint(4, "--purple", 13), ink: "var(--map-quarter-4, var(--purple))", pill: "purple", label: "4분기" },
};

/**
 * 화면 상태 — 저장 상태 4종에 **날짜**를 얹어 다섯으로 가른다(`not-started`가 기준일 뒤면 예정, 앞이면 미학습).
 * 주말·기록 없는 날은 `none`(흰 칸, 범례 밖).
 */
export type DisplayStatus = "completed" | "in-progress" | "missed" | "planned" | "no-plan" | "none" | "unknown";

export function displayStatusOf(status: ProgressStatus | null, date: string, asOf: string): DisplayStatus {
  if (status == null) return "none";
  if (status === "not-started") return date > asOf ? "planned" : "missed";
  return status;
}

/**
 * **종강 뒤 칸** — 학습 상태가 아니라 "여기부터는 수업이 없다"는 뜻이라 상태색 어느 것도 쓰지 않는다
 * (`no-plan`(흰 칸)과도 다르다 — 그건 수업 기간 안의 빈 달이다). 원장 2026-09-16.
 */
export const AFTER_END_FILL = tint("--neutral-fill", 8);
/** 비활성 느낌은 색이 아니라 **옅기**로 낸다 — 글자색은 앱 전역이 한 값(#121212)이라 연한 회색 글자가 없다. */
export const AFTER_END_OPACITY = 0.4;

export const STATUS_FILL: Record<DisplayStatus, string> = {
  unknown: "var(--bg-soft)",
  completed: tint("--green", 20),
  "in-progress": `var(--map-progress-fill, ${tint("--chart-3", 30)})`,
  missed: tint("--neutral-fill", 42),
  planned: "var(--bg-soft)",
  "no-plan": "var(--map-tint-base, white)",
  none: "var(--map-tint-base, white)",
};

/** 좁은 날짜 눈금은 글자가 없어 더 진한 색으로 학습 리듬을 드러낸다. */
export const TICK_FILL: Record<DisplayStatus, string> = {
  ...STATUS_FILL,
  completed: `var(--map-completed-tick, ${tint("--green", 74)})`,
  "in-progress": "var(--map-in-progress-tick, var(--amber))",
};

/** 작은 글자는 옅은 칸 위에 진한 잉크로 — 앱 토큰을 따라가면서 명도 대비를 확보한다. */
export const STATUS_INK: Record<DisplayStatus, string> = {
  unknown: "var(--foreground)",
  completed: "var(--map-completed-ink, color-mix(in srgb, var(--green) 80%, var(--foreground)))",
  "in-progress": "var(--map-progress-ink, color-mix(in srgb, var(--amber) 80%, var(--foreground)))",
  missed: "var(--foreground)",
  planned: "var(--foreground)",
  "no-plan": "var(--foreground)",
  none: "var(--foreground)",
};

/** 1주·2주 칸은 같은 상태의 요일·날짜 칸보다 한 단계 진하게 구분한다. */
export const WEEK_FILL: Record<DisplayStatus, string> = {
  ...STATUS_FILL,
  completed: `var(--map-week-completed-fill, ${STATUS_FILL.completed})`,
};

export const WEEK_INK: Record<DisplayStatus, string> = {
  ...STATUS_INK,
  completed: `var(--map-week-completed-ink, ${STATUS_INK.completed})`,
};

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  unknown: "진도 확인 필요",
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
  unknown: "neutral",
  completed: "green",
  "in-progress": "amber",
  missed: "neutral",
  planned: "neutral",
  "no-plan": "neutral",
  none: "neutral",
};

/** 지도 선택은 노란 채움 + 남색 글자, 현재 위치는 호박색 점선. 보기 단위의 원 테두리는 더 옅게. */
export const FOCUS_FILL = "var(--map-focus-fill, var(--primary))";
export const FOCUS_INK = "var(--map-focus-ink, var(--primary-foreground))";
export const FOCUS_STROKE = "var(--map-focus-stroke, var(--primary))";
export const TODAY_STROKE = "var(--amber)";
export const RING_STROKE = `var(--map-ring-stroke, ${tint("--primary", 35)})`;
export const HAIRLINE = "var(--line)";

/** 날짜 표식은 학습 상태와 별개다. 선택된 공휴일은 선택 배경에 맞춰 붉은 글자의 대비를 확보한다. */
export const HOLIDAY_INK = "var(--danger)";
export const HOLIDAY_SELECTED_INK = "var(--map-holiday-selected-ink, color-mix(in srgb, var(--danger) 28%, white))";
export const HOLIDAY_FILL = tint("--danger", 7);
export const HOLIDAY_TICK_FILL = tint("--danger", 42);
export const NO_CLASS_FILL = "var(--bg-soft)";
export const NO_CLASS_INK = "var(--neutral-fill)";
export const NO_CLASS_TICK_FILL = tint("--neutral-fill", 18);
