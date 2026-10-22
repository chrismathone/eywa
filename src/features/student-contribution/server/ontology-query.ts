import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { readableFactStudents } from "./fact-access";
import type { StudentFact } from "@/features/students/ontology/types";
import { summarizeOntologyView } from "@/features/students/ontology/explorer";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { visibleStudentFacts } from "@/features/students/ontology/visible-facts";
import { getContributionIdentity } from "./identity-query";
import { getContributionGate } from "./access";
import { getContributionList } from "./queries";
import { MONTHS_TABLE } from "./store";
import { isMonth } from "../model/dates";

export async function getContributionOntology(month: string) {
  const gate = await getContributionGate();
  if (!gate || !isMonth(month)) return null;
  const list = await getContributionList();
  if (!list) return null;
  const db = createAdminClient(), tenant = gate.tenantId;
  const [rows, classes, users, readable, identity] = await Promise.all([
    list.ready ? fetchAllPaged<{ student_id: string; computed_at: string; payload: { facts?: StudentFact[] } }>((a, b) => db.from(MONTHS_TABLE).select("student_id, computed_at, payload")
      .eq("tenant_id", tenant).eq("month", month).order("student_id").range(a, b)) : Promise.resolve([]),
    fetchAllPaged<{ id: string; class_name: string }>((a, b) => db.from("classes").select("id, class_name").eq("tenant_id", tenant).order("id").range(a, b)),
    fetchAllPaged<{ id: string; display_name: string }>((a, b) => db.from("users").select("id, display_name").eq("tenant_id", tenant).order("id").range(a, b)),
    readableFactStudents(),
    getContributionIdentity(),
  ]);
  const eligible = new Set(list.rows.map((s) => s.id));
  const facts = visibleStudentFacts(tenant, rows.filter((r) => eligible.has(identity.canonical(r.student_id))).map((r) => ({ computedAt: r.computed_at, facts: r.payload.facts ?? [] })), identity.canonical)
    .filter((f) => f.access !== "student" || readable === null || readable.has(f.studentId));
  const grouped = new Map<string, StudentFact[]>();
  for (const f of facts) {
    const scopes = new Set([`academy:${tenant}`, `student:${f.studentId}`, ...f.related.map((r) => `${r.kind}:${r.id}`)]);
    for (const scope of scopes) { const group = grouped.get(scope) ?? []; group.push(f); grouped.set(scope, group); }
  }
  // 브라우저에는 월 원본 전체 대신 관점별 집계와 학생 id만 보낸다. 근거는 학생 상세에서 읽는다.
  const views = Object.fromEntries([...grouped].map(([key, group]) => {
    const colon = key.indexOf(":"), kind = key.slice(0, colon) as "student" | "class" | "teacher" | "subject" | "academy";
    return [key, summarizeOntologyView(tenant, group, { kind, id: key.slice(colon + 1) })];
  }));
  return { tenant, month, historyReady: list.historyReady, canConfigure: gate.canConfigure,
    views,
    labels: { student: list.rows.map((s) => ({ id: s.id, label: s.name, detail: schoolGradeLabel(s.school, s.grade) })), class: classes.map((c) => ({ id: c.id, label: c.class_name })),
      teacher: users.map((u) => ({ id: u.id, label: u.display_name })), subject: list.subjects.map((s) => ({ id: s.key, label: s.label })), academy: [{ id: tenant, label: "학원 전체" }] } };
}
