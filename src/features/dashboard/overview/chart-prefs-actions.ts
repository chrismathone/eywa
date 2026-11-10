"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { chartPrefKey, isChartPanel, type ChartKind, type CheckView } from "./chart-prefs";

/**
 * 추이 패널 막대/꺾은선 저장 — 누르는 순간 저장([[#90]]: 닫을 때 저장하면 유실). 본인 표시 취향이라 로그인만 본다.
 * 기본값(막대)은 키를 지운다. `revalidatePath` 없음 — 클라가 진실이고 이 저장은 다음 방문용이다.
 */
export async function saveDashboardChartKind(panel: string, kind: string): Promise<{ ok: boolean; error?: string }> {
  if (!isChartPanel(panel) || (kind !== "bar" && kind !== "line")) return { ok: false, error: "잘못된 값입니다" };
  const k: ChartKind = kind;
  return patchMyUiPrefs("dashboard", { [chartPrefKey(panel)]: k === "line" ? "line" : undefined });
}

/** 확인할 일 보기(항목별 · 사람별) 저장 — 누르는 순간 저장한다. 기본(항목별)은 키를 지운다. */
export async function saveDashboardCheckView(view: CheckView): Promise<{ ok: boolean; error?: string }> {
  if (view !== "rows" && view !== "people") return { ok: false, error: "잘못된 값입니다" };
  return patchMyUiPrefs("dashboard", { check_view: view === "people" ? "people" : undefined });
}
