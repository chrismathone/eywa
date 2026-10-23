import "server-only";
import { getContributionGate } from "./access";
import { getLiveContext } from "./live-context";
import { getSummaryInput } from "./summary-input";
import { readSavedSummary } from "./summary-store";
import { SUMMARY_VERSION, validateRecentSummary } from "@/features/students/ontology/summary";

export async function getStudentRecordSummary(studentId: string) {
  const [gate, context] = await Promise.all([getContributionGate(), getLiveContext(studentId)]);
  if (!gate || !context) return null;
  try {
    const saved = await readSavedSummary({ tenant: gate.tenantId, studentId, userId: gate.userId });
    if (!saved.ready) return null;
    const common = { canWrite: gate.canWrite, items: [] as { itemId: string; excerpt: string; title: string; href: string }[], generatedAt: null as string | null, model: null as string | null, partial: false };
    if (!saved.row?.result) return { ...common, state: "empty" as const };
    const input = await getSummaryInput(studentId);
    if (!input || saved.row.contract_version !== SUMMARY_VERSION || input.hash !== saved.row.input_hash) return { ...common, state: "stale" as const };
    const result = validateRecentSummary(saved.row.result, input.sources);
    const sources = new Map(input.sources.map((s) => [s.itemId, s]));
    return { ...common, state: "ready" as const, partial: input.partial, generatedAt: saved.row.generated_at, model: saved.row.model_label,
      items: result.items.map((item) => { const source = sources.get(item.itemId)!;
        return { ...item, title: source.section, href: source.evidence[0]!.href };
      }) };
  } catch {
    console.error("[student-ontology] stored summary verification failed");
    // No saved body is sent when evidence/permissions cannot be verified.
    return { state: "unavailable" as const, canWrite: gate.canWrite, items: [], generatedAt: null, model: null, partial: false };
  }
}
