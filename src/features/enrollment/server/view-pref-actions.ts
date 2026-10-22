"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { parsePeriodMode } from "@/features/stats/period";
import { ENROLLMENT_VIEW_PREFS_NS, PROGRESS_LINE_KEYS, parseEnrollmentView, parseIntakeChartKind, parseStatsSpan } from "../view-pref";

/**
 * 신규 콜&상담 '보기'를 **본인 계정**에 저장 — `RememberPrefs`가 부른다(다음 방문용).
 * 게이트는 로그인만(`patchMyUiPrefs`) — 내 화면의 표시 취향이라 상담 쓰기 권한과 무관하다.
 * 이름공간은 코드로 고정한다(클라가 다른 화면 설정을 못 덮게). 모르는 값은 저장하지 않는다.
 */
export async function saveEnrollmentViewPref(next: { view: string; statsSpan?: string | null }): Promise<{ ok: boolean; error?: string }> {
  const view = parseEnrollmentView(next?.view);
  if (!view) return { ok: false, error: "알 수 없는 보기입니다" };
  // 연도 묶음(2·3개년)도 같은 저장에 싣는다 — 따로 저장하면 보기와 연도가 한 번에 바뀔 때 두 읽고-쓰기가 겹쳐 하나를 잃는다.
  // 칸을 안 보낸 호출은 그 키를 건드리지 않는다 · 한 해(null)는 키를 지운다(다음에 열면 올해).
  const span = next && "statsSpan" in next ? { statsSpan: parseStatsSpan(next.statsSpan) ?? undefined } : {};
  return patchMyUiPrefs(ENROLLMENT_VIEW_PREFS_NS, { view: view === "kanban" ? undefined : view, ...span });
}

/** 통계 보기 '상담 진행 기록'의 보기 방식 — 고른 방식을 그대로 남긴다(저장값이 없으면 최근 구간). */
export async function saveProgressTrendMode(next: { mode: string }): Promise<{ ok: boolean; error?: string }> {
  const mode = parsePeriodMode(next?.mode);
  if (!mode) return { ok: false, error: "알 수 없는 보기입니다" };
  return patchMyUiPrefs(ENROLLMENT_VIEW_PREFS_NS, { progressTrend: mode });
}

/** 통계 보기 '상담 진행 기록'에서 끈 선 — 아는 선 키만 남긴다. */
export async function saveProgressTrendOff(next: { off: string[] }): Promise<{ ok: boolean; error?: string }> {
  const off = Array.isArray(next?.off) ? [...new Set(next.off.filter((k) => (PROGRESS_LINE_KEYS as readonly string[]).includes(k)))] : null;
  if (!off) return { ok: false, error: "알 수 없는 값입니다" };
  return patchMyUiPrefs(ENROLLMENT_VIEW_PREFS_NS, { progressOff: off });
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

/** 통계 보기 '신규 문의 추이' 일별·구간 그래프 모양(막대 · 꺾은선) — 기본(막대)은 키를 지운다. */
export async function saveIntakeChartKind(next: { kind: string }): Promise<{ ok: boolean; error?: string }> {
  const kind = parseIntakeChartKind(next?.kind);
  if (!kind) return { ok: false, error: "알 수 없는 보기입니다" };
  return patchMyUiPrefs(ENROLLMENT_VIEW_PREFS_NS, { intakeChart: kind === "bar" ? undefined : kind });
}
