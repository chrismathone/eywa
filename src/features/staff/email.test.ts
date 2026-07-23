import { describe, expect, it } from "vitest";
import { canEditLoginEmail, isImportArtifactEmail } from "./email";

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
