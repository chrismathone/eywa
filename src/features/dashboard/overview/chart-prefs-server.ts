import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_CHART_KINDS, parseChartKinds, parseCheckView, parseDashboardDesign, type ChartKinds, type CheckView, type DashboardDesign } from "./chart-prefs";

const FALLBACK = { chartKinds: DEFAULT_CHART_KINDS, design: "standard" as DashboardDesign, checkView: "rows" as CheckView };

/** 첫 그림의 막대/꺾은선·화면 — 본인 `ui_prefs.dashboard`. 못 읽으면 기본값(표시 취향이라 실패해도 화면은 산다). */
export async function loadDashboardPrefs(): Promise<{ chartKinds: ChartKinds; design: DashboardDesign; checkView: CheckView }> {
  const user = await getCurrentUser();
  if (!user) return FALLBACK;
  const { data, error } = await createAdminClient()
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (error) return FALLBACK;
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  return { chartKinds: parseChartKinds(raw?.dashboard), design: parseDashboardDesign(raw?.dashboard), checkView: parseCheckView(raw?.dashboard) };
}
