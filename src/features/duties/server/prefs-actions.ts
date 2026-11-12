"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";

/**
 * 업무 완성도의 '기한 내만 보기'를 계정에 저장한다(`users.ui_prefs.duties.ontimeOnly`) — 다른 PC에서도 같은 보기로 열린다.
 * 끈 상태가 기본이라 끄면 키를 지운다. 게이트는 로그인만(내 화면 취향 · 읽는 쪽 = `readDutyOntimeOnly`).
 */
export async function saveDutyOntimeOnly(next: { on: boolean }): Promise<{ ok: boolean; error?: string }> {
  return patchMyUiPrefs("duties", { ontimeOnly: next?.on === true ? true : undefined });
}
