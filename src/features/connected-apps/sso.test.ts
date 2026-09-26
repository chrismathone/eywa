import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SSO_TOKEN_TTL_SEC, signSsoToken, usableSsoSecret } from "./sso";

const SECRET = "x".repeat(40);

describe("연결 앱 자동 로그인 표", () => {
  it("짧거나 빈 secret은 쓰지 않는다(보통 링크로 떨어진다)", () => {
    expect(usableSsoSecret(undefined)).toBeNull();
    expect(usableSsoSecret("  short  ")).toBeNull();
    expect(usableSsoSecret(` ${SECRET} `)).toBe(SECRET);
  });

  it("형식 v1.payload.sig — 신원은 sub(eywa 사용자 id), 받는 쪽이 같은 HMAC으로 검증한다", () => {
    const now = Date.UTC(2026, 8, 26, 3, 0, 0);
    const token = signSsoToken(
      { aud: "todays-math", sub: "u-1", email: " Teacher@Example.COM ", name: "박소선", tenantId: "t-1" },
      SECRET,
      now,
      "jti-1",
    );
    const [v, p, s] = token.split(".");
    expect(v).toBe("v1");
    const expected = createHmac("sha256", SECRET).update(`v1.${p}`).digest("base64url");
    expect(s).toBe(expected);
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString("utf8"));
    expect(payload).toEqual({
      iss: "aywa",
      aud: "todays-math",
      sub: "u-1",
      email: "teacher@example.com",
      name: "박소선",
      tenantId: "t-1",
      iat: now / 1000,
      exp: now / 1000 + SSO_TOKEN_TTL_SEC,
      jti: "jti-1",
    });
  });

  it("수명은 60초 — 늘리지 않는다", () => {
    expect(SSO_TOKEN_TTL_SEC).toBe(60);
  });
});
