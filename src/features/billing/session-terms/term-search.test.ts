import { describe, expect, it } from "vitest";
import { matchesTermQuery, type TermSearchFields } from "./term-search";

const row: TermSearchFields = {
  studentName: "김지우",
  className: "고등M 개별 토일",
  studentSchool: "칠성초",
  studentGrade: "초6",
  homeroomTeacherName: "이수진",
  note: "9월 환불 문의",
};

describe("회차 확정 상단 검색 — 표의 글자 열 전부 (원장 2026-09-17)", () => {
  it("이름·반·학교학년(화면 표기와 학교 원문)·담임·메모로 찾는다", () => {
    for (const q of ["김지우", "개별 토일", "칠성초6", "칠성초", "이수진", "환불"]) expect(matchesTermQuery(row, q)).toBe(true);
    expect(matchesTermQuery(row, "박소선")).toBe(false);
  });

  it("공백·대소문자를 무시한다 · 빈 검색어는 전부 통과", () => {
    expect(matchesTermQuery(row, "개별토일")).toBe(true);
    expect(matchesTermQuery({ ...row, className: "PS3A" }, "ps3a")).toBe(true);
    expect(matchesTermQuery(row, "  ")).toBe(true);
  });

  it("비어 있는 칸은 건너뛴다 — 학교·학년이 없다고 '-' 같은 글자로 걸리지 않는다", () => {
    const bare = { ...row, studentSchool: null, studentGrade: null, homeroomTeacherName: null, note: null };
    expect(matchesTermQuery(bare, "-")).toBe(false);
    expect(matchesTermQuery(bare, "김지우")).toBe(true);
  });
});
