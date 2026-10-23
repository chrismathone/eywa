import "server-only";
import { createHash } from "node:crypto";
import { summarySources, SUMMARY_VERSION, LEGACY_SUMMARY_VERSION } from "@/features/students/ontology/summary";
import { getLiveContext } from "./live-context";
import { liveSectionReaders, readLiveSection } from "./live-query";
import { LIVE_RELATION_VERSION } from "@/features/students/ontology/live-contract";
import { readLiveConsultations, readLiveMemos } from "./live-records";

export async function getSummaryInput(studentId: string, fresh = false, version = SUMMARY_VERSION) {
  const context = await getLiveContext(studentId);
  if (!context) return null;
  // Family records never enter this fixed-purpose AI query bundle.
  const readers = liveSectionReaders.filter((r) => r.key !== "family");
  const sections = await Promise.all(readers.map((r) => {
    if (version !== LEGACY_SUMMARY_VERSION && r.key === "consultations") return readLiveConsultations(context, true);
    if (version !== LEGACY_SUMMARY_VERSION && r.key === "memos") return readLiveMemos(context, true);
    return fresh ? r.read(context) : readLiveSection(r.key, context);
  }));
  const sources = summarySources({ studentId, asOf: context.today, checkedAt: "", ruleVersion: LIVE_RELATION_VERSION, sections });
  const scope = sections.map((s) => ({ key: s.key, state: s.state })).sort((a, b) => a.key.localeCompare(b.key));
  const hash = createHash("sha256").update(JSON.stringify({ version, relationVersion: LIVE_RELATION_VERSION,
    tenant: context.tenant, studentId, day: context.today, scope, sources: [...sources].sort((a, b) => a.itemId.localeCompare(b.itemId)) })).digest("hex");
  return { hash, sources, partial: sections.some((s) => s.state !== "ready" && s.state !== "off"), asOf: context.today };
}
