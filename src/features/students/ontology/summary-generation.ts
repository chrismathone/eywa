import { z } from "zod";
import { GROUNDED_SUMMARY_PROMPT, SUMMARY_VERIFY_PROMPT, validateGroundedSummary, type SummarySource, type GroundedSummary } from "./summary";
import { SummaryValidationError, summaryResponseError } from "./summary-error";

export function validateSummaryVerification(value: unknown, summary: GroundedSummary) {
  const parsed = z.object({ verdicts: z.array(z.object({ itemId: z.string(), supported: z.boolean(),
    reason: z.enum(["none", "quote_incomplete", "changed_meaning", "unsupported_claim"]).optional(),
  }).strict()).min(1).max(6) }).strict().safeParse(value);
  if (!parsed.success) throw new SummaryValidationError("invalid_response");
  const { verdicts } = parsed.data;
  const ids = new Set(summary.items.map((item) => item.itemId));
  if (verdicts.length !== ids.size || new Set(verdicts.map((v) => v.itemId)).size !== ids.size
    || verdicts.some((v) => !ids.has(v.itemId))) throw new SummaryValidationError("invalid_response");
  if (verdicts.some((v) => !v.supported)) throw new SummaryValidationError("unsupported_summary", verdicts.filter(v => !v.supported).map(({ itemId, reason }) => ({ itemId, reason })));
}

/** Used by the normal action and owner-authorized internal-plan runs; no provider fallback or writes. */
export async function generateVerifiedSummary(sources: readonly SummarySource[], asOf: string,
  generate: (system: string, prompt: string) => Promise<unknown>) {
  const records = sources.map(({ itemId, section, text, date }) => ({ itemId, section, text, date }));
  let feedback: SummaryValidationError["feedback"];
  const response = async (system: string, prompt: string) => {
    try { return await generate(system, prompt); } catch (error) { throw summaryResponseError(error); }
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const repair = attempt ? "\n이전 응답은 형식 또는 원문 대조 검증에 실패했다. 원본 ID와 연속 인용을 정확히 사용하고, 원문으로 확인되는 사실만 더 간결하게 다시 작성한다." : "";
    // Provider errors and quota/time limits propagate immediately; only invalid content gets one retry.
    try {
      const value = await response(GROUNDED_SUMMARY_PROMPT + repair, JSON.stringify({ asOf, records, ...(feedback ? { previousVerification: feedback } : {}) }));
      let result: GroundedSummary;
      try { result = validateGroundedSummary(value, sources); }
      catch { throw new SummaryValidationError("invalid_response"); }
      const used = new Set(result.items.map((item) => item.itemId));
      const verification = await response(SUMMARY_VERIFY_PROMPT, JSON.stringify({ asOf, records: records.filter((r) => used.has(r.itemId)), summary: result }));
      validateSummaryVerification(verification, result);
      return result;
    } catch (error) {
      if (!(error instanceof SummaryValidationError) || attempt) throw error;
      feedback = error.feedback;
    }
  }
  throw new SummaryValidationError("invalid_response");
}
