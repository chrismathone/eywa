import { describe, expect, it } from "vitest";
import {
  ROSTER_TEXT_COLS,
  rosterColSpan,
  rosterFormOf,
  rosterTextCols,
} from "./roster-form";

describe("로스터 폼 판정 — JJ 교시만 전용 폼", () => {
  it("JJ 자리(원문·별칭)는 전용 폼", () => {
    for (const label of ["JJ", "jj", " JJ ", "집중자율수업실", "자율실"]) {
      expect(rosterFormOf(label)).toBe("selfStudy");
    }
  });

  it("강사 수업·LAB·빈 라벨은 기본 폼", () => {
    // 🔴 LAB은 JJ와 **다른 방**이다(teacher-label.ts) — 한 폼으로 합치지 말 것.
    for (const label of ["Hannah", "이현이", "LAB", "이주희", "", null, undefined]) {
      expect(rosterFormOf(label)).toBe("default");
    }
  });
});

describe("폼별 자유 입력 열", () => {
  it("기본 = 시험 점수 하나(원장 2026-08-13 '점수' → '시험 점수')", () => {
    expect(rosterTextCols("default").map((c) => c.label)).toEqual(["시험 점수"]);
    expect(rosterTextCols("default").map((c) => c.field)).toEqual(["score"]);
  });

  it("JJ = 점수 없이 듣기 레벨 + 누적 암기 단어수", () => {
    expect(rosterTextCols("selfStudy").map((c) => c.label)).toEqual(["듣기 레벨", "누적 암기 단어수"]);
    expect(rosterTextCols("selfStudy").some((c) => c.field === "score")).toBe(false);
  });

  it("열 식별자(grid-nav)는 폼 전체에서 유일 — 겹치면 Enter/↑↓가 옆 칸으로 샌다", () => {
    const navs = Object.values(ROSTER_TEXT_COLS).flatMap((cols) => cols.map((c) => c.nav));
    expect(new Set(navs).size).toBe(navs.length);
    expect(navs).not.toContain("ecs-note"); // 특이사항 열과도 겹치면 안 된다
  });

  it("colSpan = 이름 + 출결·유닛·태도 + 자유 입력 + 특이사항", () => {
    expect(rosterColSpan("default")).toBe(6);
    expect(rosterColSpan("selfStudy")).toBe(7);
  });
});
