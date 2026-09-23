"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import {
  DEFAULT_GOALS_BOARD_ROLE,
  DEFAULT_GOALS_BOARD_VIEW,
  normalizeGoalsBoardRole,
  normalizeGoalsBoardView,
} from "../lib/goals-board";

/**
 * 반 계획 보기(/ecs/goals)의 역할 토글(담임/부담임)을 본인 계정에 저장 — `users.ui_prefs.ecs.goalsRole`.
 * ⚠️ 서버가 표를 그리므로 호출부가 저장 뒤 `router.refresh()`. 기본값(담임)이면 키를 지운다.
 * ⚠️ 내 계정의 보기 설정일 뿐이라 반 게이트·감사로그 대상이 아니다(다른 ECS 보기 설정과 같은 규약).
 */
export async function setMyEcsGoalsRole(role: string): Promise<{ ok: boolean; error?: string }> {
  const safe = normalizeGoalsBoardRole(role);
  if (safe !== role) return { ok: false, error: "잘못된 값입니다" };
  return patchMyUiPrefs("ecs", { goalsRole: safe === DEFAULT_GOALS_BOARD_ROLE ? undefined : safe });
}

/** 반 계획 보기의 보기 단위(일간/주간)를 본인 계정에 저장 — `users.ui_prefs.ecs.goalsView`. */
export async function setMyEcsGoalsView(view: string): Promise<{ ok: boolean; error?: string }> {
  const safe = normalizeGoalsBoardView(view);
  if (safe !== view) return { ok: false, error: "잘못된 값입니다" };
  return patchMyUiPrefs("ecs", { goalsView: safe === DEFAULT_GOALS_BOARD_VIEW ? undefined : safe });
}
