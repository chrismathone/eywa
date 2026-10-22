/**
 * 신규 콜&상담 '보기'(칸반 · 목록 · 통계) — 마지막으로 본 보기를 계정에 남긴다(`users.ui_prefs.enrollment.view`, 원장 2026-10-19
 * *"마지막으로 본 뷰로 사람에게 귀속"*). 서버(목록 페이지)와 저장 액션이 같은 파서를 쓴다.
 *
 * - 주소에 `view`가 있으면 그것이 이긴다(운영실 링크 `?view=table` 등). 없으면 저장값, 저장값도 없으면 칸반.
 * - 보기는 필터가 아니다 — 10분 초기화(`filter-reset/rules.ts`) 대상이 아니다.
 * - 기본(칸반)은 저장하지 않는다(키를 지운다).
 */
import { parsePeriodMode, type PeriodMode } from "@/features/stats/period";

export type EnrollmentViewValue = "kanban" | "table" | "stats";

export const ENROLLMENT_VIEW_PREFS_NS = "enrollment";

export function parseEnrollmentView(v: unknown): EnrollmentViewValue | null {
  return v === "kanban" || v === "table" || v === "stats" ? v : null;
}

/** 저장된 보기 — `ui_prefs` 원본에서 읽는다. 없거나 모르는 값이면 칸반. */
export function savedEnrollmentView(uiPrefs: Record<string, unknown>): EnrollmentViewValue {
  const ns = uiPrefs[ENROLLMENT_VIEW_PREFS_NS];
  const raw = ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).view : undefined;
  return parseEnrollmentView(raw) ?? "kanban";
}

/**
 * 통계 보기 머리글 '연도'의 **여러 해 묶음**(2·3개년) — 계정에 남긴다(검수 2026-10-22: 아래 두 추이 카드는 방식을 기억하는데 연도만
 * 매번 올해로 돌아갔다). 한 해(2026 · 2025 …)를 고르면 저장하지 않는다 — 다음에 열면 올해다(추이 카드가 고른 달은 남기지 않고
 * 방식만 남기는 것과 같은 결 · 지난 한 해에 갇히지 않게).
 */
export type StatsSpanValue = "2y" | "3y";
export function parseStatsSpan(v: unknown): StatsSpanValue | null {
  return v === "2y" || v === "3y" ? v : null;
}
/** 저장된 연도 묶음 — 없거나 모르는 값이면 null(올해). */
export function savedStatsSpan(uiPrefs: Record<string, unknown>): StatsSpanValue | null {
  const ns = uiPrefs[ENROLLMENT_VIEW_PREFS_NS];
  return parseStatsSpan(ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).statsSpan : undefined);
}

/** 저장된 '상담 진행 기록' 보기 방식(`saveProgressTrendMode`) — 없으면 null(화면이 최근 구간으로 연다 — 매일 기록이 막 쌓이기 시작한 카드라 월별은 점 하나다). */
export function savedProgressTrendMode(uiPrefs: Record<string, unknown>): PeriodMode | null {
  const ns = uiPrefs[ENROLLMENT_VIEW_PREFS_NS];
  return parsePeriodMode(ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).progressTrend : undefined);
}

/** 저장된 '신규 문의 추이' 보기 방식(`saveIntakeTrendMode`) — 없거나 모르는 값이면 null(월별 12개월). */
export function savedIntakeTrendMode(uiPrefs: Record<string, unknown>): PeriodMode | null {
  const ns = uiPrefs[ENROLLMENT_VIEW_PREFS_NS];
  return parsePeriodMode(ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).intakeTrend : undefined);
}

/** '상담 진행 기록'의 선 키 — 끈 선 저장값을 이 목록으로만 거른다(`saveProgressTrendOff`). */
export const PROGRESS_LINE_KEYS = ["received", "consulted", "levelTest", "enrolled", "assigned", "started", "stalled"] as const;
/** 처음 볼 때 끈 선 — 접수·등록·수업 시작·멈춘 상담만 그린다(선 일곱은 한 그래프에 너무 많다 · 리뷰 2026-10-21). */
export const PROGRESS_DEFAULT_OFF: readonly string[] = ["consulted", "levelTest", "assigned"];

/** 저장된 '상담 진행 기록'의 끈 선 — 저장값이 없으면 null(기본 `PROGRESS_DEFAULT_OFF`). 모르는 키는 버린다. */
export function savedProgressTrendOff(uiPrefs: Record<string, unknown>): string[] | null {
  const ns = uiPrefs[ENROLLMENT_VIEW_PREFS_NS];
  const raw = ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).progressOff : undefined;
  return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string" && (PROGRESS_LINE_KEYS as readonly string[]).includes(k)) : null;
}
