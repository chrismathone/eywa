"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";

/** 월별 추이 보기 저장 — 누르는 순간([[#90]]). 본인 표시 취향이라 로그인만 본다. 기본값이면 키를 지운다. */
export async function saveWithdrawalTrendPrefs(p: { showTotal?: boolean; kind?: string }): Promise<{ ok: boolean; error?: string }> {
  const patch: Record<string, unknown> = {};
  if (typeof p.showTotal === "boolean") patch.trend_total = p.showTotal ? undefined : "off";
  if (p.kind === "bar" || p.kind === "line") patch.trend_kind = p.kind === "line" ? "line" : undefined;
  if (Object.keys(patch).length === 0) return { ok: false, error: "잘못된 값입니다" };
  return patchMyUiPrefs("withdrawals", patch);
}
