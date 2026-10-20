import { describe, expect, it } from "vitest";
import { assignmentConflict, bookTitleKey, effectiveMathBook, findSameCatalogTitle } from "./math-assignment";

const A = { textbookId: "a", title: "가우스 중2-1 발전 1권" };
const B = { textbookId: "b", title: "가우스 중2-1 발전 2권" };

describe("effectiveMathBook", () => {
  it("학생 교재가 반 교재보다 우선", () => {
    expect(effectiveMathBook(A, B)).toEqual({ ...B, source: "student" });
  });
  it("학생 교재가 없으면 반 교재", () => {
    expect(effectiveMathBook(A, null)).toEqual({ ...A, source: "class" });
  });
  it("둘 다 없으면 null", () => {
    expect(effectiveMathBook(null, null)).toBeNull();
  });
});

describe("findSameCatalogTitle", () => {
  const catalog = [A.title, B.title];
  it("공백만 다른 같은 책이면 교재목록 이름을 돌려준다", () => {
    expect(bookTitleKey("가우스중2-1발전1권")).toBe(bookTitleKey(A.title));
    expect(findSameCatalogTitle("가우스중2-1발전1권", catalog)).toBe(A.title);
    expect(findSameCatalogTitle("  가우스 중2-1 발전 2권 ", catalog)).toBeNull();
  });
  it("글자까지 같으면 묻지 않는다", () => {
    expect(findSameCatalogTitle(A.title, catalog)).toBeNull();
  });
  it("없는 책·빈 값은 null", () => {
    expect(findSameCatalogTitle("쎈 중2-1", catalog)).toBeNull();
    expect(findSameCatalogTitle("", catalog)).toBeNull();
    expect(findSameCatalogTitle(null, catalog)).toBeNull();
  });
});

describe("assignmentConflict", () => {
  it("반 자리에 같은 교재 → same-slot", () => {
    expect(assignmentConflict({ scope: "class", textbookId: "a", classBook: A, studentBook: null })).toEqual({ kind: "same-slot", title: A.title });
  });
  it("반 자리에 다른 교재 → 없음", () => {
    expect(assignmentConflict({ scope: "class", textbookId: "b", classBook: A, studentBook: null })).toBeNull();
  });
  it("학생이 반에서 같은 교재를 받는 중 → same-as-class", () => {
    expect(assignmentConflict({ scope: "student", textbookId: "a", classBook: A, studentBook: null })).toEqual({ kind: "same-as-class", title: A.title });
  });
  it("학생 자리에 이미 같은 교재 → same-slot", () => {
    expect(assignmentConflict({ scope: "student", textbookId: "b", classBook: A, studentBook: B })).toEqual({ kind: "same-slot", title: B.title });
  });
  it("학생 교재가 따로 있으면 반 교재와 같아도 바꾸는 것이다 → 없음", () => {
    expect(assignmentConflict({ scope: "student", textbookId: "a", classBook: A, studentBook: B })).toBeNull();
  });
  it("해제는 충돌이 아니다", () => {
    expect(assignmentConflict({ scope: "student", textbookId: null, classBook: A, studentBook: A })).toBeNull();
  });
});
