import { describe, expect, it } from "vitest";
import { kakaoLicenseActive } from "./kakao-license";

describe("카카오 등하원 알림 라이선스", () => {
  const now = new Date("2026-11-12T00:00:00Z");

  it("행 없음과 조회 실패는 기본 꺼짐이다", () => {
    expect(kakaoLicenseActive(null, false, now)).toBe(false);
    expect(kakaoLicenseActive({ is_active: true, expires_at: null }, true, now)).toBe(false);
  });

  it("만료된 행은 끄고 유효하게 켠 행만 허용한다", () => {
    expect(kakaoLicenseActive({ is_active: true, expires_at: "2026-11-11T23:59:59Z" }, false, now)).toBe(false);
    expect(kakaoLicenseActive({ is_active: true, expires_at: "2026-12-01T00:00:00Z" }, false, now)).toBe(true);
    expect(kakaoLicenseActive({ is_active: true, expires_at: null }, false, now)).toBe(true);
  });
});
