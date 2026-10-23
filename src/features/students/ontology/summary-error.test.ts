import { expect, it } from "vitest";
import { SummaryValidationError, summaryFailure } from "./summary-error";

it("reports only safe failure categories without raw provider details", () => {
  const error = new Error("private record and secret-key");
  expect(summaryFailure(error, "generation", false).code).toBe("generation_failed");
  expect(summaryFailure(error, "save", false).code).toBe("storage_failed");
  expect(summaryFailure(error, "input", false).code).toBe("source_unavailable");
  expect(JSON.stringify(summaryFailure(error, "generation", false))).not.toContain(error.message);
});
it("distinguishes rejected content and timeouts", () => {
  expect(summaryFailure(new SummaryValidationError("unsupported_summary"), "generation", false).code).toBe("unsupported_summary");
  expect(summaryFailure(new Error("aborted"), "generation", true).code).toBe("timeout");
  expect(summaryFailure(new SummaryValidationError("parse_failed"), "generation", false).message).toContain("형식");
  expect(summaryFailure(new SummaryValidationError("truncated"), "generation", false).message).toContain("중간에 끊겼습니다");
});
