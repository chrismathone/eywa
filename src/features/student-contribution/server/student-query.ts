import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isMergedStudent } from "@/features/students/status/merged";
import { getContributionGate } from "./access";
import { getContributionStudents, getContributionSnapshot } from "./directory";
import { getContributionIdentity } from "./identity-query";
import { readableFactStudents } from "./fact-access";
import { loadStudentDisplayMonths } from "./student-months";
import { SIGNALS_TABLE } from "./store";
import type { SignalRow } from "./signals";

export async function getContributionStudent(id: string, month?: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const gate = await getContributionGate();
  if (!gate) return null;
  const [students, settings, readable] = await Promise.all([getContributionStudents(), getContributionSnapshot(), readableFactStudents()]);
  const found = students.find((s) => s.id === id);
  if (!found || found.is_test || isMergedStudent(found.notes) || !settings) return null;
  const student = { id: found.id, name: found.name }, ready = settings.ready;
  if (!ready) return { gate, student, settings, ready, months: [], signals: [] };
  const db = createAdminClient(), identity = await getContributionIdentity();
  const sourceIds = identity.ids.filter((source) => identity.canonical(source) === id);
  const [months, signals] = await Promise.all([
    loadStudentDisplayMonths(db, gate.tenantId, id, sourceIds, month, identity.canonical, readable === null || readable.has(id)),
    fetchAllPagedInChunks<SignalRow>(sourceIds, (chunk, a, b) => db.from(SIGNALS_TABLE)
      .select("id, source, source_id, student_id, source_hash, occurred_on, author_label, classification, evidence, model_label, judged_at, cancelled_at, cancel_reason, rejudge_requested_at")
      .eq("tenant_id", gate.tenantId).in("student_id", chunk).order("id").range(a, b)),
  ]);
  return { gate, student, settings, ready, months, signals };
}
