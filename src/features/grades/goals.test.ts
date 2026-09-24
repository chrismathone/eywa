import { describe, expect, it } from "vitest";
import { goalCellKey, goalExamLabel, goalStatus, parseGoalAxis } from "./goals";

describe("시험 목표 — 축·판정 한 벌", () => {
  it("축 검증: 과목의 시험·학기의 달만 받는다", () => {
    expect(parseGoalAxis({ subject: "math", year: "2026", term: "2", slot: "monthly", month: "10" }))
      .toEqual({ subject: "math", year: 2026, term: 2, slot: "monthly", month: 10 });
    expect(parseGoalAxis({ subject: "math", year: "2026", term: "2", slot: "monthly", month: "5" })).toBe("월말평가의 월이 그 학기에 없습니다");
    expect(parseGoalAxis({ subject: "math", year: "2026", term: "1", slot: "listening", month: "0" })).toBe("이 과목에 없는 시험입니다");
    expect(parseGoalAxis({ subject: "english", year: "2026", term: "1", slot: "listening", month: "7" }))
      .toEqual({ subject: "english", year: 2026, term: 1, slot: "listening", month: 0 });
    expect(parseGoalAxis({ subject: "math", year: "2026", term: "3", slot: "school", month: "0" })).toBe("학기를 선택해주세요");
  });
  it("라벨·칸 키", () => {
    expect(goalExamLabel({ year: 2026, term: 2, slot: "monthly", month: 1 })).toBe("2026년 2학기 · 월말평가(1월)");
    expect(goalExamLabel({ year: 2026, term: 1, slot: "midterm", month: 0 })).toBe("2026년 1학기 · 중간고사");
    expect(goalCellKey({ subject: "math", year: 2026, term: 2, slot: "monthly", month: 10 })).toBe("math|2026|2|monthly|10");
  });
  it("상태 5종 — 시험없음이 먼저, 만점 한쪽만 모르면 판정 불가", () => {
    expect(goalStatus({ target: 90, max: 100 }, { score: 45, max: 50 })).toBe("achieved");
    expect(goalStatus({ target: 90, max: 100 }, { score: 44, max: 50 })).toBe("missed");
    expect(goalStatus({ target: 90, max: 100 }, { score: 95, max: 100, noExam: true })).toBe("noExam");
    expect(goalStatus({ target: 90, max: 100 }, null)).toBe("pending");
    expect(goalStatus({ target: 90, max: 100 }, { score: null, max: 100 })).toBe("pending");
    expect(goalStatus({ target: 90, max: null }, { score: 95, max: null })).toBe("achieved");
    expect(goalStatus({ target: 90, max: 100 }, { score: 95, max: null })).toBe("unknown");
  });
});
