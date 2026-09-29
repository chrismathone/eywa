import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "./login-error";

describe("loginErrorMessage", () => {
  it("차단된 계정(퇴사)은 한글 안내 — 영문 원문을 내보내지 않는다", () => {
    expect(loginErrorMessage({ code: "user_banned", status: 400, message: "User is banned" })).toContain("사용이 중지된 계정");
    expect(loginErrorMessage({ message: "User is banned" })).toContain("사용이 중지된 계정");
  });
  it("잘못된 비밀번호", () => {
    expect(loginErrorMessage({ code: "invalid_credentials" })).toBe("계정 또는 비밀번호가 올바르지 않습니다.");
  });
  it("모르는 오류는 일반 안내", () => {
    expect(loginErrorMessage({ message: "boom" })).toContain("로그인하지 못했습니다");
  });
});
