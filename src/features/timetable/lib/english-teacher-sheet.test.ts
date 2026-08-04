import { describe, expect, it } from "vitest";
import { buildTeacherComparator, compareSheetTeachers } from "./english-teacher-sheet";

// ── 강사 순서 설정 (원장 2026-08-04 "JJ와 LAB은 최우측으로 디폴트값") ────────────────
describe("buildTeacherComparator", () => {
  const sorted = (names: string[], order?: string[]) => [...names].sort(buildTeacherComparator(order));

  it("설정이 없으면 자리(JJ·LAB)가 항상 맨 뒤", () => {
    expect(sorted(["LAB", "Jane", "JJ", "Hannah"])).toEqual(["Jane", "Hannah", "JJ", "LAB"]);
  });

  it("시트 밖 강사(한글 이름)도 자리보다는 앞", () => {
    expect(sorted(["LAB", "허은진", "JJ"])).toEqual(["허은진", "JJ", "LAB"]);
  });

  it("설정 순서가 최우선", () => {
    expect(sorted(["Jane", "Hannah", "Elsa"], ["Elsa", "Jane"])).toEqual(["Elsa", "Jane", "Hannah"]);
  });

  it("자리를 설정에 명시하면 그 자리를 따른다(예외 허용)", () => {
    expect(sorted(["Jane", "LAB", "Hannah"], ["LAB", "Jane"])).toEqual(["LAB", "Jane", "Hannah"]);
  });

  it("🔴 설정에 없는 강사도 사라지지 않고 뒤에 붙는다(새 강사 안전)", () => {
    const out = sorted(["Jane", "새강사", "Hannah"], ["Hannah"]);
    expect(out[0]).toBe("Hannah");
    expect(out).toHaveLength(3);
    expect(out).toContain("새강사");
  });
});

describe("compareSheetTeachers (레거시 시트 미러)", () => {
  it("시트 순서를 따르고 시트 밖은 뒤(이름순)", () => {
    expect(["Sam", "Jane", "허은진"].sort(compareSheetTeachers)).toEqual(["Jane", "Sam", "허은진"]);
  });
});
