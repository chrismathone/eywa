/**
 * MCS 보기 설정 — **계정 귀속**(`users.ui_prefs.mcs`). 순수(서버·클라 공용이라 `server-only` 금지, [[#61]]).
 *
 * 🔴 localStorage에 두지 않는다(원장 2026-08-04 *"당연하지만 항상"*) — localStorage는 **포트까지 포함한
 *    origin 단위**라 "로그인은 그대로인데 설정만 리셋"으로 위장한다([[#90]]). 다른 PC에서 열어도
 *    마지막에 본 보기로 열려야 한다.
 * ⚠️ 네임스페이스는 `mcs` — ECS(`ecs`)와 섞지 않는다. 두 시트는 축이 달라 같은 토글이 같은 뜻이 아니다.
 */
export type McsMonthView = "sheet" | "track";

/**
 * 기본은 진도표(sheet). 원장 시안 확정 2026-08-31 — A안(학생 × 수업일)이 기본이고
 * B안(진도 레일)은 "얼마나 나갔나"를 볼 때 넘어가는 보기다.
 */
export const DEFAULT_MCS_MONTH_VIEW: McsMonthView = "sheet";

function mcsScope(uiPrefs: unknown): Record<string, unknown> | null {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) return null;
  const ns = (uiPrefs as Record<string, unknown>).mcs;
  if (!ns || typeof ns !== "object" || Array.isArray(ns)) return null;
  return ns as Record<string, unknown>;
}

export function readMcsMonthView(uiPrefs: unknown): McsMonthView {
  return normalizeMcsMonthView(mcsScope(uiPrefs)?.monthView);
}

/** 모르는 값은 기본(진도표) — 저장값이 깨졌다고 화면이 비면 안 된다. */
export function normalizeMcsMonthView(raw: unknown): McsMonthView {
  return raw === "track" ? "track" : DEFAULT_MCS_MONTH_VIEW;
}
