import { expect, it } from "vitest";
import { auditDetail } from "@/features/audit/describe";
import { activityGradeOf } from "@/features/slack/activity-catalog";

it("describes outcomes without leaking hashes or internal codes", () => {
  const context = { nameOf: () => null, subjectLabel: (key: string) => key };
  expect(auditDetail("student_contribution_summary_generate", {
    outcome: "saved", itemCount: 3, model: "Claude", inputHash: "secret-hash", providerRequested: true,
  }, context)).toBe("저장 완료 · AI 요청함 · 발췌 3건 · Claude");
  expect(auditDetail("student_contribution_summary_generate", { outcome: "quota", providerRequested: false }, context))
    .toBe("일일 한도 도달 · AI 요청 전");
  expect(activityGradeOf("student_contribution_summary_generate")).toBe("forbid");
});
