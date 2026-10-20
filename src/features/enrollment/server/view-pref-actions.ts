"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { parsePeriodMode } from "@/features/stats/period";
import { ENROLLMENT_VIEW_PREFS_NS, parseEnrollmentView } from "../view-pref";

/**
 * 신규 콜&상담 '보기'를 **본인 계정**에 저장 — `RememberPrefs`가 부른다(다음 방문용).
 * 게이트는 로그인만(`patchMyUiPrefs`) — 내 화면의 표시 취향이라 상담 쓰기 권한과 무관하다.
 * 이름공간은 코드로 고정한다(클라가 다른 화면 설정을 못 덮게). 모르는 값은 저장하지 않는다.
 */
export async function saveEnrollmentViewPref(next: { view: string }): Promise<{ ok: boolean; error?: string }> {
  const view = parseEnrollmentView(next?.view);
  if (!view) return { ok: false, error: "알 수 없는 보기입니다" };
  return patchMyUiPrefs(ENROLLMENT_VIEW_PREFS_NS, { view: view === "kanban" ? undefined : view });
}

/** 통계 보기 '상담 진행 기록'의 보기 방식 — 기본(12개월)은 키를 지운다. */
export async function saveProgressTrendMode(next: { mode: string }): Promise<{ ok: boolean; error?: string }> {
  const mode = parsePeriodMode(next?.mode);
  if (!mode) return { ok: false, error: "알 수 없는 보기입니다" };
  return patchMyUiPrefs(ENROLLMENT_VIEW_PREFS_NS, { progressTrend: mode === "month" ? undefined : mode });
}

/**
 * 통계 보기 '신규 문의 추이'의 **보기 방식**(월별 12·24개월 · 일별 · 구간)을 계정에 저장 — 고른 달·구간은 남기지 않는다(`period.ts`).
 * 기본(월별 12개월)은 키를 지운다.
 */
export async function saveIntakeTrendMode(next: { mode: string }): Promise<{ ok: boolean; error?: string }> {
  const mode = parsePeriodMode(next?.mode);
  if (!mode) return { ok: false, error: "알 수 없는 보기입니다" };
  return patchMyUiPrefs(ENROLLMENT_VIEW_PREFS_NS, { intakeTrend: mode === "month" ? undefined : mode });
}
