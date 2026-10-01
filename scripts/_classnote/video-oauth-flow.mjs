// scripts/_classnote/video-oauth-flow.mjs — Drive OAuth 최초 허락(브라우저 로그인 1회)의 순수 부분. 의존성 0.
//
// 데스크톱 앱 방식(내 PC의 127.0.0.1로 돌아오는 주소 + PKCE). 실행부 = video-oauth-login.mjs.
// 🔴 비밀·코드·토큰을 오류 문장에 싣지 않는다.
import { createHash, randomBytes } from "node:crypto";
import { DRIVE_SCOPE, oauthErrorReason } from "./video-oauth-refresh.mjs";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 구글 클라우드 콘솔에서 받은 클라이언트 JSON → {clientId, clientSecret}. '데스크톱 앱' 유형만 받는다. */
export function readClientJson(text) {
  let data;
  try { data = JSON.parse(String(text ?? "").replace(/^\uFEFF/, "")); } catch { throw new Error("클라이언트 JSON 파일을 읽지 못했습니다."); }
  if (data?.web && !data?.installed) throw new Error("'웹 애플리케이션' 유형의 클라이언트입니다 — '데스크톱 앱' 유형으로 새로 만들어 주세요.");
  const c = data?.installed;
  if (!c?.client_id || !c?.client_secret) throw new Error("OAuth 클라이언트 JSON이 아닙니다(구글 클라우드 콘솔에서 받은 client_secret_….json).");
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

/** 한 번의 로그인 시도에 쓸 난수(state·PKCE). */
export function newLoginAttempt() {
  const verifier = b64url(randomBytes(48));
  return { state: b64url(randomBytes(24)), verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function buildAuthUrl({ clientId, redirectUri, state, challenge, account }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: DRIVE_SCOPE,
    access_type: "offline", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256",
  });
  if (account) q.set("login_hint", account);
  return `${AUTH_URL}?${q}`;
}

/** 돌아온 주소의 코드 → 토큰. 갱신 토큰이 없으면 실패(이미 허락한 앱은 `prompt=consent` 없이는 안 준다). */
export async function exchangeCode({ clientId, clientSecret, code, verifier, redirectUri, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error("Drive 인증 서버에 연결하지 못했습니다."); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(oauthErrorReason(res.status, data?.error));
  if (!data?.refresh_token) throw new Error("갱신 토큰을 받지 못했습니다 — 다시 실행해 '허용'을 눌러 주세요.");
  if (!String(data.scope ?? "").split(/\s+/).includes(DRIVE_SCOPE)) throw new Error("Drive 권한이 허락되지 않았습니다 — 동의 화면에서 Drive 항목을 체크해 주세요.");
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}
