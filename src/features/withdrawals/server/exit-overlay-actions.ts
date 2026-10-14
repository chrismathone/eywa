"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { isValidYm, kstMonth, shiftMonth } from "@/lib/date-kst";
import { logDbError } from "@/lib/supabase/db-error";
import { getTenantSettings } from "@/features/owner/server/queries";
import { EXIT_OVERLAY_MAX_BACK, getExitOverlay, type ExitOverlayData } from "./exit-overlay";

export type ExitOverlayResult = { ok: true; data: ExitOverlayData } | { ok: false; error: string };

/**
 * 시간표 X 겹침의 석 달 — 키를 누를 때만 부른다(페이지가 열릴 때 미리 읽지 않는다).
 * 🔴 게이트 = 퇴원관리를 볼 수 있는 사람(`canAccessTenant(…, "withdrawals")`) — 화면이 X를 안 다는 것과 별개로 여기서 다시 본다(#77).
 * 과목은 학원설정에 있는 키만, 달은 이번 달 ~ 24달 전만 받는다.
 */
export async function loadExitOverlay(input: { subject: string; anchor?: string | null }): Promise<ExitOverlayResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "withdrawals"))) {
    return { ok: false, error: "퇴원관리를 볼 수 있는 계정만 열 수 있습니다" };
  }
  const settings = await getTenantSettings();
  if (!settings.operations.subjects.some((s) => s.key === input.subject)) {
    return { ok: false, error: "과목을 찾을 수 없습니다" };
  }
  const thisMonth = kstMonth();
  const anchor = isValidYm(input.anchor) ? input.anchor : thisMonth;
  if (anchor > thisMonth || anchor < shiftMonth(thisMonth, -EXIT_OVERLAY_MAX_BACK)) {
    return { ok: false, error: "볼 수 없는 달입니다" };
  }
  try {
    return { ok: true, data: await getExitOverlay(input.subject, anchor) };
  } catch (e) {
    logDbError(e, "withdrawals.exit-overlay", { subject: input.subject, anchor });
    return { ok: false, error: "퇴원 목록을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요." };
  }
}
