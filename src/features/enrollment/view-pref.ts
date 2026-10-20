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

/** 저장된 '신규 문의 추이' 보기 방식(`saveIntakeTrendMode`) — 없거나 모르는 값이면 null(월별 12개월). */
export function savedIntakeTrendMode(uiPrefs: Record<string, unknown>): PeriodMode | null {
  const ns = uiPrefs[ENROLLMENT_VIEW_PREFS_NS];
  return parsePeriodMode(ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).intakeTrend : undefined);
}
