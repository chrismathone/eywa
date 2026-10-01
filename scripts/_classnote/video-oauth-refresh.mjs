// scripts/_classnote/video-oauth-refresh.mjs — Drive OAuth(갱신 토큰) 인증. 원장 2026-09-30 *"oauth 방식으로 가고 싶은데"*.
//
// 발송 PC에 Google 로그인도 Cloud CLI도 두지 않는 길이다 — 다른 PC에서 한 번 허락받아 얻은 갱신 토큰(값 3개)만 PC `.env.local`에 둔다.
// 올린 파일의 주인은 허락한 계정 그대로다(gcloud 방식과 결과가 같다).
// ⚠️ 의존성 0(fetch만) — 연동 PC의 node_modules에 googleapis가 없어도 돈다. 이 파일에 무거운 import를 더하지 말 것.
// 🔴 토큰·클라이언트 비밀을 오류 문장·로그에 싣지 않는다(응답 본문을 그대로 던지지 말 것).
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
/** 만료 2분 전부터 새로 받는다 — 긴 업로드 도중 만료되는 걸 피한다. */
const EARLY_MS = 120_000;

/** 토큰 서버 오류 코드 → 한글 사유(원문은 싣지 않는다). */
export function oauthErrorReason(status, code) {
  if (code === "invalid_grant") return "Drive 허락이 만료됐거나 취소됐습니다 — 영상 연결(OAuth)을 다시 하세요.";
  if (code === "invalid_client" || code === "unauthorized_client") return "Drive OAuth 클라이언트 값이 맞지 않습니다 — 값 파일을 다시 만들어 주세요.";
  return `Drive 인증 갱신 실패 HTTP ${status}`;
}

export function oauthRefreshAuth({ clientId, clientSecret, refreshToken, fetchImpl = fetch, now = Date.now }) {
  if (!clientId || !clientSecret) throw new Error("Drive OAuth client ID/secret이 필요합니다.");
  if (!refreshToken) throw new Error("Drive OAuth 갱신 토큰이 필요합니다.");
  let token = null;
  let expires = 0;
  let pending = null;
  async function refresh() {
    let res;
    try {
      res = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new Error("Drive 인증 서버에 연결하지 못했습니다."); }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(oauthErrorReason(res.status, data?.error));
    if (typeof data?.access_token !== "string" || !data.access_token) throw new Error("Drive 인증 토큰을 받지 못했습니다.");
    token = data.access_token;
    expires = now() + (Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600) * 1000 - EARLY_MS;
    return token;
  }
  return { kind: "oauth", async accessToken() {
    if (token && now() < expires) return token;
    // 동시에 여러 요청이 와도 갱신은 한 번만.
    pending ??= refresh().finally(() => { pending = null; });
    return pending;
  } };
}
