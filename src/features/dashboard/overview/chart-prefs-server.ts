import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_CHART_KINDS, parseChartKinds, type ChartKinds } from "./chart-prefs";

/** 첫 그림의 막대/꺾은선 — 본인 `ui_prefs.dashboard`. 못 읽으면 막대(표시 취향이라 실패해도 화면은 산다). */
export async function loadDashboardChartKinds(): Promise<ChartKinds> {
  const user = await getCurrentUser();
  if (!user) return DEFAULT_CHART_KINDS;
  const { data, error } = await createAdminClient()
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (error) return DEFAULT_CHART_KINDS;
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  return parseChartKinds(raw?.dashboard);
}
