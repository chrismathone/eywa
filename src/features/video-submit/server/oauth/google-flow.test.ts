import { describe, expect, it, vi } from "vitest";
import { readVideoOAuthConfig, videoOAuthClientSecret, videoOAuthCookie } from "./config";
import { isVideoOAuthDoneStatus, renderVideoOAuthDonePage } from "./done-page";
import {
  buildGoogleAuthUrl, exchangeGoogleCode, fetchDrivePermissionId, fetchGoogleIdentity, hasRequiredScopes, newVideoOAuthAttempt,
  pkceChallenge, sha256Hex, VIDEO_DRIVE_SCOPE, VideoOAuthError,
} from "./google-flow";

const CALLBACK = "https://www.aywa.co.kr/api/integrations/homework-video-drive/callback";
const ENV = { HOMEWORK_VIDEO_GOOGLE_CLIENT_ID: "web-client", HOMEWORK_VIDEO_GOOGLE_CLIENT_SECRET: "web-secret", HOMEWORK_VIDEO_GOOGLE_REDIRECT_URI: CALLBACK };
const config = readVideoOAuthConfig(ENV)!;
const SCOPES = `openid https://www.googleapis.com/auth/userinfo.email ${VIDEO_DRIVE_SCOPE}`;
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const kindOf = async (run: Promise<unknown>) => run.then(() => "ok", (error: unknown) => (error instanceof VideoOAuthError ? error.kind : "other"));

describe("앱 설정(env)", () => {
  it("세 값이 다 있고 돌아오는 주소가 https + 정해진 경로일 때만 켜진다 — http는 개발용 localhost만", () => {
    expect(config).toMatchObject({ clientId: "web-client", redirectUri: CALLBACK, origin: "https://www.aywa.co.kr", host: "www.aywa.co.kr", secure: true });
    for (const key of Object.keys(ENV)) expect(readVideoOAuthConfig({ ...ENV, [key]: "" })).toBeNull();
    for (const bad of ["http://www.aywa.co.kr/api/integrations/homework-video-drive/callback", "https://www.aywa.co.kr/other", `${CALLBACK}?next=/x`, `${CALLBACK}#x`,
      "https://user:pw@www.aywa.co.kr/api/integrations/homework-video-drive/callback", "not a url"])
      expect(readVideoOAuthConfig({ ...ENV, HOMEWORK_VIDEO_GOOGLE_REDIRECT_URI: bad }), bad).toBeNull();
    expect(readVideoOAuthConfig({ ...ENV, HOMEWORK_VIDEO_GOOGLE_REDIRECT_URI: "http://localhost:3000/api/integrations/homework-video-drive/callback" })).toMatchObject({ secure: false, host: "localhost:3000" });
  });
  it("비밀은 저장된 클라이언트 번호로 고른다 — 지금 앱·예전 앱(선택 env)만, 모르는 번호에는 주지 않는다", () => {
    expect(videoOAuthClientSecret("web-client", ENV)).toBe("web-secret");
    expect(videoOAuthClientSecret("other-client", ENV)).toBeNull();
    const rotated = { ...ENV, HOMEWORK_VIDEO_GOOGLE_PREVIOUS_CLIENT_ID: "old-client", HOMEWORK_VIDEO_GOOGLE_PREVIOUS_CLIENT_SECRET: "old-secret" };
    expect(videoOAuthClientSecret("old-client", rotated)).toBe("old-secret");
    expect(videoOAuthClientSecret("", rotated)).toBeNull();
  });
  it("검증값 쿠키는 https에서 __Secure- 접두 + 연결 라우트 경로로 좁힌다", () => {
    expect(videoOAuthCookie(config)).toEqual({ name: "__Secure-aywa-video-drive-oauth", path: "/api/integrations/homework-video-drive", secure: true });
    expect(videoOAuthCookie({ secure: false }).name).toBe("aywa-video-drive-oauth");
  });
});

describe("인증 요청", () => {
  it("state·검증값은 매번 새 난수이고 DB로 가는 것은 해시뿐이다(S256)", () => {
    const a = newVideoOAuthAttempt();
    const b = newVideoOAuthAttempt();
    expect(a.state).not.toBe(b.state); expect(a.verifier).not.toBe(b.verifier);
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(a.stateHash).toBe(sha256Hex(a.state)); expect(a.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.challenge).toBe(pkceChallenge(a.verifier)); expect(a.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("주소에는 고정 돌아오는 주소·PKCE·오프라인 동의·계정 고르기가 실리고 비밀·검증값은 없다", () => {
    const attempt = newVideoOAuthAttempt();
    const url = new URL(buildGoogleAuthUrl({ config, state: attempt.state, challenge: attempt.challenge, loginHint: "a@example.com" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "web-client", redirect_uri: CALLBACK, response_type: "code", access_type: "offline", prompt: "consent select_account",
      state: attempt.state, code_challenge: attempt.challenge, code_challenge_method: "S256", login_hint: "a@example.com",
    });
    expect(url.searchParams.get("scope")!.split(" ")).toEqual(["openid", "email", VIDEO_DRIVE_SCOPE]);
    expect(url.toString()).not.toContain("web-secret"); expect(url.toString()).not.toContain(attempt.verifier);
    expect(new URL(buildGoogleAuthUrl({ config, state: "s", challenge: "c" })).searchParams.has("login_hint")).toBe(false);
  });
});

describe("코드 교환·계정 확인", () => {
  it("코드·검증값·비밀·고정 주소를 Google 토큰 서버에만 보낸다 · 갱신 토큰과 필요한 권한이 다 있어야 성공", async () => {
    const fetchImpl = reply({ access_token: "at", refresh_token: "rt", scope: SCOPES });
    expect(await exchangeGoogleCode({ config, code: "the-code", verifier: "the-verifier", fetchImpl })).toEqual({ accessToken: "at", refreshToken: "rt" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      client_id: "web-client", client_secret: "web-secret", code: "the-code", code_verifier: "the-verifier", redirect_uri: CALLBACK, grant_type: "authorization_code",
    });
  });
  it("갱신 토큰 없음 = consent · Drive나 이메일 권한 빠짐 = scope · Google 오류 = google — 오류에 코드·비밀·응답 원문이 없다", async () => {
    const run = (body: unknown, status = 200) => exchangeGoogleCode({ config, code: "the-code", verifier: "the-verifier", fetchImpl: reply(body, status) });
    expect(await kindOf(run({ access_token: "at", scope: SCOPES }))).toBe("consent");
    expect(await kindOf(run({ access_token: "at", refresh_token: "rt", scope: "openid email" }))).toBe("scope");
    expect(await kindOf(run({ access_token: "at", refresh_token: "rt", scope: `openid ${VIDEO_DRIVE_SCOPE}` }))).toBe("scope");
    expect(await kindOf(run({ error: "invalid_grant", error_description: "Bad Request the-code" }, 400))).toBe("google");
    const error = await run({ error: "invalid_client", error_description: "web-secret the-code" }, 401).catch((thrown: Error) => thrown);
    expect(String((error as Error).message)).not.toMatch(/web-secret|the-code|the-verifier|invalid_client/);
    expect(hasRequiredScopes(`openid email ${VIDEO_DRIVE_SCOPE}`)).toBe(true);
    expect(hasRequiredScopes(`openid email https://www.googleapis.com/auth/drive.file`)).toBe(false);
  });
  it("🔴 계정은 Google UserInfo가 답한 값만 쓴다 — 토큰 응답에 섞여 온 id_token(서명 미확인)은 읽지 않는다", async () => {
    // 다른 계정이라고 주장하는 id_token을 끼워 보낸다. 교환 결과에 실리지 않고, 계정은 UserInfo 응답으로만 정해진다.
    const forged = `x.${Buffer.from(JSON.stringify({ sub: "attacker", email: "attacker@example.com", email_verified: true })).toString("base64url")}.x`;
    const tokens = await exchangeGoogleCode({ config, code: "c", verifier: "v", fetchImpl: reply({ access_token: "at", refresh_token: "rt", scope: SCOPES, id_token: forged }) });
    expect(JSON.stringify(tokens)).not.toContain("attacker");
    const userinfo = reply({ sub: "1234567890", email: "Branch@Example.com", email_verified: true });
    expect(await fetchGoogleIdentity("at", userinfo)).toEqual({ subject: "1234567890", email: "branch@example.com" });
    expect((userinfo.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Authorization: "Bearer at" });
  });
  it("확인 안 된 이메일·번호 없는 응답·Google 오류는 받지 않는다 · Drive가 안 열리면 받지 않는다", async () => {
    expect(await kindOf(fetchGoogleIdentity("at", reply({ sub: "1", email: "a@example.com", email_verified: false })))).toBe("identity");
    expect(await kindOf(fetchGoogleIdentity("at", reply({ sub: "1", email: "a@example.com", email_verified: "true" })))).toBe("identity");
    expect(await kindOf(fetchGoogleIdentity("at", reply({ email: "a@example.com", email_verified: true })))).toBe("identity");
    expect(await kindOf(fetchGoogleIdentity("at", reply({ error: "invalid_token" }, 401)))).toBe("identity");
    expect(await fetchDrivePermissionId("at", reply({ user: { permissionId: "0123456789" } }))).toBe("0123456789");
    expect(await kindOf(fetchDrivePermissionId("at", reply({ user: {} })))).toBe("drive");
    expect(await kindOf(fetchDrivePermissionId("at", reply({ error: "forbidden" }, 403)))).toBe("drive");
  });
});

describe("결과 화면", () => {
  it("정해 둔 상태 이름만 받는다 — 주소의 글자를 화면·신호에 그대로 찍지 않는다", () => {
    expect(isVideoOAuthDoneStatus("connected")).toBe(true);
    for (const bad of ["<script>alert(1)</script>", "toString", "__proto__", "", null, 1]) expect(isVideoOAuthDoneStatus(bad)).toBe(false);
    const html = renderVideoOAuthDonePage('"</script><script>alert(1)</script>');
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("연결하지 못했습니다");
    expect(html).toContain('status:"failed"');
  });
  it("성공 화면은 상태 이름 하나만 신호로 보낸다 — 코드·state·토큰·계정이 없다", () => {
    const html = renderVideoOAuthDonePage("connected");
    expect(html).toContain("Google 계정을 연결했습니다");
    expect(html).toContain('new BroadcastChannel("aywa-video-drive-oauth")');
    expect(html).toContain('{type:"video-drive-oauth",status:"connected"}');
    expect(html).not.toMatch(/code=|state=|access_token|refresh|@/);
  });
});
