import { describe, expect, it } from "vitest";
import {
  autoStaffEmail,
  canEditLoginEmail,
  initialsOf,
  isImportArtifactEmail,
  splitEmailForEdit,
} from "./email";

describe("initialsOf / autoStaffEmail (직원 등록 이메일 자동 생성, 2026-08-07)", () => {
  it("한글 이름 → 초성 로마자('이'씨는 L, ㅇ은 모음)", () => {
    expect(initialsOf("김주현")).toBe("kjh");
    expect(initialsOf("이승엽")).toBe("lsy"); // 성씨 이 = l(Lee)
    expect(initialsOf("육소희")).toBe("ysh"); // 육: ㅇ → 모음 ㅠ → y
    // 원: ㅇ → 모음 ㅝ → w / 일: ㅇ → ㅣ → i. '이=l' 예외는 **첫 글자(성씨)** 에만 적용된다.
    expect(initialsOf("원일")).toBe("wi");
    expect(initialsOf("최수호")).toBe("csh"); // 최 = c
  });

  it("한글이 없으면 영문자만, 그것도 없으면 staff", () => {
    expect(initialsOf("Florence Park")).toBe("florencepark");
    expect(initialsOf("...")).toBe("staff");
  });

  it("이미 쓰는 주소는 피해 숫자를 붙인다", () => {
    expect(autoStaffEmail("김주현", new Set())).toBe("kjh@login.aywa.co.kr");
    expect(autoStaffEmail("김주현", new Set(["kjh@login.aywa.co.kr"]))).toBe("kjh2@login.aywa.co.kr");
    expect(autoStaffEmail("김주현", new Set(["kjh@login.aywa.co.kr", "kjh2@login.aywa.co.kr"]))).toBe("kjh3@login.aywa.co.kr");
  });

  it("후보가 다 차면 null(사람이 개입)", () => {
    const taken = new Set(["kjh@login.aywa.co.kr", ...Array.from({ length: 49 }, (_, i) => `kjh${i + 2}@login.aywa.co.kr`)]);
    expect(autoStaffEmail("김주현", taken)).toBeNull();
  });
});

describe("isImportArtifactEmail", () => {
  it("형식 불량·@imported.local = 임포트 산물", () => {
    expect(isImportArtifactEmail("lab 김주희@imported.local")).toBe(true);
    expect(isImportArtifactEmail("JJ@imported.local")).toBe(true);
    expect(isImportArtifactEmail("teacher@gmail.com")).toBe(false);
  });
});

describe("canEditLoginEmail", () => {
  it("아직 로그인 전인 초대 계정은 오타를 고칠 수 있다", () => {
    // 2026-07-23 실제 사례: 신규 직원 초대에 a01000009101@gmil.com(도메인 오타) → 화면에서 못 고쳤음.
    expect(canEditLoginEmail("a01000009101@gmil.com", false)).toBe(true);
  });

  it("한 번이라도 로그인한 계정은 잠금 — 화면에서 남의 로그인을 갈아끼울 수 없다", () => {
    expect(canEditLoginEmail("a01000009101@gmail.com", true)).toBe(false);
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
