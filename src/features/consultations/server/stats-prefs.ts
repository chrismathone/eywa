import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_STATS_PREFS, parseConsultationStatsPrefs, type ConsultationStatsPrefs } from "../stats-model";

/** 통계 패널의 첫 그림 — 본인 `ui_prefs.consultations`. 못 읽으면 기본값(표시 취향이라 화면은 산다). */
export async function loadConsultationStatsPrefs(): Promise<ConsultationStatsPrefs> {
  const user = await getCurrentUser();
  if (!user) return DEFAULT_STATS_PREFS;
  const { data, error } = await createAdminClient()
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (error) return DEFAULT_STATS_PREFS;
  return parseConsultationStatsPrefs((data?.ui_prefs as Record<string, unknown> | null)?.consultations);
}
