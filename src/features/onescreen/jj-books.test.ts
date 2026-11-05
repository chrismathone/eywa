import { describe, expect, it } from "vitest";
import { BUILTIN_ENGLISH_SHEET_TEMPLATE_ID, BUILTIN_JJ_SHEET_TEMPLATE_ID } from "@/features/report-templates/defaults";
import { isJjSheetDraft, isJjSheetReport, isProgressOptionalReport, parseJjBooks, toggleJjBook } from "./jj-books";

describe("JJ 교재(원장 2026-10-27)", () => {
  it("SRS 글은 진도 없이 저장·발송 대상 — 영어 행 + SRS 글만(원장 2026-11-05)", () => {
    const srs = "■ 수업 평가\n수업 태도 중\n\n■ SRS 학습 결과\n[학습분석지]";
    const sheet = "■ 수업 평가\n수업 태도 중\n\n■ 오늘의 진도\nReading 10-3";
    expect(isProgressOptionalReport({ subjectKey: "english" }, { draft: srs })).toBe(true);
    expect(isProgressOptionalReport({ subjectKey: "english" }, { templateId: BUILTIN_JJ_SHEET_TEMPLATE_ID })).toBe(true);
    expect(isProgressOptionalReport({ subjectKey: "english" }, { draft: sheet })).toBe(false);
    expect(isProgressOptionalReport({ subjectKey: "math" }, { draft: srs })).toBe(false);
    expect(isProgressOptionalReport({ subjectKey: "english" }, undefined)).toBe(false);
  });

  it("JJ 수업보고서 템플릿 행만 — 고르는 중인 템플릿이 이긴다", () => {
    expect(isJjSheetReport({ templateId: BUILTIN_JJ_SHEET_TEMPLATE_ID })).toBe(true);
    expect(isJjSheetReport({ templateId: BUILTIN_JJ_SHEET_TEMPLATE_ID, pendingTemplateId: BUILTIN_ENGLISH_SHEET_TEMPLATE_ID })).toBe(false);
    expect(isJjSheetReport({ templateId: undefined, pendingTemplateId: BUILTIN_JJ_SHEET_TEMPLATE_ID })).toBe(true);
    expect(isJjSheetReport(undefined)).toBe(false);
  });

  it("복사해 만든 SRS 템플릿 글도 JJ 글 — 제목·'보고자'와 같은 판정(원장 2026-10-30)", () => {
    const srs = "■ 수업 평가\n수업 태도 중\n\n■ 단어 학습 현황\n[학습배지]\n\n■ SRS 학습 결과\n[학습분석지]";
    const custom = "ea9b0211-8148-47e2-bcaa-fe44dabec873";
    expect(isJjSheetReport({ templateId: custom, draft: srs })).toBe(true);
    expect(isJjSheetDraft({ templateId: custom, draft: srs })).toBe(true);
    // 다른 영어 항목 글은 아니다.
    const sheet = "■ 수업 평가\n수업 태도 중\n\n■ 오늘의 진도\nReading 10-3";
    expect(isJjSheetReport({ templateId: custom, draft: sheet })).toBe(false);
    expect(isJjSheetDraft({ templateId: BUILTIN_ENGLISH_SHEET_TEMPLATE_ID, draft: sheet })).toBe(false);
    // 다른 템플릿을 고르는 중이면 그 템플릿이 이긴다(글은 아직 옛 SRS 글).
    expect(isJjSheetReport({ templateId: custom, pendingTemplateId: BUILTIN_ENGLISH_SHEET_TEMPLATE_ID, draft: srs })).toBe(false);
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
