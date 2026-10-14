import { describe, expect, it } from "vitest";
import { isGradeSort, sortByGrade } from "./grade-sort";

const row = (id: string, grade: string | null, name = id) => ({ id, grade, name });

describe("원생목록 학년 정렬 — 출석부 학년순과 같은 순서(원장 2026-10-14)", () => {
  const rows = [row("a", "고1"), row("b", "중2"), row("c", "초6"), row("d", "7세"), row("e", null), row("f", "중2", "가나"), row("g", "성인")];
  it("오름차순 = 미취학 → 초 → 중 → 고, 같은 학년은 이름순 · 모르는 학년은 맨 뒤", () => {
    expect(sortByGrade(rows, false).map((r) => r.id)).toEqual(["d", "c", "f", "b", "a", "e", "g"]);
  });
  it("내림차순 = 고 → 중 → 초 → 미취학 · 같은 학년은 그대로 이름순 · 모르는 학년은 여전히 맨 뒤", () => {
    expect(sortByGrade(rows, true).map((r) => r.id)).toEqual(["a", "f", "b", "c", "d", "e", "g"]);
  });
  it("학년 정렬인가 — 기본(값 없음)도 학년", () => {
    expect([undefined, "grade", "grade_desc", "name", "name_desc"].map(isGradeSort)).toEqual([true, true, true, false, false]);
  });
});
