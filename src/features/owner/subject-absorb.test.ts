import { describe, it, expect } from "vitest";
import { absorbJsonSubjectKey, absorbSubjectInArray, isValidSubjectKey } from "./subject-absorb";

describe("absorbSubjectInArray", () => {
  it("from → to 치환", () => {
    expect(absorbSubjectInArray(["math", "korean"], "math", "english")).toEqual(["english", "korean"]);
  });
  it("치환 결과가 기존과 겹치면 중복 제거(순서 보존)", () => {
    expect(absorbSubjectInArray(["math", "english"], "math", "english")).toEqual(["english"]);
    expect(absorbSubjectInArray(["english", "math", "korean"], "math", "english")).toEqual([
      "english",
      "korean",
    ]);
  });
  it("from이 없으면 null(변경 불필요)", () => {
    expect(absorbSubjectInArray(["english"], "math", "korean")).toBeNull();
    expect(absorbSubjectInArray([], "math", "korean")).toBeNull();
  });
});

describe("absorbJsonSubjectKey", () => {
  it("from 키를 to로 개명(다른 키 보존)", () => {
    expect(absorbJsonSubjectKey({ math: { a: 1 }, korean: { b: 2 } }, "math", "english")).toEqual({
      english: { a: 1 },
      korean: { b: 2 },
    });
  });
  it("양쪽 키가 있으면 얕은 병합 — to 우선, from에만 있던 필드는 보존", () => {
    expect(
      absorbJsonSubjectKey({ math: { x: "from", y: "only-from" }, english: { x: "to" } }, "math", "english"),
    ).toEqual({ english: { x: "to", y: "only-from" } });
  });
  it("비객체 값이 겹치면 to 값 유지", () => {
    expect(absorbJsonSubjectKey({ math: "a", english: "b" }, "math", "english")).toEqual({ english: "b" });
  });
  it("from이 없거나 jsonb가 객체가 아니면 null", () => {
    expect(absorbJsonSubjectKey({ english: {} }, "math", "korean")).toBeNull();
    expect(absorbJsonSubjectKey(null, "math", "korean")).toBeNull();
    expect(absorbJsonSubjectKey(["math"], "math", "korean")).toBeNull();
  });
});

describe("isValidSubjectKey", () => {
  it("자동 생성 키 통과, 주입성 문자열 거부", () => {
    expect(isValidSubjectKey("math")).toBe(true);
    expect(isValidSubjectKey("subject_12")).toBe(true);
    expect(isValidSubjectKey("MATH")).toBe(false);
    expect(isValidSubjectKey("a->b")).toBe(false);
    expect(isValidSubjectKey("")).toBe(false);
  });
});
