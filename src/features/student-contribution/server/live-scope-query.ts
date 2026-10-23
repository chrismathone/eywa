import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getContributionGate } from "./access";
import { getContributionDirectory } from "./directory";
import { readableFactStudents } from "./fact-access";
import { getContributionReadIdentity } from "./identity-query";
import { liveScopeRequest, validateLiveScope } from "@/features/students/ontology/live-scope";

/** Source scope is re-evaluated on every request; current relations never share the frozen-month cache. */
export async function getCurrentOntologyScope(raw: { kind?: string; entity?: string; q?: string; page?: string }) {
  const gate = await getContributionGate();
  if (!gate) return null;
  const request = liveScopeRequest(raw, gate.tenantId);
  const base = { canConfigure: gate.canConfigure, request };
  try {
    const user = await getCurrentUser({ teacherView: true });
    if (!user || !await canAccessTenant(user.systemRole, "students")) return { ...base, state: "forbidden" as const, data: null };
    const [directory, readable, identity] = await Promise.all([getContributionDirectory(), readableFactStudents(), getContributionReadIdentity()]);
    if (!directory) return null;
    const allowed = new Set(directory.rows.filter((s) => (readable === null || readable.has(s.id)) && identity.resolve(s.id) === s.id).map((s) => s.id));
    const { data, error } = await createAdminClient().rpc("student_ontology_current_scope", {
      p_tenant: gate.tenantId, p_students: [...allowed], p_kind: request.kind, p_entity: request.id, p_search: request.search, p_page: request.page,
    });
    if (error) {
      const state = ["PGRST202", "42883", "42P01", "42703"].includes(error.code) ? "schema_missing" as const : error.code === "42501" ? "forbidden" as const : "failed" as const;
      return { ...base, state, data: null };
    }
    const result = validateLiveScope(data, allowed), subjects = new Map(directory.subjects.map((s) => [s.key, s.label]));
    const studentDetails = new Map(directory.rows.filter((s) => allowed.has(s.id)).map((s) => [s.id, schoolGradeLabel(s.school, s.grade)]));
    const labels = (nodes: typeof result.options) => nodes.map((n) => n.kind === "subject" ? { ...n, label: subjects.get(n.id) ?? "과목 확인 필요" } : n);
    const partial = result.unresolvedAssignments > 0 || identity.issues.some((i) => readable === null || readable.has(i.studentId));
    return { ...base, request: { ...request, page: result.page }, state: partial ? "partial" as const : "ready" as const,
      data: { ...result, options: labels(result.options).map((o) => o.kind === "student" ? { ...o, detail: studentDetails.get(o.id) ?? "" } : o), connections: labels(result.connections) } };
  } catch {
    console.error("[student-ontology] current scope read failed");
    return { ...base, state: "failed" as const, data: null };
  }
}
