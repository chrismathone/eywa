import { describe, expect, it } from "vitest";
import { makeupOptionLabel } from "./option-label";

describe("학생 선택 구분 정보", () => {
  it("동명이인도 학교·학년·반으로 구별하며 연락처는 표시하지 않는다", () => {
    const first = makeupOptionLabel("students", { id: "one", name: "김학생", school: "침산중", grade: "중1", class_names: ["수학A"], phone: "010-secret" });
    const second = makeupOptionLabel("students", { id: "two", name: "김학생", school: "다른중", grade: "중2", class_names: ["수학B"] });
    expect(first).toBe("김학생 · 침산중1 · 수학A");
    expect(second).not.toBe(first);
    expect(first).not.toContain("010-secret");
    expect(makeupOptionLabel("students", { id: "bare", name: "김학생" })).toBe("김학생");
  });
  it("종료된 반 안내는 한번만 붙인다", () => {
    expect(makeupOptionLabel("classes", { id: "one", name: "수학A", active: false })).toBe("수학A · 종료된 반");
    expect(makeupOptionLabel("classes", { id: "one", name: "수학A (종료된 반)", active: false })).toBe("수학A (종료된 반)");
  });
});
