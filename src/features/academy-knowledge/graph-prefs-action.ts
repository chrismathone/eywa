"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { toKgPrefPatch, type KgGraphPrefs } from "./graph-prefs";

/**
 * 지식그래프 네트워크 보기 설정 저장 — 누르는 순간 저장한다([[#90]]). 본인 표시 취향이라 로그인만 본다(연결 탐색 `saveExplorePrefs`와 같은 길).
 * 네임스페이스는 코드로 고정(`knowledgeGraph`) — 클라가 다른 화면 설정을 건드리지 못한다. `revalidatePath` 없음(클라가 진실 · 다음 방문용).
 */
export async function saveKgGraphPrefs(patch: Partial<KgGraphPrefs>): Promise<{ ok: boolean; error?: string }> {
  if (!patch || typeof patch !== "object") return { ok: false, error: "잘못된 값입니다" };
  const clean: Partial<KgGraphPrefs> = {};
  for (const k of ["netView", "colored", "labels"] as const) if (k in patch) (clean as Record<string, unknown>)[k] = patch[k];
  if (clean.netView !== undefined && clean.netView !== "records" && clean.netView !== "summary") return { ok: false, error: "잘못된 값입니다" };
  for (const k of ["colored", "labels"] as const) if (clean[k] !== undefined && typeof clean[k] !== "boolean") return { ok: false, error: "잘못된 값입니다" };
  return patchMyUiPrefs("knowledgeGraph", toKgPrefPatch(clean));
}
