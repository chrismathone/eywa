import { describe, expect, it } from "vitest";
import { classSortArrow, parseClassSort } from "./list-filters";
import { sortClassRows } from "./sort-rows";
import type { ClassListRow } from "./server/queries";

const row = (id: string, className: string, studentCount: number, teacherName: string | null) =>
  ({ id, className, studentCount, teacherName }) as unknown as ClassListRow;
const ids = (rows: ClassListRow[]) => rows.map((r) => r.id);

describe("수업목록 정렬 = 열 머리 오름·내림 화살표(원장 2026-10-14 *\"수업목록도 똑같이 바꿔\"*)", () => {
  const base = () => [row("a", "중2 심화", 8, "이성우"), row("b", "고1 기본", 12, null), row("c", "초6 A", 3, "김민서")];
  it("반 이름 오름·내림 · 학생 많은·적은 순 · 담임 오름·내림(담임 미정은 방향과 상관없이 맨 뒤)", () => {
    const sorted = (sort: Parameters<typeof sortClassRows>[1]) => {
      const rows = base();
      sortClassRows(rows, sort);
      return ids(rows);
    };
    expect(sorted("name")).toEqual(["b", "a", "c"]);
    expect(sorted("name_desc")).toEqual(["c", "a", "b"]);
    expect(sorted("students")).toEqual(["b", "a", "c"]);
    expect(sorted("students_asc")).toEqual(["c", "a", "b"]);
    expect(sorted("teacher")).toEqual(["c", "a", "b"]);
    expect(sorted("teacher_desc")).toEqual(["a", "c", "b"]);
  });

  it("화살표 — 다른 열이면 그 열의 처음 방향(이름·담임 = 오름차순, 학생 = 많은 순), 같은 열이면 뒤집는다", () => {
    expect(classSortArrow("name", "name")).toEqual({ active: true, dir: "asc", next: "name_desc" });
    expect(classSortArrow("name_desc", "name")).toEqual({ active: true, dir: "desc", next: "name" });
    expect(classSortArrow("name", "students")).toEqual({ active: false, dir: "desc", next: "students" });
    expect(classSortArrow("students", "students")).toEqual({ active: true, dir: "desc", next: "students_asc" });
    expect(classSortArrow("name", "teacher")).toEqual({ active: false, dir: "asc", next: "teacher" });
  });

  it("옛 값(name·students·teacher)은 뜻 그대로 살고, 모르는 값은 반 이름 오름차순", () => {
    expect(["name", "students", "teacher", "teacher_desc", "bogus"].map(parseClassSort)).toEqual(["name", "students", "teacher", "teacher_desc", "name"]);
  });
});
