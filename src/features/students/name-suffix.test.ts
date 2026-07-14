import { describe, it, expect } from "vitest";
import { baseNameOf, resolveUniqueStudentName } from "./name-suffix";

describe("baseNameOf", () => {
  it("끝의 라틴 대문자 1개를 접미사로 보고 제거", () => {
    expect(baseNameOf("학원이A")).toBe("학원이");
    expect(baseNameOf("박서준C")).toBe("박서준");
    expect(baseNameOf("학원이")).toBe("학원이"); // 접미사 없으면 그대로
    expect(baseNameOf(" 학원이A ")).toBe("학원이"); // trim
  });
});

describe("resolveUniqueStudentName", () => {
  it("빈 이름·미중복은 그대로(첫 번째 = plain)", () => {
    expect(resolveUniqueStudentName("학원이", new Set())).toEqual({ name: "학원이", suffixed: false });
    expect(resolveUniqueStudentName("", new Set(["학원이"]))).toEqual({ name: "", suffixed: false });
  });

  it("이미 있으면 다음 빈 알파벳(A→B→C)", () => {
    expect(resolveUniqueStudentName("학원이", new Set(["학원이"]))).toEqual({ name: "학원이A", suffixed: true });
    expect(resolveUniqueStudentName("학원이", new Set(["학원이", "학원이A"]))).toEqual({ name: "학원이B", suffixed: true });
    expect(resolveUniqueStudentName("학원이", new Set(["학원이", "학원이A", "학원이B"]))).toEqual({ name: "학원이C", suffixed: true });
  });

  it("중간 알파벳이 비면 그 자리 채움(A 없고 B 있음 → A)", () => {
    expect(resolveUniqueStudentName("학원이", new Set(["학원이", "학원이B"]))).toEqual({ name: "학원이A", suffixed: true });
  });

  it("접미사 붙은 이름을 입력해도 base 기준으로 재부여", () => {
    // "학원이A"가 이미 있으면 base "학원이"의 다음 빈 알파벳 = B
    expect(resolveUniqueStudentName("학원이A", new Set(["학원이A"]))).toEqual({ name: "학원이B", suffixed: true });
  });

  it("A~Z 소진 시 숫자 폴백(2,3…)", () => {
    const taken = new Set(["학원이", ...SUFFIX_ALL().map((s) => "학원이" + s)]);
    expect(resolveUniqueStudentName("학원이", taken)).toEqual({ name: "학원이2", suffixed: true });
  });

  it("trim 후 비교(공백 차이 무시)", () => {
    expect(resolveUniqueStudentName("  학원이  ", new Set(["학원이"]))).toEqual({ name: "학원이A", suffixed: true });
  });
});

function SUFFIX_ALL(): string[] {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
}
