import { describe, expect, it } from "vitest";
import { authPasswordErrorMessage } from "./auth-password-error";

describe("비밀번호 Auth 오류 한글화", () => {
  it("코드로만 판정", () => {
    expect(authPasswordErrorMessage({ code: "weak_password", message: "Password should be at least 6 characters" })).toContain("단순");
    expect(authPasswordErrorMessage({ code: "same_password" })).toContain("같습니다");
    expect(authPasswordErrorMessage({ message: "weak_password" })).toBeNull();
    expect(authPasswordErrorMessage(null)).toBeNull();
  });
});
