import { createHmac, randomUUID } from "node:crypto";

/**
 * 연결 앱 **자동 로그인 표**(SSO) — eywa에 로그인한 사람을 오늘 수학의 **연결된 계정**으로 들여보낸다.
 *
 * 원장 2026-09-26: *"기존 eywa의 계정이 today_math에도 계정 로그인 가능하게"* → 이메일 방식은 잠갔다(아래) →
 * **1번 "처음 한 번 비밀번호로 연결"** 확정(*"1번으로 진행해"*).
 *
 * 🔴 **이메일은 신원이 아니다** — eywa의 계정 생성·이메일 변경은 전부 확인 메일 없이 즉시 확정된다(`email_confirm: true`):
 *    직원 누구나 '내 계정'에서 자기 이메일을 바꿀 수 있고 관리자·직원 등록 QR도 아무 이메일로 계정을 만든다. 그래서 첫 판(이메일로
 *    로그인)은 오늘 수학에만 있는 이메일(원장 계정)을 가로챌 수 있는 구멍이었다. 지금 판은 **바뀌지 않는 eywa 사용자 id(`sub`, 필수)**가
 *    신원이고, 받는 쪽은 `sub`가 **연결된 계정**에만 로그인시킨다. 연결은 그 계정 주인이 오늘 수학 비밀번호로 **처음 한 번**
 *    직접 확인할 때만 생긴다(받는 쪽 구현). 표의 `email`·`name`은 연결 화면에 "어느 eywa 계정인가"를 보여 주는 **표시용**이다.
 *
 * 형식 `v1.<payloadB64>.<sigB64>` — payloadB64 = base64url(JSON), sig = HMAC-SHA256(secret, "v1." + payloadB64).
 * 머리는 `v1` 그대로다(받는 쪽 제안 — 판을 가르는 건 **`sub` 필수**: `sub` 없는 표는 받는 쪽이 거절).
 * 🔴 수명 60초 — 표가 주소창·기록에 남아도 곧 쓸모가 없어진다. 늘리지 말 것.
 * 🔴 secret(`EYWA_SSO_SECRET`)은 두 배포에 같은 값 · 32자 미만이면 표를 만들지 않는다(보통 링크로 떨어진다).
 *    **두 쪽 모두 연결 방식을 구현·배포한 뒤에만** 넣는다(그 전엔 받는 쪽이 늘 거절).
 * ⚠️ 서버 전용이지만 `server-only`는 붙이지 않는다 — 순수 함수라 Vitest가 직접 부른다(node:crypto라 클라에 못 간다).
 */
export const SSO_TOKEN_VERSION = "v1";
export const SSO_TOKEN_TTL_SEC = 60;
export const SSO_MIN_SECRET_LEN = 32;

export type SsoPayload = {
  iss: "aywa";
  aud: string;
  /** eywa `users.id`(uuid) — 신원. 이메일을 바꿔도 안 바뀐다. */
  sub: string;
  /** 표시용(연결 화면) — 신원 판정에 쓰지 말 것. */
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
  input: { aud: string; sub: string; email: string; name: string; tenantId: string },
  secret: string,
  nowMs: number = Date.now(),
  jti: string = randomUUID(),
): string {
  const iat = Math.floor(nowMs / 1000);
  const payload: SsoPayload = {
    iss: "aywa",
    aud: input.aud,
    sub: input.sub,
    email: input.email.trim().toLowerCase(),
    name: input.name,
    tenantId: input.tenantId,
    iat,
    exp: iat + SSO_TOKEN_TTL_SEC,
    jti,
  };
  const body = `${SSO_TOKEN_VERSION}.${b64url(Buffer.from(JSON.stringify(payload), "utf8"))}`;
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}
