"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import type { VideoHomeworkDueMode } from "@/features/video-homework/due";
import { VIDEO_DUE_DEFAULT_PREF } from "@/features/video-homework/due-pref";

/**
 * 영상 숙제 마감의 **내 기본값** 저장 — `users.ui_prefs.onescreen.videoDueDefault`(원장 2026-10-28, due-pref.ts).
 * 원스크린에서 행의 마감(7일 · 다음 수업)을 고를 때마다 화면이 부른다 — 다음 새 줄부터 그 값으로 시작한다.
 * ⚠️ 7일은 키를 지운다(기본값은 저장하지 않는다). '다른 강사 뷰'(열람 전용)는 저장하지 않는다(글씨 크기 저장과 같은 이유).
 * ⚠️ `revalidatePath` 없음 — 화면 state가 이미 반영했고 이 저장은 다음 방문용이다.
 */
export async function setMyVideoDueDefault(mode: VideoHomeworkDueMode): Promise<{ ok: boolean; error?: string }> {
  if (mode !== "week" && mode !== "next") return { ok: false, error: "잘못된 마감입니다" };
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  return patchMyUiPrefs("onescreen", { [VIDEO_DUE_DEFAULT_PREF]: mode === "next" ? "next" : undefined });
}
