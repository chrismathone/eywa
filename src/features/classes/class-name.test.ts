import { describe, expect, it } from "vitest";
import { normalizeClassName, reservedClassNameReason } from "./class-name";

describe("normalizeClassName", () => {
  it("연속 공백을 한 칸으로 — 실사례 `중등M 개별  BS3R`", () => {
    expect(normalizeClassName("중등M 개별  BS3R")).toBe("중등M 개별 BS3R");
  });
  it("앞뒤 공백·탭·줄바꿈·NBSP", () => {
    expect(normalizeClassName("  초등M\t초5 EL2T \n")).toBe("초등M 초5 EL2T");
  });
  it("이미 정리된 이름은 그대로(괄호·특수문자 보존)", () => {
    expect(normalizeClassName("[특강]중2-2 문제 풀이반")).toBe("[특강]중2-2 문제 풀이반");
    expect(normalizeClassName("고등내신특강(목)")).toBe("고등내신특강(목)");
  });
  it("비었으면 빈 문자열", () => {
    expect(normalizeClassName(null)).toBe("");
    expect(normalizeClassName("   ")).toBe("");
  });
});

describe("reservedClassNameReason — ClassNote 1인 보드·전체방 모양 이름 거절(2026-09-30 개명 감사 G2)", () => {
  it("(과목)이름 · [ALL] 모양은 거절(앞 공백 무시)", () => {
    expect(reservedClassNameReason("(수학)홍길동")).toBeTruthy();
    expect(reservedClassNameReason("  (영어) 홍길동")).toBeTruthy();
    expect(reservedClassNameReason("[ALL] 인재원 전체방")).toBeTruthy();
    expect(reservedClassNameReason("[all]방")).toBeTruthy();
  });
  it("보통 반 이름·[특강]·뒤쪽 괄호는 통과", () => {
    expect(reservedClassNameReason("[특강]중2-2 문제 풀이반")).toBeNull();
    expect(reservedClassNameReason("고등내신특강(목)")).toBeNull();
    expect(reservedClassNameReason("중등M 중1 BS3E")).toBeNull();
    expect(reservedClassNameReason("")).toBeNull();
  });
});
