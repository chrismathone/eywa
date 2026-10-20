"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { parsePeriodMode } from "@/features/stats/period";

/** 신규생 기록 보기 방식(12·24개월 · 일별 · 구간)을 계정에 저장 — 고른 방식을 그대로 남긴다(저장값이 없으면 최근 구간). 게이트는 로그인만(내 화면 취향). */
export async function saveNewcomerStatsMode(next: { mode: string }): Promise<{ ok: boolean; error?: string }> {
  const mode = parsePeriodMode(next?.mode);
  if (!mode) return { ok: false, error: "알 수 없는 보기입니다" };
  return patchMyUiPrefs("newcomerStats", { mode });
}
