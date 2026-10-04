// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
import { ENV, OTHER_T, ROOT, T, settings } from "@/features/video-submit/server/test-fixture.test-util";
import { CONN, WEB_ENV, WEB_ORIGIN, addConnection, withAccountSchema } from "@/features/video-submit/server/account-fixture.test-util";

const m = vi.hoisted(() => ({ db: null as unknown, actor: null as unknown, allowed: true, moduleOn: true, audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => m.allowed }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => settings() }));
vi.mock("@/features/owner/classnote-gate", () => ({ classnoteModuleOn: () => m.moduleOn }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { GET } from "./route";
import { _resetVideoDriveConfigForTest } from "@/features/video-submit/server/drive-config";
import { pkceChallenge, sha256Hex, VIDEO_DRIVE_SCOPE } from "@/features/video-submit/server/oauth/google-flow";

const CALLBACK = WEB_ENV.HOMEWORK_VIDEO_GOOGLE_REDIRECT_URI;
const COOKIE = "__Secure-aywa-video-drive-oauth";
const STATE = "s".repeat(43);
const VERIFIER = "v".repeat(64);
const CODE = "4/0AbCdEf-secret-code";
const USER = "22222222-2222-4222-8222-222222222222";
const VERSION = "12121212-1212-4121-8121-121212121212";
const SCOPES = `openid https://www.googleapis.com/auth/userinfo.email ${VIDEO_DRIVE_SCOPE}`;
type Rpc = (args: Record<string, unknown>) => unknown;
let db: FakeDb;
let consume: Mock<Rpc>;
let connect: Mock<Rpc>;
let claim: Mock<Rpc>;
let calls: { url: string; init?: RequestInit }[];
let token: Record<string, unknown>;
let userinfo: Record<string, unknown>;
let legacyAboutOk: boolean;

const get = (over: { query?: Record<string, string>; cookie?: string | null; url?: string } = {}) => {
  const url = new URL(over.url ?? CALLBACK);
  for (const [key, value] of Object.entries(over.query ?? { state: STATE, code: CODE })) url.searchParams.set(key, value);
  return GET(new NextRequest(url, { headers: over.cookie === null ? {} : { cookie: `${COOKIE}=${over.cookie ?? VERIFIER}` } }));
};
const statusOf = (response: Response) => new URL(response.headers.get("location")!).searchParams.get("status");
const googleCalls = () => calls.filter((call) => !call.url.includes("/about"));
const exchanges = () => calls.filter((call) => new URLSearchParams(String(call.init?.body)).get("grant_type") === "authorization_code");

beforeEach(() => {
  m.actor = { id: USER, tenantId: OTHER_T, systemRole: "master" }; m.allowed = true; m.moduleOn = true; m.audit.mockReset();
  // T = env의 기존 지점(연결 없는 ROOT — 아직 계정 소유를 등록하지 않았다) · OTHER_T = 지금 계정을 연결하려는 지점.
  db = withAccountSchema(createFakeDb({
    homework_video_drive_settings: [], classnote_video_folders: [],
    homework_video_drive_roots: [{ tenant_id: T, root_folder_id: ROOT, connection_id: null, legacy_auth_fingerprint: null }],
  }));
  consume = vi.fn<Rpc>(() => ({ expectedVersion: VERSION, oauthClientId: "web-client", intent: "switch" }));
  connect = vi.fn<Rpc>(() => ({ connectionId: CONN, version: "33333333-3333-4333-8333-333333333333" }));
  claim = vi.fn<Rpc>(() => null);
  db.defineRpc("consume_homework_video_drive_oauth_attempt", consume);
  db.defineRpc("connect_homework_video_drive_account", connect);
  db.defineRpc("claim_homework_video_drive_legacy_account", claim);
  m.db = db;
  for (const [key, value] of Object.entries({ ...ENV, ...WEB_ENV })) vi.stubEnv(key, value);
  _resetVideoDriveConfigForTest();
  calls = [];
  // 다른 계정이라고 주장하는 id_token을 끼워 둔다 — 읽히면 안 된다.
  const forged = `x.${Buffer.from(JSON.stringify({ sub: "attacker", email: "attacker@example.com", email_verified: true })).toString("base64url")}.x`;
  token = { access_token: "new-access", refresh_token: "new-refresh", scope: SCOPES, id_token: forged };
  userinfo = { sub: "sub-new", email: "branch@example.com", email_verified: true };
  legacyAboutOk = true;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const bearer = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
    if (url.includes("oauth2.googleapis.com/token"))
      return new URLSearchParams(String(init?.body)).get("grant_type") === "refresh_token" ? json({ access_token: "legacy-access", expires_in: 3600 }) : json(token);
    if (url.includes("userinfo")) return json(userinfo);
    if (url.includes("/about")) return bearer === "Bearer legacy-access" ? (legacyAboutOk ? json({ user: { permissionId: "perm-legacy" } }) : json({}, 500)) : json({ user: { permissionId: "perm-new" } });
    return json({}, 500);
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("돌아온 요청 — 시작한 그 사람·그 브라우저·그 지점만", () => {
  it("쿠키(검증값)가 없거나 state 모양이 틀리면 시도·Google을 건드리지 않고 끝낸다 · 쿠키는 언제나 지운다", async () => {
    for (const response of [await get({ cookie: null }), await get({ cookie: "short" }), await get({ query: { state: "bad", code: CODE } }), await get({ query: { code: CODE } })]) {
      expect(response.status).toBe(303);
      expect(statusOf(response)).toBe("expired");
      expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^${COOKIE}=;.*Max-Age=0`));
    }
    expect(consume).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
  });
  it("🔴 로그인이 풀렸으면 로그인 화면으로 넘기지 않는다 — 코드가 든 이 주소가 next=에 실리지 않는다 · 시도도 소비하지 않는다", async () => {
    m.actor = null;
    const response = await get();
    const location = response.headers.get("location")!;
    expect(location).toBe(`${WEB_ORIGIN}/api/integrations/homework-video-drive/done?status=session`);
    expect(location).not.toMatch(/login|next=|code|state/);
    expect(consume).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
  });
  it("그사이 권한을 잃었거나 기능이 꺼졌으면 소비하지 않고 끝낸다 · 정식 주소가 아닌 호스트로 온 요청도", async () => {
    m.allowed = false; expect(statusOf(await get())).toBe("forbidden");
    m.allowed = true; m.moduleOn = false; expect(statusOf(await get())).toBe("forbidden");
    m.moduleOn = true;
    expect(statusOf(await get({ url: "https://evil.example/api/integrations/homework-video-drive/callback" }))).toBe("origin");
    expect(consume).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
  });
  it("🔴 시도는 로그인한 지점·사용자 + state 해시 + 쿠키의 S256으로만 소비한다 — 안 맞으면(다른 사람·재사용·만료) Google에 코드를 내지 않는다", async () => {
    consume.mockReturnValueOnce(null);
    expect(statusOf(await get())).toBe("expired");
    expect(consume.mock.calls[0]![0]).toEqual({ p_tenant: OTHER_T, p_user: USER, p_state_hash: sha256Hex(STATE), p_challenge: pkceChallenge(VERIFIER) });
    expect(calls).toHaveLength(0); expect(connect).not.toHaveBeenCalled();
    // 같은 주소를 두 번 열면(다시 재생) 두 번째는 소비되지 않는다.
    consume.mockReturnValueOnce({ expectedVersion: VERSION, oauthClientId: "web-client", intent: "switch" }).mockReturnValueOnce(null);
    expect(statusOf(await get())).toBe("connected");
    expect(statusOf(await get())).toBe("expired");
    expect(connect).toHaveBeenCalledTimes(1); expect(exchanges()).toHaveLength(1);
  });
  it("Google에서 허용하지 않았거나 시작할 때의 앱이 지금 앱과 다르면 코드를 교환하지 않는다(시도는 이미 썼다)", async () => {
    expect(statusOf(await get({ query: { state: STATE, error: "access_denied" } }))).toBe("denied");
    consume.mockReturnValueOnce({ expectedVersion: null, oauthClientId: "another-client", intent: "switch" });
    expect(statusOf(await get())).toBe("failed");
    expect(consume).toHaveBeenCalledTimes(2); expect(calls).toHaveLength(0); expect(connect).not.toHaveBeenCalled();
  });
});

describe("연결 저장", () => {
  it("코드 교환 → UserInfo → Drive → 연결 저장. 깨끗한 주소로 옮기고(코드·state 없음) 갱신 토큰은 저장 함수에만 넘긴다", async () => {
    const response = await get();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${WEB_ORIGIN}/api/integrations/homework-video-drive/done?status=connected`);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toBe("");
    expect(Object.fromEntries(new URLSearchParams(String(exchanges()[0]!.init!.body)))).toMatchObject({ code: CODE, code_verifier: VERIFIER, redirect_uri: CALLBACK, client_secret: "web-secret" });
    // 🔴 계정은 UserInfo가 답한 값 — 끼워 둔 id_token의 계정이 아니다.
    expect(connect.mock.calls[0]![0]).toEqual({
      p_tenant: OTHER_T, p_expected_version: VERSION, p_google_subject: "sub-new", p_permission_id: "perm-new", p_email: "branch@example.com",
      p_oauth_client_id: "web-client", p_refresh_token: "new-refresh", p_intent: "switch",
    });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "integration_video_drive_account", metadata: { intent: "switch", email: "branch@example.com" } }));
    expect(JSON.stringify(m.audit.mock.calls)).not.toMatch(/new-refresh|new-access/);
  });
  it("새 계정을 받기 전에 기존 연결 계정의 소유를 등록한다 — 지문이 그대로면 다시 묻지 않고, 확인하지 못하면 새 계정을 받지 않는다", async () => {
    await get();
    expect(claim.mock.calls[0]![0]).toMatchObject({ p_tenant: T, p_root: ROOT, p_permission_id: "perm-legacy", p_auth_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(claim.mock.invocationCallOrder[0]!).toBeLessThan(connect.mock.invocationCallOrder[0]!);
    db.tables.homework_video_drive_roots![0]!.legacy_auth_fingerprint = (claim.mock.calls[0]![0] as { p_auth_fingerprint: string }).p_auth_fingerprint;
    calls = []; claim.mockClear();
    expect(statusOf(await get())).toBe("connected");
    expect(claim).not.toHaveBeenCalled();
    expect(calls.some((call) => new URLSearchParams(String(call.init?.body)).get("grant_type") === "refresh_token")).toBe(false);
    // 지문이 바뀌었는데(다른 계정일 수 있다) 확인이 안 되면 멈춘다.
    db.tables.homework_video_drive_roots![0]!.legacy_auth_fingerprint = "0".repeat(64);
    legacyAboutOk = false; connect.mockClear();
    expect(statusOf(await get())).toBe("legacy");
    expect(connect).not.toHaveBeenCalled();
  });
  it("'다시 연결'은 지금 연결된 그 계정일 때만 저장한다 — 다른 계정이면 아무것도 바꾸지 않는다", async () => {
    addConnection(db, OTHER_T, CONN, { google_subject: "sub-current" });
    db.tables.homework_video_drive_settings = [{ tenant_id: OTHER_T, enabled: true, root_folder_id: "R", connection_id: CONN, version: VERSION }];
    consume.mockReturnValue({ expectedVersion: VERSION, oauthClientId: "web-client", intent: "reconnect" });
    expect(statusOf(await get())).toBe("other_account");
    expect(connect).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
    userinfo = { ...userinfo, sub: "sub-current" };
    expect(statusOf(await get())).toBe("connected");
    expect(connect.mock.calls[0]![0]).toMatchObject({ p_intent: "reconnect", p_google_subject: "sub-current" });
  });
  it("갱신 토큰 없음·Drive 권한 빠짐·확인 안 된 이메일은 저장하지 않는다 · DB가 거절하면(다른 지점의 계정·바뀐 설정) 그대로 둔다", async () => {
    token = { ...token, refresh_token: undefined }; expect(statusOf(await get())).toBe("consent");
    token = { access_token: "new-access", refresh_token: "new-refresh", scope: "openid email" }; expect(statusOf(await get())).toBe("scope");
    token = { ...token, scope: SCOPES }; userinfo = { ...userinfo, email_verified: false }; expect(statusOf(await get())).toBe("identity");
    expect(connect).not.toHaveBeenCalled();
    userinfo = { ...userinfo, email_verified: true };
    connect.mockImplementationOnce(() => { throw Object.assign(new Error("이 Google 계정은 연결할 수 없습니다"), { code: "P0001" }); });
    expect(statusOf(await get())).toBe("rejected");
    connect.mockImplementationOnce(() => { throw Object.assign(new Error("boom"), { code: "57014" }); });
    expect(statusOf(await get())).toBe("failed");
    expect(m.audit).not.toHaveBeenCalled();
    expect(googleCalls().every((call) => call.url.startsWith("https://oauth2.googleapis.com/") || call.url.startsWith("https://openidconnect.googleapis.com/"))).toBe(true);
  });
});
