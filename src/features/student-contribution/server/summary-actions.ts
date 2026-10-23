"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { generateJSON } from "@/lib/ai/generate";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { isFeatureLicensed } from "@/lib/license/server";
import { logAction } from "@/features/audit/server/log";
import { generateVerifiedSummary } from "@/features/students/ontology/summary-generation";
import { summaryFailure, type SummaryFailureStage } from "@/features/students/ontology/summary-error";
import { requireContributionWrite } from "./access";
import { getSummaryInput } from "./summary-input";
import { claimSummary, finishSummary, readSavedSummary, releaseSummary, reserveSummaryCall } from "./summary-store";

/** Only an explicit button calls this action. No free question, tools, or domain writes. */
export async function generateStudentRecordSummary(studentId: string) {
  let audit: Record<string, unknown> | null = null;
  let stage: SummaryFailureStage = "access", abort: AbortController | undefined;
  try {
    const gate = await requireContributionWrite();
    audit = { studentId, outcome: "unavailable", providerRequested: false };
    const scope = { tenant: gate.tenantId, studentId, userId: gate.userId };
    stage = "input";
    const input = await getSummaryInput(studentId);
    if (!input) return { error: "해당 학생의 원본 기록을 열람할 수 없습니다." };
    audit.inputHash = input.hash;
    if (!input.sources.length) return { error: "요약할 수 있는 최근 기록이 없습니다." };
    if (!(await isFeatureLicensed(gate.tenantId, "ai_analysis"))) return { error: "이 학원에서는 AI 요약을 사용할 수 없습니다." };
    if (!process.env.ANTHROPIC_API_KEY_STUDENT_ONTOLOGY?.trim()) return { error: "학생 기록 요약의 AI 연결을 확인해 주세요." };
    stage = "storage_read";
    if (!(await readSavedSummary(scope)).ready) return { error: "학생 기록 요약을 아직 사용할 수 없습니다." };
    const token = randomUUID();
    stage = "claim";
    if (!(await claimSummary(scope, token))) { audit.outcome = "busy"; return { error: "이미 요약을 생성하고 있습니다. 잠시 후 다시 확인해 주세요." }; }
    const controller = new AbortController(); abort = controller;
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const prompt = JSON.stringify({ asOf: input.asOf, records: input.sources.map(({ itemId, text, date }) => ({ itemId, text, date })) });
      if (Buffer.byteLength(prompt, "utf8") > 24_000) { audit.outcome = "input_limit"; return { error: "요약할 기록이 많습니다. 원본 기록에서 확인해 주세요." }; }
      let model = "Claude";
      stage = "generation";
      const result = await generateVerifiedSummary(input.sources, input.asOf, async (system, prompt) => {
        controller.signal.throwIfAborted();
        if (Buffer.byteLength(prompt, "utf8") > 24_000) { audit!.outcome = "input_limit"; throw new Error("summary_input_limit"); }
        if (!(await reserveSummaryCall(gate.tenantId))) { audit!.outcome = "quota"; throw new Error("summary_quota"); }
        audit!.providerRequested = true;
        const response = await generateJSON<unknown>({ tier: "fast", provider: "anthropic", allowedProviders: ["anthropic"], reasoningEffort: "low",
          maxTokens: 4096, signal: controller.signal, meta: { feature: "student_ontology_summary", tenantId: gate.tenantId }, system, prompt });
        model = modelDisplayLabel(response.model) ?? "Claude";
        return response.data;
      });
      stage = "source_check";
      const latest = await getSummaryInput(studentId, true);
      if (!latest || latest.hash !== input.hash) { audit.outcome = "source_changed"; return { error: "요약하는 동안 원본 기록이 바뀌었습니다. 다시 생성해 주세요." }; }
      stage = "save";
      await finishSummary(scope, token, input.hash, result, model);
      Object.assign(audit, { outcome: "saved", itemCount: result.items.length, model });
      revalidatePath(`/student-contribution/${studentId}`); revalidatePath(`/students/${studentId}`);
      return { ok: true };
    } finally { clearTimeout(timer); await releaseSummary(scope, token); }
  } catch (error) {
    if (audit?.outcome === "quota") return { error: "오늘의 기록 요약 생성 한도에 도달했습니다. 저장된 요약과 원본 기록은 계속 확인할 수 있습니다." };
    if (audit?.outcome === "input_limit") return { error: "요약할 기록이 많습니다. 원본 기록에서 확인해 주세요." };
    const failure = summaryFailure(error, stage, abort?.signal.aborted ?? false);
    if (audit) Object.assign(audit, { outcome: "failed", failureStage: stage, failureCode: failure.code });
    console.error("[student-ontology] summary generation failed", stage, failure.code);
    return { error: failure.message };
  } finally {
    if (audit) await logAction({ action: "student_contribution_summary_generate", targetType: "student", targetLabel: "학생 기록 요약", metadata: audit });
  }
}
