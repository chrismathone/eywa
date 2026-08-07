import { describe, expect, it } from "vitest";
import { buildSheetDraft, hasSheetDraft, type SheetPlanLine } from "./sheet-report-draft";

const LABELS: Record<string, string> = { grammar: "Grammar", reading: "Reading", vocab: "Vocab" };
const labelOf = (k: string) => LABELS[k] ?? null;

function line(p: Partial<SheetPlanLine>): SheetPlanLine {
  return {
    slotStart: "15:00",
    lineNo: 1,
    skillArea: null,
    textbook: null,
    pageRange: null,
    progress: null,
    homework: null,
    ...p,
  };
}

describe("buildSheetDraft", () => {
  it("교시 시각 → 줄 번호 순으로 접는다(화면에 보이는 순서 그대로)", () => {
    const d = buildSheetDraft(
      [
        line({ slotStart: "16:20", lineNo: 1, skillArea: "grammar", textbook: "그래머인사이드1", progress: "월말 평가" }),
        line({ slotStart: "15:00", lineNo: 2, skillArea: "reading", textbook: "리딩튜터2", progress: "section 5-1 해석" }),
        line({ slotStart: "15:00", lineNo: 1, skillArea: "vocab", textbook: "능률 중등 기본", progress: "41 42" }),
      ],
      labelOf,
    );
    expect(d.progress).toBe("Vocab 41 42\nReading section 5-1 해석\nGrammar 월말 평가");
    expect(d.textbook).toBe("능률 중등 기본 · 리딩튜터2 · 그래머인사이드1");
  });

  it("페이지는 진도 뒤 괄호로 붙고, 진도가 없으면 페이지가 진도가 된다", () => {
    const d = buildSheetDraft(
      [
        line({ lineNo: 1, skillArea: "reading", progress: "section 5-1", pageRange: "p.20~22" }),
        line({ lineNo: 2, skillArea: "grammar", pageRange: "p.90" }),
      ],
      labelOf,
    );
    expect(d.progress).toBe("Reading section 5-1 (p.20~22)\nGrammar p.90");
  });

  it("교재 중복은 한 번만(같은 교재를 두 교시에 써도 ' · '가 늘어나지 않는다)", () => {
    const d = buildSheetDraft(
      [
        line({ slotStart: "15:00", textbook: "그래머인사이드1" }),
        line({ slotStart: "16:20", textbook: " 그래머인사이드1 " }),
        line({ slotStart: "18:20", textbook: "리딩튜터2" }),
      ],
      labelOf,
    );
    expect(d.textbook).toBe("그래머인사이드1 · 리딩튜터2");
  });

  it("모르는 영역 키는 라벨을 지어내지 않는다(raw 영문 키 노출 금지)", () => {
    const d = buildSheetDraft([line({ skillArea: "unknown_area", progress: "Unit 8" })], labelOf);
    expect(d.progress).toBe("Unit 8");
  });

  it("빈 칸·공백만인 줄은 통째로 빠진다", () => {
    const d = buildSheetDraft(
      [line({ progress: "   ", homework: "", textbook: "  " }), line({ lineNo: 2, homework: "SB/WB 풀기", skillArea: "grammar" })],
      labelOf,
    );
    expect(d.progress).toBe("");
    expect(d.textbook).toBe("");
    expect(d.homework).toBe("Grammar SB/WB 풀기");
  });

  it("계획이 하나도 없으면 전부 빈 문자열 — hasSheetDraft가 false", () => {
    const d = buildSheetDraft([], labelOf);
    expect(d).toEqual({ textbook: "", progress: "", homework: "" });
    expect(hasSheetDraft(d)).toBe(false);
    expect(hasSheetDraft(null)).toBe(false);
    expect(hasSheetDraft({ textbook: "", progress: "Unit 8", homework: "" })).toBe(true);
  });
});
