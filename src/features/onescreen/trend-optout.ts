/**
 * **학습 추세 미발송**(원장 2026-09-18 *"수학 선생님 수업보고서에 '학습 추세 미발송' 체크 추가 … 체크한 학생은
 * 다음에도 계속 체크되어있게 (같은 선생님의 같은 반 내에서 계속)"*) — 순수 규칙(Vitest).
 *
 * 🔑 **저장 자리 = 선생님 계정 `users.ui_prefs.onescreen.trendOptOut`**(반·학생 키 배열).
 *    · *"같은 선생님"* = 계정 귀속이라 저절로 성립한다(대신 쓰는 다른 선생님에겐 안 번진다).
 *    · *"같은 반 내에서"* = 키가 `반:학생`이라 같은 학생의 다른 반엔 안 번진다.
 *    · 마이그레이션이 필요 없다 — 원스크린은 강사 전원의 hot path라 새 컬럼을 안 싣는다([[#95]]).
 * 🔴 **효과는 '학부모 카드의 학습 추세 칸이 비는 것'**이다 — 카드는 그 칸이 비면 절을 통째로 숨긴다
 *    (`parent-report-card.tsx`). 그래서 /r·PDF·ClassNote 캡처 세 표면이 **따로 손대지 않아도** 함께 따라간다.
 * ⚠️ 성적 추이 **그래프**는 별개 축(학원설정 `showTrendGraph`)이라 이 체크와 무관하다.
 */

/** ui_prefs 안의 키 — `onescreen` 네임스페이스 아래. */
export const TREND_OPTOUT_PREF = "trendOptOut";

/** 반·학생 한 쌍의 키. 🔴 반이 없는 행(수업외 보강)은 키를 만들지 않는다 — '같은 반'이 성립하지 않는다. */
export function trendOptOutKey(classId: string | null | undefined, studentId: string): string | null {
  return classId ? `${classId}:${studentId}` : null;
}

/**
 * `users.ui_prefs` → 켜진 키 목록. 모양이 어긋나면 **빈 목록**(=전부 발송, 종전 동작)이다 —
 * 모르는 값을 '미발송'으로 읽으면 학부모가 받던 것을 조용히 끊는다.
 */
export function readTrendOptOut(uiPrefs: unknown): string[] {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) return [];
  const ns = (uiPrefs as Record<string, unknown>).onescreen;
  if (!ns || typeof ns !== "object" || Array.isArray(ns)) return [];
  const raw = (ns as Record<string, unknown>)[TREND_OPTOUT_PREF];
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === "string" && /^[^:]+:[^:]+$/.test(k));
}

/** 켜기·끄기 뒤의 목록(중복 없음 · 순서 보존). */
export function nextTrendOptOut(current: readonly string[], key: string, on: boolean): string[] {
  const rest = current.filter((k) => k !== key);
  return on ? [...rest, key] : rest;
}

/** 이 행은 추세를 안 보내는가. */
export function isTrendOptedOut(
  optOut: ReadonlySet<string> | readonly string[],
  classId: string | null | undefined,
  studentId: string,
): boolean {
  const key = trendOptOutKey(classId, studentId);
  if (!key) return false;
  return Array.isArray(optOut) ? optOut.includes(key) : (optOut as ReadonlySet<string>).has(key);
}
