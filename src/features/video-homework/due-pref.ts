/**
 * 영상 숙제 마감의 **선생님별 기본값**(원장 2026-10-28) — 순수(클라·서버 공용, `server-only` 금지 [[#61]]).
 *
 * 계기: 마감 토글 기본이 7일이라, 늘 '다음 수업'을 쓰는 선생님(10/26~27 12건)이 토글은 안 바꾸고 **글의 날짜만** 다음 수업일로 고쳐
 * 보냈다 — 학부모는 10/30으로 알고, 올리기 사이트·미수행 판정은 저장된 7일(11/3)을 봤다.
 * → 선생님이 마지막으로 고른 마감(7일 · 다음 수업)을 계정에 기억해(`users.ui_prefs.onescreen.videoDueDefault`) 새 줄의 기본으로 쓴다.
 * 모르면 7일(종전 기본 — 원장 2026-10-15 *"기본값은 7일"*). 7일은 저장하지 않는다(빈 값이 쌓이지 않게 — 키가 없으면 7일).
 */
import type { VideoHomeworkDueMode } from "./due";

/** `users.ui_prefs.onescreen` 안의 키. */
export const VIDEO_DUE_DEFAULT_PREF = "videoDueDefault";

/** 저장된 기본 마감 — `"next"`만 다음 수업, 그 밖(없음·깨짐)은 7일. */
export function readVideoDueDefault(uiPrefs: unknown): VideoHomeworkDueMode {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) return "week";
  const ns = (uiPrefs as Record<string, unknown>).onescreen;
  if (!ns || typeof ns !== "object" || Array.isArray(ns)) return "week";
  return (ns as Record<string, unknown>)[VIDEO_DUE_DEFAULT_PREF] === "next" ? "next" : "week";
}
