import { createHmac, randomUUID } from "node:crypto";

/**
 * 연결 앱 **자동 로그인 표**(SSO) — eywa에 로그인한 사람을 오늘의 수학에 같은 이메일 계정으로 들여보낸다.
 *
 * 원장 2026-09-26: 토글을 켰을 때 *"기존 eywa의 계정이 today_math에도 계정 로그인 가능하게"* → 추천안 승인
 * (*"그래"*): **자동 가입 없음** — 오늘의 수학에 같은 이메일 계정이 **이미 있을 때만** 로그인. 없으면 그쪽
 * 평소 로그인 화면이다. 받는 쪽(검증·로그인)은 오늘의 수학 저장소가 구현한다(계약은 아래 형식이 전부).
 *
 * 형식 `v1.<payloadB64>.<sigB64>` — payloadB64 = base64url(JSON), sig = HMAC-SHA256(secret, "v1." + payloadB64).
 * 🔴 수명 60초 — 표가 주소창·기록에 남아도 곧 쓸모가 없어진다. 늘리지 말 것.
 * 🔴 secret(`EYWA_SSO_SECRET`)은 두 배포에 같은 값 · 32자 미만이면 표를 만들지 않는다(보통 링크로 떨어진다).
 * 🔴🔴 **지금은 secret을 넣지 말 것(2026-09-26 잠금)** — eywa 이메일은 본인 확인값이 아니다(직원이 자기 이메일을 확인 메일 없이
 *    바꿀 수 있다). 이메일로 로그인시키면 계정 탈취 구멍이라 받는 쪽도 늘 거절하게 잠갔다. 다음 판은 바뀌지 않는 eywa 사용자 id(`sub`)
 *    + 오늘의 수학 비밀번호로 처음 한 번 연결 — [`decisions/tenant.md`](../../../docs/decisions/tenant.md) 연결 앱.
 * ⚠️ 서버 전용이지만 `server-only`는 붙이지 않는다 — 순수 함수라 Vitest가 직접 부른다(node:crypto라 클라에 못 간다).
 */
export const SSO_TOKEN_TTL_SEC = 60;
export const SSO_MIN_SECRET_LEN = 32;

export type SsoPayload = {
  iss: "aywa";
  aud: string;
  email: string;
  name: string;
  tenantId: string;
  iat: number;
  exp: number;
  jti: string;
};

const b64url = (buf: Buffer) => buf.toString("base64url");

export function usableSsoSecret(raw: string | undefined): string | null {
  const s = raw?.trim() ?? "";
  return s.length >= SSO_MIN_SECRET_LEN ? s : null;
}

export function signSsoToken(
  input: { aud: string; email: string; name: string; tenantId: string },
  secret: string,
  nowMs: number = Date.now(),
  jti: string = randomUUID(),
): string {
  const iat = Math.floor(nowMs / 1000);
  const payload: SsoPayload = {
    iss: "aywa",
    aud: input.aud,
    email: input.email.trim().toLowerCase(),
    name: input.name,
    tenantId: input.tenantId,
    iat,
    exp: iat + SSO_TOKEN_TTL_SEC,
    jti,
  };
  const body = `v1.${b64url(Buffer.from(JSON.stringify(payload), "utf8"))}`;
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}
