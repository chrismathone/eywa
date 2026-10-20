"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { parsePeriodMode } from "@/features/stats/period";

/** 출결 통계 보기 방식(12·24개월 · 일별 · 구간)을 계정에 저장 — 기본(12개월)은 키를 지운다. 게이트는 로그인만(내 화면 취향). */
export async function saveAttendanceStatsMode(next: { mode: string }): Promise<{ ok: boolean; error?: string }> {
  const mode = parsePeriodMode(next?.mode);
  if (!mode) return { ok: false, error: "알 수 없는 보기입니다" };
  return patchMyUiPrefs("attendanceStats", { mode: mode === "month" ? undefined : mode });
}
