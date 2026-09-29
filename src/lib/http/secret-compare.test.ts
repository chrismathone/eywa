import { describe, expect, it } from "vitest";
import { bearerMatches, secretMatches } from "./secret-compare";

describe("secretMatches", () => {
  it("같으면 true, 다르거나 길이가 다르면 false", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abd", "abc")).toBe(false);
    expect(secretMatches("ab", "abc")).toBe(false);
  });
  it("기대값이 비면 항상 false(fail-closed)", () => {
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches("x", undefined)).toBe(false);
    expect(secretMatches(null, "x")).toBe(false);
  });
  it("한글 등 멀티바이트도 바이트로 비교", () => {
    expect(secretMatches("비밀", "비밀")).toBe(true);
    expect(secretMatches("비밀", "비말")).toBe(false);
  });
});

describe("bearerMatches", () => {
  it("Bearer 접두까지 맞아야 통과", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
    expect(bearerMatches("Bearer wrong", "s3cret")).toBe(false);
    expect(bearerMatches(null, "s3cret")).toBe(false);
  });
  it("비밀이 없으면 'Bearer ' 헤더로도 못 연다", () => {
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
  });
});
