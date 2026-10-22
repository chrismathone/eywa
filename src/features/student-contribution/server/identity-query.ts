import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { studentIdentity } from "@/features/students/ontology/identity";
import { getContributionGate } from "./access";
export const getContributionIdentity = cache(async () => {
  const gate = await getContributionGate();
  if (!gate) throw new Error("기여도 기록을 열람할 수 없습니다");
  const db = createAdminClient();
  const rows = await fetchAllPaged<{ id: string; notes: string | null }>((a, b) => db.from("students").select("id, notes")
    .eq("tenant_id", gate.tenantId).order("id").range(a, b));
  return { canonical: studentIdentity(rows), ids: rows.map((r) => r.id) };
});
