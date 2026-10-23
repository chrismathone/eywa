import "server-only";
import { createHash } from "node:crypto";
import { summarySources, SUMMARY_VERSION } from "@/features/students/ontology/summary";
import { getLiveContext } from "./live-context";
import { liveSectionReaders, readLiveSection } from "./live-query";
import { LIVE_RELATION_VERSION } from "@/features/students/ontology/live-contract";

export async function getSummaryInput(studentId: string, fresh = false) {
  const context = await getLiveContext(studentId);
  if (!context) return null;
  // Family records never enter this fixed-purpose AI query bundle.
  const readers = liveSectionReaders.filter((r) => r.key !== "family");
  const sections = await Promise.all(readers.map((r) => fresh ? r.read(context) : readLiveSection(r.key, context)));
  const sources = summarySources({ studentId, asOf: context.today, checkedAt: "", ruleVersion: LIVE_RELATION_VERSION, sections });
  const scope = sections.map((s) => ({ key: s.key, state: s.state })).sort((a, b) => a.key.localeCompare(b.key));
  const hash = createHash("sha256").update(JSON.stringify({ version: SUMMARY_VERSION, relationVersion: LIVE_RELATION_VERSION,
    tenant: context.tenant, studentId, day: context.today, scope, sources: [...sources].sort((a, b) => a.itemId.localeCompare(b.itemId)) })).digest("hex");
  return { hash, sources, partial: sections.some((s) => s.state !== "ready" && s.state !== "off"), asOf: context.today };
}
