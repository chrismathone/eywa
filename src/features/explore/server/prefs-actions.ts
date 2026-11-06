"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { toPrefPatch, type ExplorePrefs } from "../view-prefs";

/**
 * 연결 탐색 보기 설정 저장 — 누르는 순간 저장한다([[#90]] 닫을 때 저장하면 유실). 본인 표시 취향이라 로그인만 본다.
 * 네임스페이스는 코드로 고정(`explore`) — 클라가 다른 화면 설정을 건드리지 못한다. `revalidatePath` 없음(클라가 진실 · 다음 방문용).
 */
export async function saveExplorePrefs(patch: Partial<ExplorePrefs>): Promise<{ ok: boolean; error?: string }> {
  const allowed: (keyof ExplorePrefs)[] = ["instant", "mode", "netView", "colored", "labels"];
  const clean: Partial<ExplorePrefs> = {};
  for (const k of allowed) if (k in patch) (clean as Record<string, unknown>)[k] = patch[k];
  if (clean.mode !== undefined && clean.mode !== "donut" && clean.mode !== "network") return { ok: false, error: "잘못된 값입니다" };
  if (clean.netView !== undefined && clean.netView !== "records" && clean.netView !== "summary") return { ok: false, error: "잘못된 값입니다" };
  for (const k of ["instant", "colored", "labels"] as const) if (clean[k] !== undefined && typeof clean[k] !== "boolean") return { ok: false, error: "잘못된 값입니다" };
  return patchMyUiPrefs("explore", toPrefPatch(clean));
}
