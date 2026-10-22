import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday, shiftMonth } from "@/lib/date-kst";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { readableFactStudents } from "./fact-access";
import { contributionRoster, type ContributionRosterStudent } from "../model/roster";
import type { BackfillReport } from "../model/backfill-report";
import { getContributionGate } from "./access";
import { contributionReady, loadContributionMonths, loadContributionSettings, loadContributionTotals, SETTINGS_TABLE, SIGNALS_TABLE } from "./store";
import type { SignalRow } from "./signals";
import { getContributionIdentity } from "./identity-query";
import { visibleStudentFacts } from "@/features/students/ontology/visible-facts";
import type { StudentFact } from "@/features/students/ontology/types";
import { emptyRaws } from "../model/config";
import { emptyPayload, type StoredContributionMonth } from "../model/stored";
import { MONTHS_TABLE } from "./store";

export const getContributionList = cache(async () => {
  const gate = await getContributionGate();
  if (!gate) return null;
  const db = createAdminClient(), tenant = gate.tenantId;
  const [ready, config, settings, students, enrollments, classes] = await Promise.all([
    contributionReady(db, tenant), loadContributionSettings(db, tenant), getTenantSettingsByTenantId(tenant, { failOnReadError: true }),
    fetchAllPaged<ContributionRosterStudent>((a, b) => db.from("students").select("id, name, school, grade, status, is_test, notes, withdrawal_metadata")
      .eq("tenant_id", tenant).order("id").range(a, b)),
    fetchAllPaged<{ student_id: string; class_id: string }>((a, b) => db.from("enrollments").select("student_id, class_id").eq("tenant_id", tenant).order("id").range(a, b)),
    fetchAllPaged<{ id: string; subject: string; class_name: string }>((a, b) => db.from("classes").select("id, subject, class_name").eq("tenant_id", tenant).order("id").range(a, b)),
  ]);
  const roster = contributionRoster(students, new Set(enrollments.map((e) => e.student_id)));
  const totals = ready ? await loadContributionTotals(db, tenant, roster.map((s) => s.id), shiftMonth(kstToday().slice(0, 7), -11)) : [];
  const byStudent = new Map(totals.map((r) => [r.studentId, r]));
  const byClass = new Map(classes.map((c) => [c.id, c]));
  const rows = roster.map((s) => ({ id: s.id, name: s.name, school: s.school, grade: s.grade, status: s.status,
    subjects: [...new Set(enrollments.filter((e) => e.student_id === s.id).flatMap((e) => byClass.get(e.class_id)?.subject ?? []))],
    total: byStudent.get(s.id) ?? null }));
  return { gate, ready, ...config, rows, subjects: settings.operations.subjects.map((s) => ({ key: s.key, label: s.label })), grades: settings.operations.gradeLevels };
});

export async function getContributionStudent(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const gate = await getContributionGate();
  if (!gate) return null;
  const db = createAdminClient();
  const { data: student, error } = await db.from("students").select("id, name, notes, is_test").eq("tenant_id", gate.tenantId).eq("id", id).maybeSingle();
  if (error) throw new Error("원생을 확인하지 못했습니다");
  if (!student || student.is_test || student.notes?.trimStart().startsWith("중복 병합:")) return null;
  const [ready, settings] = await Promise.all([contributionReady(db, gate.tenantId), loadContributionSettings(db, gate.tenantId)]);
  if (!ready) return { gate, student, settings, ready, months: [], signals: [] };
  const identity = await getContributionIdentity();
  const sourceIds = identity.ids.filter((source) => identity.canonical(source) === id);
  const [months, signals, readable, inherited] = await Promise.all([loadContributionMonths(db, gate.tenantId, id),
    fetchAllPagedInChunks<SignalRow>(sourceIds, (chunk, a, b) => db.from(SIGNALS_TABLE).select("id, source, source_id, student_id, source_hash, occurred_on, author_label, classification, evidence, model_label, judged_at, cancelled_at, cancel_reason, rejudge_requested_at")
      .eq("tenant_id", gate.tenantId).in("student_id", chunk).order("id").range(a, b)), readableFactStudents(),
    fetchAllPagedInChunks<{ month: string; computed_at: string; payload: { facts?: StudentFact[] } }>(sourceIds.filter((s) => s !== id), (chunk, a, b) =>
      db.from(MONTHS_TABLE).select("month, computed_at, payload").eq("tenant_id", gate.tenantId).in("student_id", chunk).order("student_id").order("month").range(a, b)),
  ]);
  const canSeeFacts = readable === null || readable.has(id);
  const snapshots = [...months.map((m) => ({ month: m.month, computedAt: m.computedAt, facts: m.payload.facts })),
    ...inherited.map((r) => ({ month: r.month, computedAt: r.computed_at, facts: r.payload.facts ?? [] }))];
  const allMonths = [...months];
  for (const sourceMonth of new Set(inherited.map((r) => r.month))) if (!allMonths.some((m) => m.month === sourceMonth)) allMonths.push({
    studentId: id, month: sourceMonth, raws: emptyRaws(), correction: emptyRaws(), closedAt: null, reconstructed: false, computedAt: "", historical: [], unavailable: [], evidenceIds: [], payload: emptyPayload(),
  } satisfies StoredContributionMonth);
  return { gate, student: { id: student.id, name: student.name }, settings, ready,
    months: allMonths.sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, historical: [], payload: { ...m.payload,
      facts: visibleStudentFacts(gate.tenantId, snapshots.filter((s) => s.month === m.month), identity.canonical).filter((f) => canSeeFacts || f.access !== "student") } })), signals };
}

export async function getContributionReview() {
  const gate = await getContributionGate();
  if (!gate?.canConfigure) return null;
  const db = createAdminClient();
  if (!(await contributionReady(db, gate.tenantId))) return null;
  const { data, error } = await db.from(SETTINGS_TABLE).select("referral_review").eq("tenant_id", gate.tenantId).maybeSingle();
  if (error) throw new Error("소개 확인 목록을 읽지 못했습니다");
  const report = data?.referral_review as (BackfillReport & { checkedAt: string }) | null;
  if (!report) return { gate, report };
  const current = await fetchAllPagedInChunks<{ id: string; referrer_student_id: string | null; referrer_staff_id: string | null }>(
    report.rows.filter((r) => r.state === "automatic" || r.state === "review").map((r) => r.consultationId),
    (chunk, a, b) => db.from("enrollment_consultations").select("id, referrer_student_id, referrer_staff_id")
      .eq("tenant_id", gate.tenantId).in("id", chunk).order("id").range(a, b));
  const linked = new Set(current.filter((c) => c.referrer_student_id || c.referrer_staff_id).map((c) => c.id));
  const rows = report.rows.map((r) => linked.has(r.consultationId) ? { ...r, state: "linked" as const } : r);
  return { gate, report: { ...report, rows, counts: { ...report.counts,
    automatic: rows.filter((r) => r.state === "automatic").length, review: rows.filter((r) => r.state === "review").length,
    linked: rows.filter((r) => r.state === "linked").length } } };
}
