export class SummaryValidationError extends Error {
  constructor(readonly code: "invalid_response" | "unsupported_summary" | "parse_failed" | "truncated", readonly feedback?: { itemId: string; reason?: string }[]) {
    super(code);
    this.name = "SummaryValidationError";
  }
}

/** Recognize only the shared JSON generator's content errors, never arbitrary provider failures. */
export function summaryResponseError(error: unknown): unknown {
  if (error instanceof SyntaxError || error instanceof Error && error.message === "AI 응답에서 JSON을 찾을 수 없습니다") return new SummaryValidationError("parse_failed");
  if (error instanceof Error && /^AI 응답이 최대 길이\(\d+ 토큰\)에서 잘려 해석하지 못했습니다\./.test(error.message)) return new SummaryValidationError("truncated");
  return error;
}

export type SummaryFailureStage = "access" | "input" | "storage_read" | "claim" | "generation" | "source_check" | "save";

/** Diagnostic codes only: provider errors can contain source text or credentials. */
export function summaryFailure(error: unknown, stage: SummaryFailureStage, timedOut: boolean) {
  if (timedOut) return { code: "timeout", message: "요약 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요." };
  if (error instanceof SummaryValidationError && error.code === "parse_failed") return { code: error.code, message: "AI 응답 형식을 읽지 못했습니다. 잠시 후 다시 요약해 주세요." };
  if (error instanceof SummaryValidationError && error.code === "truncated") return { code: error.code, message: "AI 응답이 중간에 끊겼습니다. 잠시 후 다시 요약해 주세요." };
  if (error instanceof SummaryValidationError) return { code: error.code, message: "생성된 요약을 원문과 대조했지만 확인을 통과하지 못했습니다. 다시 요약해 주세요." };
  if (stage === "save") return { code: "storage_failed", message: "요약은 생성했지만 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  if (stage === "generation") return { code: "generation_failed", message: "AI 응답을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  return { code: "source_unavailable", message: "요약에 필요한 기록을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
}
