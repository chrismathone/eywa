"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { PAGE_MAXIMIZE_KEY, PAGE_MAXIMIZE_NS } from "../prefs";

/**
 * '화면 최대화' 켜고 끄기를 본인 계정에 저장 — 누르는 순간 저장([[#90]]: 닫을 때 저장하면 유실).
 *
 * - 게이트는 **로그인만**(`patchMyUiPrefs`) — 내 계정의 표시 취향이라 권한과 무관하다.
 * - 꺼짐(기본값)은 키를 지운다.
 * - `revalidatePath` 없음 — 클라가 진실이고 이 저장은 **새로고침·다른 PC**용이다(셸 레이아웃이 다음 요청에 읽는다).
 * - 감사로그 없음 — 보기 설정이라 출결 보기 설정(`attendance/server/prefs-actions.ts`)과 같은 결이다.
 * 🔴 네임스페이스는 여기서 **코드로 고정**한다(`patchMyUiPrefs`는 서버 액션이 아니다 — 클라가 아무 화면 설정이나 못 덮게).
 */
export async function setMyPageMaximized(on: unknown): Promise<{ ok: boolean; error?: string }> {
  if (typeof on !== "boolean") return { ok: false, error: "잘못된 값입니다" };
  return patchMyUiPrefs(PAGE_MAXIMIZE_NS, { [PAGE_MAXIMIZE_KEY]: on ? true : undefined });
}
