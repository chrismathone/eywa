import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_WITHDRAWAL_TREND_PREFS, parseWithdrawalTrendPrefs, type WithdrawalTrendPrefs } from "../trend-prefs";

/** 첫 그림의 월별 추이 보기 — 본인 `ui_prefs.withdrawals`. 못 읽으면 기본값(표시 취향이라 화면은 산다). */
export async function loadWithdrawalTrendPrefs(): Promise<WithdrawalTrendPrefs> {
  const user = await getCurrentUser();
  if (!user) return DEFAULT_WITHDRAWAL_TREND_PREFS;
  const { data, error } = await createAdminClient()
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (error) return DEFAULT_WITHDRAWAL_TREND_PREFS;
  return parseWithdrawalTrendPrefs((data?.ui_prefs as Record<string, unknown> | null)?.withdrawals);
}
