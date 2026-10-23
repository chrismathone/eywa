import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { readableFactStudents } from "./fact-access";
import { getContributionReadIdentity } from "./identity-query";
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
    readableFactStudents(), getContributionReadIdentity(),
  ]);
  if (!directory || !snapshot) return null;
  const projection = snapshot.ready ? await cachedOntologyViews(tenant, month, directory.rows.map((s) => s.id),
    identity.ids.map((id): [string, string] => [id, identity.canonical(id)]), readable === null ? null : [...readable], snapshot.refreshedAt,
    identity.issues.map((i) => i.studentId)) : { views: {}, unresolved: 0 };
  // Hidden makeup pools are source bookkeeping, not selectable regular classes.
  const visibleClasses = new Set(directory.classes.map((c) => c.id));
  const projected = Object.fromEntries(Object.entries(projection.views).filter(([key]) => !key.startsWith("class:") || visibleClasses.has(key.slice(6)))
    .map(([key, view]) => [key, { ...view, related: view.related.filter((r) => r.kind !== "class" || visibleClasses.has(r.id)) }]));
  return { tenant, month, historyReady: snapshot.historyReady, canConfigure: gate.canConfigure, views: projected, identityIssues: identity.issues.length + projection.unresolved,
    labels: { student: directory.rows.map((s) => ({ id: s.id, label: s.name, detail: schoolGradeLabel(s.school, s.grade) })),
      class: directory.classes.map((c) => ({ id: c.id, label: c.class_name })),
      // A monthly teacher is evidenced by that month's records, including former staff who taught then.
      teacher: users.filter((u) => projected[`teacher:${u.id}`]?.factCount > 0).map((u) => ({ id: u.id, label: u.display_name })),
      subject: directory.subjects.map((s) => ({ id: s.key, label: s.label })),
      academy: [{ id: tenant, label: "학원 전체" }] } };
}
