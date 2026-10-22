import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { readableFactStudents } from "./fact-access";
import { getContributionIdentity } from "./identity-query";
import { getContributionGate } from "./access";
import { getContributionDirectory, getContributionSnapshot } from "./directory";
import { cachedOntologyViews } from "./ontology-cache";
import { isMonth } from "../model/dates";

export async function getContributionOntology(month: string) {
  const gate = await getContributionGate();
  if (!gate || !isMonth(month)) return null;
  const db = createAdminClient(), tenant = gate.tenantId;
  const [directory, snapshot, users, readable, identity] = await Promise.all([
    getContributionDirectory(), getContributionSnapshot(),
    fetchAllPaged<{ id: string; display_name: string }>((a, b) => db.from("users").select("id, display_name")
      .eq("tenant_id", tenant).order("id").range(a, b)),
    readableFactStudents(), getContributionIdentity(),
  ]);
  if (!directory || !snapshot) return null;
  const views = snapshot.ready ? await cachedOntologyViews(tenant, month, directory.rows.map((s) => s.id),
    identity.ids.map((id): [string, string] => [id, identity.canonical(id)]), readable === null ? null : [...readable], snapshot.refreshedAt) : {};
  return { tenant, month, historyReady: snapshot.historyReady, canConfigure: gate.canConfigure, views,
    labels: { student: directory.rows.map((s) => ({ id: s.id, label: s.name, detail: schoolGradeLabel(s.school, s.grade) })),
      class: directory.classes.map((c) => ({ id: c.id, label: c.class_name })),
      teacher: users.map((u) => ({ id: u.id, label: u.display_name })), subject: directory.subjects.map((s) => ({ id: s.key, label: s.label })),
      academy: [{ id: tenant, label: "학원 전체" }] } };
}
