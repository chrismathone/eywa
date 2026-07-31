import { describe, expect, it } from "vitest";
import { canEditLoginEmail, isImportArtifactEmail, splitEmailForEdit } from "./email";

describe("isImportArtifactEmail", () => {
  it("형식 불량·@imported.local = 임포트 산물", () => {
    expect(isImportArtifactEmail("lab 김주희@imported.local")).toBe(true);
    expect(isImportArtifactEmail("JJ@imported.local")).toBe(true);
    expect(isImportArtifactEmail("teacher@gmail.com")).toBe(false);
  });
});

describe("canEditLoginEmail", () => {
  it("아직 로그인 전인 초대 계정은 오타를 고칠 수 있다", () => {
    // 2026-07-23 실제 사례: 신규 직원 초대에 a01025015783@gmil.com(도메인 오타) → 화면에서 못 고쳤음.
    expect(canEditLoginEmail("a01025015783@gmil.com", false)).toBe(true);
  });

  it("한 번이라도 로그인한 계정은 잠금 — 화면에서 남의 로그인을 갈아끼울 수 없다", () => {
    expect(canEditLoginEmail("a01025015783@gmail.com", true)).toBe(false);
  });

  it("임포트 산물은 로그인 이력과 무관하게 교정 허용(애초에 로그인용이 아니다)", () => {
    expect(canEditLoginEmail("lab 김주희@imported.local", true)).toBe(true);
  });
});

describe("splitEmailForEdit", () => {
  it("도메인은 지금 쓰는 것을 그대로 들고 온다(조용한 도메인 변경 방지)", () => {
    expect(splitEmailForEdit("guswls9113@naver.com")).toEqual({ local: "guswls9113", domain: "naver.com" });
    expect(splitEmailForEdit("krissi@thewritehustle.com")).toEqual({
      local: "krissi",
      domain: "thewritehustle.com",
    });
  });

  it("gmail은 그대로", () => {
    expect(splitEmailForEdit("kdh@gmail.com")).toEqual({ local: "kdh", domain: "gmail.com" });
  });

  it("임시 주소(@imported.local)는 기본 도메인으로 바꾸고, 쓸 만한 아이디만 남긴다", () => {
    expect(splitEmailForEdit("florence@imported.local")).toEqual({ local: "florence", domain: "gmail.com" });
    // 사람이 쓸 수 없는 아이디는 비운다 — 그대로 두면 그게 새 아이디가 된다.
    expect(splitEmailForEdit("sheet-26-65579e04@imported.local")).toEqual({ local: "", domain: "gmail.com" });
    expect(splitEmailForEdit("sam 김태건@imported.local")).toEqual({ local: "", domain: "gmail.com" });
  });

  it("비었거나 @가 없으면 빈 아이디 + 기본 도메인", () => {
    expect(splitEmailForEdit("")).toEqual({ local: "", domain: "gmail.com" });
    expect(splitEmailForEdit(null)).toEqual({ local: "", domain: "gmail.com" });
    expect(splitEmailForEdit("@gmail.com")).toEqual({ local: "", domain: "gmail.com" });
  });

  it("도메인 대문자는 소문자로 통일", () => {
    expect(splitEmailForEdit("A@GMAIL.COM")).toEqual({ local: "A", domain: "gmail.com" });
  });
});
