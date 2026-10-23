"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isMergedStudent } from "@/features/students/status/merged";
import { pendingDetails, type PendingDetail } from "../model/pending-details";
import type { Metric } from "../model/config";
import type { BillingSeed } from "../model/billing";
import { getContributionGate } from "./access";
import { getContributionStudents } from "./directory";
import { readableFactStudents } from "./fact-access";
import { getContributionReadIdentity } from "./identity-query";

/** Only requested on hover/focus/click; the student list never loads all monthly payloads. */
export async function getContributionPendingDetails(studentId: string): Promise<{ details: PendingDetail[]; computedAt: string } | null> {
  if (!/^[a-f0-9-]{36}$/i.test(studentId)) return null;
  const gate = await getContributionGate();
  if (!gate) return null;
  const [students, readable, identity] = await Promise.all([getContributionStudents(), readableFactStudents(), getContributionReadIdentity()]);
  const student = students.find(s => s.id === studentId);
  if (!student || student.is_test || isMergedStudent(student.notes) || (readable && !readable.has(studentId))) return null;
  const ids = identity.ids.filter(id => identity.canonical(id) === studentId && (!readable || readable.has(id)));
  type Row = { student_id: string; month: string; unavailable: Metric[]; computed_at: string; historical: BillingSeed[] | null; details: PendingDetail[] | null };
  const db = createAdminClient();
  const rows = await fetchAllPagedInChunks<Row>(ids, (chunk, a, b) => db.from("student_contribution_months")
    .select("student_id, month, unavailable, computed_at, historical, details:payload->unavailableDetails")
    .eq("tenant_id", gate.tenantId).in("student_id", chunk).order("student_id").order("month").range(a, b).returns<Row[]>());
  const latest = rows.filter(r => r.student_id === studentId).sort((a, b) => b.month.localeCompare(a.month))[0];
  if (!latest) return null;
  const details = pendingDetails(latest.unavailable, latest.details ?? []);
  // Older snapshots lack detailed diagnostics. Their original billing seeds still identify the affected months.
  const seeds = [...new Map(rows.flatMap(r => r.historical ?? []).map(s => [s.id, s])).values()].filter(s => s.unknownSubjects > 0);
  if (!latest.details?.length && seeds.length) {
    const subject = details.find(d => d.metric === "subjectMonths");
    if (subject) { subject.months = [...new Set(seeds.map(s => s.month))].sort(); subject.count = null; }
  }
  return { details, computedAt: latest.computed_at };
}
