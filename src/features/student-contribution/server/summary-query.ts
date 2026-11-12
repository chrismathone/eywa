import "server-only";
import { getContributionGate } from "./access";
import { getLiveContext } from "./live-context";
import { getSummaryInput } from "./summary-input";
import { readSavedSummary } from "./summary-store";
import { SUMMARY_VERSION, LEGACY_SUMMARY_VERSION, validateRecentSummary, validateGroundedSummary } from "@/features/students/ontology/summary";
import { isFeatureLicensed } from "@/lib/license/server";

export async function getStudentRecordSummary(studentId: string) {
  const [gate, context] = await Promise.all([getContributionGate(), getLiveContext(studentId)]);
  if (!gate || !context) return null;
  if (!(await isFeatureLicensed(gate.tenantId, "ai_analysis"))) return null;
  try {
    const saved = await readSavedSummary({ tenant: gate.tenantId, studentId, userId: gate.userId });
    if (!saved.ready) return null;
    const common = { canWrite: gate.canWrite, items: [] as { itemId: string; summary: string | null; excerpt: string; title: string; date: string | null; href: string }[], generatedAt: null as string | null, model: null as string | null, partial: false, legacy: false };
    if (!saved.row?.result) return { ...common, state: "empty" as const };
    const version = saved.row.contract_version;
    if (version !== SUMMARY_VERSION && version !== LEGACY_SUMMARY_VERSION) return { ...common, state: "stale" as const };
    const input = await getSummaryInput(studentId, false, version);
    if (!input || input.hash !== saved.row.input_hash) return { ...common, state: "stale" as const };
    const legacy = version === LEGACY_SUMMARY_VERSION;
    const result = legacy ? validateRecentSummary(saved.row.result, input.sources) : validateGroundedSummary(saved.row.result, input.sources);
    const sources = new Map(input.sources.map((s) => [s.itemId, s]));
    return { ...common, state: "ready" as const, legacy, partial: input.partial, generatedAt: saved.row.generated_at, model: saved.row.model_label,
      items: result.items.map((item) => { const source = sources.get(item.itemId)!;
        return { ...item, summary: "summary" in item && typeof item.summary === "string" ? item.summary : null, title: source.section, date: source.date ?? null, href: source.evidence[0]!.href };
      }) };
  } catch {
    console.error("[student-ontology] stored summary verification failed");
    // No saved body is sent when evidence/permissions cannot be verified.
    return { state: "unavailable" as const, canWrite: gate.canWrite, items: [], generatedAt: null, model: null, partial: false, legacy: false };
  }
}
