import { describe, expect, it } from "vitest";
import { BUILTIN_ENGLISH_SHEET_TEMPLATE_ID, BUILTIN_JJ_SHEET_TEMPLATE_ID } from "@/features/report-templates/defaults";
import { isJjSheetReport, parseJjBooks, toggleJjBook } from "./jj-books";

describe("JJ 교재(원장 2026-10-27)", () => {
  it("JJ 수업보고서 템플릿 행만 — 고르는 중인 템플릿이 이긴다", () => {
    expect(isJjSheetReport({ templateId: BUILTIN_JJ_SHEET_TEMPLATE_ID })).toBe(true);
    expect(isJjSheetReport({ templateId: BUILTIN_JJ_SHEET_TEMPLATE_ID, pendingTemplateId: BUILTIN_ENGLISH_SHEET_TEMPLATE_ID })).toBe(false);
    expect(isJjSheetReport({ templateId: undefined, pendingTemplateId: BUILTIN_JJ_SHEET_TEMPLATE_ID })).toBe(true);
    expect(isJjSheetReport(undefined)).toBe(false);
  });

  it("켜고 끄기 — 목록 순서로 이어 붙이고 목록 밖 값은 버린다", () => {
    expect(toggleJjBook("", "인재원 SRS")).toBe("인재원 SRS");
    expect(toggleJjBook("인재원 SRS", "인재원 ISM")).toBe("인재원 ISM · 인재원 SRS");
    expect(toggleJjBook("인재원 ISM · 인재원 SRS", "인재원 ISM")).toBe("인재원 SRS");
    expect(toggleJjBook("Grammar Inside", "Listening (NTA)")).toBe("Listening (NTA)");
  });

  it("읽기 — 구분자 셋 · 목록 밖 조각은 따로", () => {
    expect(parseJjBooks("인재원 ISM, Listening (NTA)")).toEqual({ picked: ["인재원 ISM", "Listening (NTA)"], other: [] });
    expect(parseJjBooks("Grammar Inside")).toEqual({ picked: [], other: ["Grammar Inside"] });
    expect(parseJjBooks(null)).toEqual({ picked: [], other: [] });
  });
});
