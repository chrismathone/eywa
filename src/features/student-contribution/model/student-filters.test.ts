import { expect, it } from "vitest";
import { matchesStudentFilters, studentFilters } from "./student-filters";

const students = [
  { name: "김학생A", school: "침산초", grade: "초4", status: "enrolled", subjects: ["math", "english"] },
  { name: "김학생B", school: "침산초", grade: "초4", status: "withdrawn", subjects: ["math"] },
  { name: "이학생", school: "달산초", grade: "초5", status: "on_hold", subjects: ["english"] },
];
it("defaults to enrolled even for searches or invalid status, and opens other states explicitly", () => {
  for (const raw of [{}, { q: "김" }, { status: "invalid" }, { status: "constructor" }]) {
    expect(students.filter((s) => matchesStudentFilters(s, studentFilters(raw)))).toEqual([students[0]]);
  }
  expect(students.filter((s) => matchesStudentFilters(s, studentFilters({ status: "all" })))).toEqual(students);
  expect(students.filter((s) => matchesStudentFilters(s, studentFilters({ status: "on_hold" })))).toEqual([students[2]]);
});
it("combines school/name, grade and historical subject without duplicating multi-subject students", () => {
  expect(students.filter((s) => matchesStudentFilters(s, studentFilters({ status: "all", q: " 침산 ", grade: "초4", subject: "math" })))).toEqual(students.slice(0, 2));
  expect(students.filter((s) => matchesStudentFilters(s, studentFilters({ q: "학생a", subject: "english" })))).toEqual([students[0]]);
  expect(students.filter((s) => matchesStudentFilters(s, studentFilters({ grade: "초5", subject: "math" })))).toEqual([]);
});
