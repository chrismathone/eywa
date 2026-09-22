import "server-only";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { SCENARIOS } from "../plan.mjs";
import type { DemoRosterControl } from "../types";

const IDS = ["neighborhood", "targetHeavy", "dual", "split"] as const;

/**
 * 데모 지점 원장에게만 드롭다운 재료를 준다. 그 외(침산 포함)는 null — 조회도 버튼도 없다.
 * 슬러그 `demo`만 통과한다. 일반판이라는 이유만으로 열지 않는다.
 */
export async function getDemoRosterControl(): Promise<DemoRosterControl | null> {
  const user = await getCurrentUser();
  if (!user || user.systemRole !== "master") return null;

  const supabase = await createClient();
  const { data: tenant } = await supabase.from("tenants").select("slug").eq("id", user.tenantId).maybeSingle();
  if (tenant?.slug !== "demo") return null;

  const { data: rows } = await supabase
    .from("classes")
    .select("notes")
    .eq("tenant_id", user.tenantId)
    .like("notes", "demo-roster:%")
    .limit(8);

  const found = new Set(
    (rows ?? [])
      .map((row) => String(row.notes ?? "").slice("demo-roster:".length))
      .filter((id) => id in SCENARIOS),
  );
  const options = IDS.map((id) => ({ id, label: SCENARIOS[id].title }));
  return {
    currentId: found.size === 1 ? [...found][0] : null,
    mixed: found.size > 1,
    options,
  };
}
