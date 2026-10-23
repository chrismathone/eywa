import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signalEvidenceStatus, type EvidenceStatus } from "@/features/students/ontology/read-policy";
import type { StudentFact } from "@/features/students/ontology/types";
import { loadSignalSources, type SignalRow } from "./signals";

export type DisplaySignal = Omit<SignalRow, "student_id" | "source_id" | "source_hash"> & { evidenceStatus: EvidenceStatus };

/** Read-time revocation/edits must not wait for the nightly contribution refresh. */
export async function projectSignalDisplay(db: SupabaseClient, tenant: string, rows: SignalRow[]) {
  const sources = await loadSignalSources(db, tenant, [...new Set(rows.map((r) => r.student_id))]).catch(() => {
    console.error("[student-ontology] positive signal source verification failed");
    // Each stored row remains present with evidenceStatus=unavailable; never masquerades as zero signals.
    return [];
  });
  const bySource = new Map(sources.map((s) => [`${s.source}:${s.id}`, s]));
  const current = new Map<string, SignalRow>();
  const signals: DisplaySignal[] = rows.map((r) => {
    const evidenceStatus = signalEvidenceStatus(r, bySource.get(`${r.source}:${r.source_id}`));
    if (evidenceStatus === "current") current.set(r.id, r);
    return { id: r.id, source: r.source, occurred_on: r.occurred_on, classification: r.classification,
      evidence: evidenceStatus === "current" ? r.evidence : "", evidenceStatus,
      author_label: evidenceStatus === "current" ? r.author_label : null,
      cancel_reason: evidenceStatus === "current" ? r.cancel_reason : null,
      model_label: r.model_label, judged_at: r.judged_at, cancelled_at: r.cancelled_at, rejudge_requested_at: r.rejudge_requested_at };
  });
  return { signals, canShowObservation: (fact: StudentFact) => {
    if (fact.kind !== "observation") return true;
    const id = fact.evidence.find((e) => e.source === "student_positive_signals")?.id;
    const row = id ? current.get(id) : undefined;
    const value = fact.value as { evidence?: unknown; author?: unknown; classification?: unknown } | null;
    return !!row && row.judged_at === fact.recordedAt && value?.evidence === row.evidence
      && value.author === row.author_label && value.classification === row.classification;
  } };
}
