/** 합성 UI 검증 전용 JWT. 운영 키·환경 파일을 읽지 않는다. */
import { createHmac, timingSafeEqual } from "node:crypto";
export const SECRET = "makeup-browser-local-test-key-20261005-only";
export const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const credentials = {
  "master@a.test": 21, "admin1@a.test": 22, "teacher1@a.test": 25,
  "desk@a.test": 27, "viewer@a.test": 28, "gone@a.test": 29, "master@b.test": 31,
};
export function token(role = "authenticated", n = 22) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    role, sub: uid(n), aud: "authenticated", iat: now, exp: now + 86400,
    email: Object.keys(credentials).find(email => credentials[email] === n) ?? "local@test.invalid",
  })}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
export function claims(jwt) {
  const pieces = String(jwt).split(".");
  if (pieces.length !== 3) throw new Error("invalid local token");
  const expected = createHmac("sha256", SECRET).update(`${pieces[0]}.${pieces[1]}`).digest();
  const signature = Buffer.from(pieces[2], "base64url");
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error("invalid local signature");
  const result = JSON.parse(Buffer.from(pieces[1], "base64url").toString());
  if (result.exp <= Date.now() / 1000) throw new Error("local token expired");
  return result;
}
export function user(n) {
  return { id: uid(n), aud: "authenticated", role: "authenticated",
    email: Object.keys(credentials).find(email => credentials[email] === n),
    email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [],
  };
}
export function session(n = 22) {
  return { access_token: token("authenticated", n), refresh_token: `local:${n}`,
    token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: user(n) };
}
