"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logDbError } from "@/lib/supabase/db-error";
import { writeUiPrefsNs } from "@/lib/ui-prefs/write";

/**
 * '시작하기' 카드 닫기/다시 보기 — `users.ui_prefs.onboarding.dismissed`만 갱신(계정 귀속 보기 설정, 원장 2026-08-04 규약).
 * ⚠️ 형제 키(다른 화면 보기 설정)는 반드시 보존한다 — 통째로 덮으면 남의 화면 설정이 조용히 날아간다.
 * 감사로그 없음: 내 화면의 표시 취향이다(데이터·권한을 바꾸지 않는다 — 다른 보기 설정 저장과 같은 규약).
 */
export async function setOnboardingDismissed(dismissed: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const { error } = await writeUiPrefsNs(createAdminClient(), { userId: user.id, tenantId: user.tenantId }, "onboarding", {
    replace: { dismissed: dismissed === true },
  });
  if (error) {
    logDbError(error, "onboarding.setOnboardingDismissed");
    return { ok: false, error: "저장하지 못했습니다" };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}
