import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { VideoOAuthConfig } from "./config";

/**
 * Google 로그인(웹 서버 방식 + PKCE)의 요청·응답 처리 — fetch 주입(테스트는 가짜 fetch).
 *
 * 🔴 id_token을 풀어 읽지 않는다(서명 확인 없는 JWT를 믿지 않는다) — 계정은 방금 받은 접근 토큰으로 Google UserInfo에 물어 확인한다.
 * 🔴 오류에 코드·토큰·응답 본문을 싣지 않는다. 종류(`kind`)만 올린다.
 */
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=user(permissionId)";
/** 사람이 담임 폴더에 직접 올린 영상을 읽어야 해서 Drive 전체 권한이 필요하다(`drive.file`로는 그 파일이 보이지 않는다). */
export const VIDEO_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const EMAIL_SCOPES = ["email", "https://www.googleapis.com/auth/userinfo.email"];
const TIMEOUT_MS = 20_000;

export type VideoOAuthFailure = "consent" | "scope" | "identity" | "drive" | "google";
export class VideoOAuthError extends Error {
  constructor(readonly kind: VideoOAuthFailure) { super(`video-oauth:${kind}`); }
}

const b64url = (buffer: Buffer): string => buffer.toString("base64url");
export const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");
/** PKCE S256 — 검증값(쿠키)의 해시. DB의 시도 행에는 이 값만 있다. */
export const pkceChallenge = (verifier: string): string => b64url(createHash("sha256").update(verifier).digest());

export const OAUTH_STATE_RE = /^[A-Za-z0-9_-]{43}$/;
export const OAUTH_VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;

/** 로그인 한 번에 쓰는 난수 — state(주소로 오간다)와 검증값(쿠키에만 있다). DB엔 둘의 해시만 간다. */
export function newVideoOAuthAttempt(): { state: string; stateHash: string; verifier: string; challenge: string } {
  const state = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(48));
  return { state, stateHash: sha256Hex(state), verifier, challenge: pkceChallenge(verifier) };
}

export function buildGoogleAuthUrl(input: {
  config: Pick<VideoOAuthConfig, "clientId" | "redirectUri">; state: string; challenge: string; loginHint?: string | null;
}): string {
  const query = new URLSearchParams({
    client_id: input.config.clientId, redirect_uri: input.config.redirectUri, response_type: "code",
    scope: ["openid", "email", VIDEO_DRIVE_SCOPE].join(" "), access_type: "offline", prompt: "consent select_account",
    include_granted_scopes: "false", state: input.state, code_challenge: input.challenge, code_challenge_method: "S256",
  });
  if (input.loginHint) query.set("login_hint", input.loginHint);
  return `${AUTH_URL}?${query}`;
}

/** 허락한 권한에 Drive·openid·이메일이 다 있나 — 동의 화면에서 Drive를 빼고 허락할 수 있다. */
export function hasRequiredScopes(scope: unknown): boolean {
  const granted = new Set(String(scope ?? "").split(/\s+/).filter(Boolean));
  return granted.has(VIDEO_DRIVE_SCOPE) && granted.has("openid") && EMAIL_SCOPES.some((name) => granted.has(name));
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try { return (await response.json()) as Record<string, unknown>; } catch { return null; }
}

/** 돌아온 코드 → 토큰. 갱신 토큰이 없거나 권한이 모자라면 실패(저장하지 않는다). */
export async function exchangeGoogleCode(input: {
  config: VideoOAuthConfig; code: string; verifier: string; fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; refreshToken: string }> {
  const { config } = input;
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(TOKEN_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(TIMEOUT_MS),
      body: new URLSearchParams({
        client_id: config.clientId, client_secret: config.clientSecret, code: input.code, code_verifier: input.verifier,
        redirect_uri: config.redirectUri, grant_type: "authorization_code",
      }).toString(),
    });
  } catch { throw new VideoOAuthError("google"); }
  const data = await readJson(response);
  if (!response.ok || !data) throw new VideoOAuthError("google");
  if (typeof data.access_token !== "string" || !data.access_token) throw new VideoOAuthError("google");
  if (typeof data.refresh_token !== "string" || !data.refresh_token) throw new VideoOAuthError("consent");
  if (!hasRequiredScopes(data.scope)) throw new VideoOAuthError("scope");
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

async function authorizedJson(url: string, accessToken: string, fetchImpl: typeof fetch, kind: VideoOAuthFailure): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch { throw new VideoOAuthError(kind); }
  const data = await readJson(response);
  if (!response.ok || !data) throw new VideoOAuthError(kind);
  return data;
}

/** 로그인한 계정 — Google이 확인해 준 변하지 않는 번호(sub)와 확인된 이메일. 확인 안 된 이메일은 받지 않는다. */
export async function fetchGoogleIdentity(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<{ subject: string; email: string }> {
  const data = await authorizedJson(USERINFO_URL, accessToken, fetchImpl, "identity");
  const subject = typeof data.sub === "string" ? data.sub.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  if (!/^[0-9A-Za-z_-]{1,255}$/.test(subject) || data.email_verified !== true) throw new VideoOAuthError("identity");
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) throw new VideoOAuthError("identity");
  return { subject, email };
}

/** 그 계정의 Drive가 실제로 열리는지 + Drive가 주는 계정 번호(permissionId — 어느 앱으로 로그인해도 같은 값). */
export async function fetchDrivePermissionId(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const data = await authorizedJson(DRIVE_ABOUT_URL, accessToken, fetchImpl, "drive");
  const id = (data.user as { permissionId?: unknown } | undefined)?.permissionId;
  if (typeof id !== "string" || !/^[0-9A-Za-z_-]{1,128}$/.test(id)) throw new VideoOAuthError("drive");
  return id;
}
