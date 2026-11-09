import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isMergedStudent } from "@/features/students/status/merged";
import { getContributionGate } from "./access";
import { getContributionStudents, getContributionSnapshot } from "./directory";
import { getContributionReadIdentity } from "./identity-query";
import { projectSignalDisplay, type DisplaySignal } from "./signal-display";
import { readableFactStudents } from "./fact-access";
import { loadStudentDisplayMonths } from "./student-months";
import { SIGNALS_TABLE } from "./store";
import { getFamilyLoyalty } from "./family-loyalty";
import type { SignalRow } from "./signals";

export async function getContributionStudent(id: string, month?: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const gate = await getContributionGate();
  if (!gate) return null;
  const [students, settings, readable] = await Promise.all([getContributionStudents(), getContributionSnapshot(), readableFactStudents()]);
  const found = students.find((s) => s.id === id);
  if (!found || found.is_test || isMergedStudent(found.notes) || !settings) return null;
  const student = { id: found.id, name: found.name }, ready = settings.ready, family = await getFamilyLoyalty(id);
  if (!ready) return { gate, student, settings, ready, family, months: [], signals: [] as DisplaySignal[], withheld: 0, identityIssues: 0 };
  const db = createAdminClient(), identity = await getContributionReadIdentity();
  const sourceIds = identity.ids.filter((source) => identity.canonical(source) === id);
  const readableIds = sourceIds.filter((source) => readable === null || readable.has(source));
  const [months, signals] = await Promise.all([
    loadStudentDisplayMonths(db, gate.tenantId, id, sourceIds, month, identity.canonical, readable),
    fetchAllPagedInChunks<SignalRow>(readableIds, (chunk, a, b) => db.from(SIGNALS_TABLE)
      .select("id, source, source_id, student_id, source_hash, occurred_on, author_label, classification, evidence, model_label, judged_at, cancelled_at, cancel_reason, rejudge_requested_at")
      .eq("tenant_id", gate.tenantId).in("student_id", chunk).order("id").range(a, b)),
  ]);
  const display = await projectSignalDisplay(db, gate.tenantId, signals);
  let withheld = months.reduce((n, m) => n + (m.withheldFacts ?? 0), 0);
  for (const m of months) {
    const previous = m.payload.facts.length;
    m.payload.facts = m.payload.facts.filter(display.canShowObservation);
    withheld += previous - m.payload.facts.length;
    m.payload.evidenceIds = [...new Set(m.payload.facts.flatMap((f) => f.evidence.map((e) => `${e.source}:${e.id}`)))];
    m.evidenceIds = m.payload.evidenceIds;
  }
  return { gate, student, settings, ready, family, months, signals: display.signals, withheld, identityIssues: identity.issues.length };
}
