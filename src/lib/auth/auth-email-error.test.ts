import { describe, expect, it } from "vitest";
import { EMAIL_TAKEN_MESSAGE, isEmailTakenAuthError } from "./auth-email-error";

describe("isEmailTakenAuthError — 로그인 이메일은 전 지점에서 하나(Auth가 막는다)", () => {
  it("createUser의 실제 모양: 422 email_exists", () => {
    expect(
      isEmailTakenAuthError({
        status: 422,
        code: "email_exists",
        message: "A user with this email address has already been registered",
      }),
    ).toBe(true);
    expect(isEmailTakenAuthError({ code: "user_already_exists", message: "User already registered" })).toBe(true);
  });

  it("코드 없이 문구만 오는 옛 모양 — 이메일을 말할 때만", () => {
    expect(isEmailTakenAuthError({ message: "A user with this email address has already been registered" })).toBe(true);
    expect(isEmailTakenAuthError(new Error("Email address already registered by another user"))).toBe(true);
  });

  it("🔴 전화번호 중복은 이메일 중복이 아니다 — GoTrue 실제 문구 둘(코드가 있든 없든)", () => {
    const real = [
      "A user with this phone number has already been registered",
      "Phone number already registered by another user",
    ];
    for (const message of real) {
      expect(isEmailTakenAuthError({ code: "phone_exists", message })).toBe(false);
      expect(isEmailTakenAuthError({ message })).toBe(false);
    }
  });

  it("🔴 updateUserById의 이메일 중복은 이 함수로 못 잡는다(500 unexpected_failure) — 변경 경로는 사전 조회가 맡는다", () => {
    expect(isEmailTakenAuthError({ status: 500, code: "unexpected_failure", message: "Error updating user" })).toBe(false);
  });

  it("다른 오류는 중복으로 읽지 않는다 — 원인을 가리면 안 된다", () => {
    expect(isEmailTakenAuthError({ message: "Password should be at least 6 characters" })).toBe(false);
    expect(isEmailTakenAuthError({ message: "Database error creating new user" })).toBe(false);
    expect(isEmailTakenAuthError({ code: "email_address_invalid", message: "Email address is invalid" })).toBe(false);
    expect(isEmailTakenAuthError({ message: "User not found" })).toBe(false);
  });

  it("객체가 아니면 false", () => {
    expect(isEmailTakenAuthError(null)).toBe(false);
    expect(isEmailTakenAuthError(undefined)).toBe(false);
    expect(isEmailTakenAuthError("already registered")).toBe(false);
  });

  it("안내문은 한글이고 어느 지점인지는 말하지 않는다", () => {
    expect(EMAIL_TAKEN_MESSAGE).toMatch(/이미 사용 중인 이메일/);
    expect(EMAIL_TAKEN_MESSAGE).not.toMatch(/침산/);
  });
});
