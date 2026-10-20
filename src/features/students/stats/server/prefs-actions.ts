"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { DEFAULT_STUDENT_STATS_PREFS, parseStudentStatsPrefs, type StudentStatsPrefs } from "../model";

/**
 * 원생 통계 보기 설정 저장 — `users.ui_prefs.studentStats`(계정 귀속 · 다른 PC에서도 같은 보기).
 * **넘긴 칸만** 저장한다 — 추이 카드와 월별 기록 카드가 따로 저장해도 서로의 칸을 덮지 않게.
 * 게이트는 로그인만(내 화면의 표시 취향). 모양은 파서로 다시 거른다(클라 값을 그대로 믿지 않는다).
 * 기본값과 같은 칸은 지운다(`undefined` = 키 삭제 — 빈 값이 쌓이지 않게).
 * `revalidatePath` 없음 — 화면이 이미 바뀐 값을 그리고 있다(클라가 진실 · 저장은 다음 방문용).
 */
export async function saveStudentStatsPrefs(patch: Partial<StudentStatsPrefs>): Promise<{ ok: boolean; error?: string }> {
  const safe = parseStudentStatsPrefs({ ...DEFAULT_STUDENT_STATS_PREFS, ...patch });
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof StudentStatsPrefs)[]) {
    if (!(key in DEFAULT_STUDENT_STATS_PREFS)) continue;
    const value = safe[key];
    const isDefault = Array.isArray(value) ? value.length === 0 : value === DEFAULT_STUDENT_STATS_PREFS[key];
    out[key] = isDefault ? undefined : value;
  }
  if (!Object.keys(out).length) return { ok: true };
  return patchMyUiPrefs("studentStats", out);
}
