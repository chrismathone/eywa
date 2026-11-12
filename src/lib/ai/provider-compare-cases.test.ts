import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildClassifyPrompt } from "@/features/attendance/parent-alerts/intent";
import { buildStudentConsultationPrompt } from "@/features/consultations/analysis-prompt";
import { buildConsultationAnalysisPrompt } from "@/features/enrollment/consultation-analysis-prompt";
import { buildConsultationFormPrompt } from "@/features/enrollment/form-extract-prompt";
import { buildPrepBriefPrompt } from "@/features/enrollment/prep-brief";
import { buildMeetingAnalysisPrompt } from "@/features/meetings/analysis-prompt";
import { buildNoticeTranslationPrompt } from "@/features/notices/translate-prompt";
import {
  BUILT_IN_ANALYSIS_CASES,
  BUILT_IN_ANALYSIS_SEEDS,
  buildAnalysisCase,
} from "../../../scripts/_oneoff/ai-provider-cases";
import { withFactGuard } from "./fact-guard";
import { AI_MODELS } from "./models";
import { openAIProfileFor } from "./model-pins";

describe("AI 공급자 분석 비교 사례", () => {
  it("각 분석 기능을 두 건 이상 운영 프롬프트 빌더로 조립한다", () => {
    const counts = new Map<string, number>();
    for (const seed of BUILT_IN_ANALYSIS_SEEDS) {
      counts.set(seed.kind, (counts.get(seed.kind) ?? 0) + 1);
      const actual = buildAnalysisCase(seed);
      const expected = (() => {
        switch (seed.kind) {
          case "consultation":
            return buildConsultationAnalysisPrompt(seed.consult, seed.transcript, seed.multi ?? false);
          case "form":
            return buildConsultationFormPrompt(seed.transcript, seed.context);
          case "classification":
            return buildClassifyPrompt(seed.items);
          case "translation":
            return buildNoticeTranslationPrompt(seed.source);
          case "meeting":
            return buildMeetingAnalysisPrompt(seed.transcript, seed.context);
          case "studentConsultation":
            return buildStudentConsultationPrompt(seed.transcript, seed.context);
          case "prep":
            return buildPrepBriefPrompt(seed.facts);
        }
      })();
      expect(actual.prompt).toBe(expected);
      // generateJSON과 비교 CLI 모두 FACT_GUARD를 같은 본문 앞에 한 번 붙인다.
      expect(withFactGuard(actual.prompt)).toBe(withFactGuard(expected));
    }
    for (const kind of ["consultation", "form", "classification", "translation", "meeting", "studentConsultation", "prep"]) {
      expect(counts.get(kind), kind).toBeGreaterThanOrEqual(2);
    }
  });

  it("상담 전사는 실제 통화 길이이고 가명·주의 신호·필수 사실 기준을 갖춘다", () => {
    const seeds = BUILT_IN_ANALYSIS_SEEDS.filter((seed) => seed.kind === "consultation" || seed.kind === "studentConsultation");
    for (const seed of seeds) {
      expect(seed.transcript.length).toBeGreaterThanOrEqual(1_500);
      expect(seed.transcript.length).toBeLessThanOrEqual(3_000);
      expect(seed.transcript).toContain("[화자 A]");
      expect(seed.transcript).toContain("[화자 B]");
      expect(seed.transcript).toContain("잡담");
      expect(seed.transcript).not.toMatch(/01[016789]-\d{3,4}-\d{4}/);
      const studentName = seed.kind === "consultation" ? seed.consult.prospect_name : seed.context.studentName;
      expect(studentName).toContain("가명");
      expect(seed.mustCapture.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("Claude 비교 요청은 운영의 balanced 모델과 기능별 강도를 유지한다", () => {
    const expectedEffort: Record<string, "medium" | "high"> = {
      enrollment_analysis: "high",
      enrollment_form_extract: "high",
      parent_attendance_intent: "medium",
      notice_translate: "medium",
      meeting_analysis: "high",
      consultation_analysis: "high",
      enrollment_prep_brief: "high",
    };
    for (const c of BUILT_IN_ANALYSIS_CASES) {
      expect(c.tier).toBe("balanced");
      expect(AI_MODELS[c.tier].anthropic).toBe("claude-sonnet-5-5");
      expect(c.claudeEffort).toBe(expectedEffort[c.feature]);
      expect(openAIProfileFor(c.feature, c.tier).reasoningEffort).toBe(c.claudeEffort);
    }
  });

  it("운영 호출부도 비교 장치와 같은 빌더만 호출한다", () => {
    const source = (path: string) => readFileSync(path, "utf8");
    expect(source("src/features/enrollment/server/consultation-analysis.ts")).toContain("prompt: buildConsultationAnalysisPrompt(consult, formatted, multi)");
    expect(source("src/features/enrollment/server/form-extract.ts")).toContain("prompt: buildConsultationFormPrompt(formattedTranscript, ctx)");
    expect(source("src/features/attendance/parent-alerts/server/classify.ts")).toContain("prompt: buildClassifyPrompt(");
    expect(source("src/features/notices/server/translate.ts")).toContain("prompt: buildNoticeTranslationPrompt(src)");
    expect(source("src/features/meetings/server/ai.ts")).toContain("prompt: buildMeetingAnalysisPrompt(formattedTranscript, ctx)");
    expect(source("src/features/consultations/server/ai.ts")).toContain("prompt: buildStudentConsultationPrompt(text, ctx)");
    expect(source("src/features/enrollment/server/prep-generate.ts")).toContain("prompt: buildPrepBriefPrompt(facts)");
  });
});
