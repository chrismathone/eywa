// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
import { OTHER_T, T, settings } from "@/features/video-submit/server/test-fixture.test-util";
import { CONN, WEB_ENV, WEB_ORIGIN, addConnection, withAccountSchema } from "@/features/video-submit/server/account-fixture.test-util";

const m = vi.hoisted(() => ({ db: null as unknown, actor: null as unknown, allowed: true, moduleOn: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => m.allowed }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => settings() }));
vi.mock("@/features/owner/classnote-gate", () => ({ classnoteModuleOn: () => m.moduleOn }));

import { POST } from "./route";
import { pkceChallenge, sha256Hex } from "@/features/video-submit/server/oauth/google-flow";

const START = `${WEB_ORIGIN}/api/integrations/homework-video-drive/start`;
const VERSION = "12121212-1212-4121-8121-121212121212";
const USER = "22222222-2222-4222-8222-222222222222";
type Rpc = (args: Record<string, unknown>) => unknown;
let db: FakeDb;
let created: Mock<Rpc>;

function post(over: { origin?: string | null; url?: string; fields?: Record<string, string>; site?: string } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ intent: "switch", version: VERSION, ...over.fields })) form.set(key, value);
  const headers: Record<string, string> = {};
  if (over.origin !== null) headers.origin = over.origin ?? WEB_ORIGIN;
  if (over.site) headers["sec-fetch-site"] = over.site;
  return POST(new Request(over.url ?? START, { method: "POST", headers, body: form }));
}
const args = () => created.mock.calls[0]![0] as Record<string, unknown>;
const cookieOf = (response: Response) => response.headers.get("set-cookie") ?? "";

beforeEach(() => {
  m.actor = { id: USER, tenantId: T, systemRole: "master" }; m.allowed = true; m.moduleOn = true;
  db = withAccountSchema(createFakeDb({ homework_video_drive_settings: [], homework_video_drive_roots: [], classnote_video_folders: [] }));
  created = vi.fn<Rpc>(() => null);
  db.defineRpc("create_homework_video_drive_oauth_attempt", created);
  m.db = db;
  for (const [key, value] of Object.entries(WEB_ENV)) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

describe("Google 계정 연결 시작 — 누가 시작할 수 있나", () => {
  it("🔴 다른 사이트에서 온 POST·출처 없는 POST·정식 주소가 아닌 호스트는 거절한다(시도를 만들지 않는다)", async () => {
    for (const response of [
      await post({ origin: "https://evil.example" }), await post({ origin: null }), await post({ site: "cross-site" }),
      await post({ url: "https://aywa-preview.vercel.app/api/integrations/homework-video-drive/start" }),
    ]) {
      expect(response.status).toBe(403);
      expect(response.headers.get("location")).toBeNull();
      expect(cookieOf(response)).toBe("");
    }
    expect(created).not.toHaveBeenCalled();
  });
  it("🔴 로그인이 없으면 로그인 화면으로 넘기지 않고 그 자리에서 끝낸다 · 권한이 없거나 기능이 꺼져 있어도 시작하지 않는다", async () => {
    m.actor = null;
    const anonymous = await post();
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("location")).toBeNull();
    expect(await anonymous.text()).toContain("로그인이 필요합니다");
    m.actor = { id: USER, tenantId: T, systemRole: "teacher" }; m.allowed = false;
    expect((await post()).status).toBe(403);
    m.allowed = true; m.moduleOn = false;
    expect((await post()).status).toBe(403);
    expect(created).not.toHaveBeenCalled();
  });
  it("앱 설정이 없으면 준비 중 화면 · 의도·버전 모양이 틀리면 거절", async () => {
    expect((await post({ fields: { intent: "takeover" } })).status).toBe(400);
    expect((await post({ fields: { version: "not-a-uuid" } })).status).toBe(400);
    vi.stubEnv("HOMEWORK_VIDEO_GOOGLE_CLIENT_SECRET", "");
    const pending = await post();
    expect(pending.status).toBe(503);
    expect(await pending.text()).toContain("준비 중");
    expect(created).not.toHaveBeenCalled();
  });
});

describe("Google 계정 연결 시작 — 무엇을 만들고 어디로 보내나", () => {
  it("Google로 보내고(303), 검증값은 httpOnly 쿠키에만, DB에는 해시만 — 지점·사용자는 로그인한 계정에서만 정한다", async () => {
    const response = await post({ fields: { tenant_id: OTHER_T, tenant: OTHER_T, user_id: "someone-else", email: "attacker@example.com" } });
    expect(response.status).toBe(303);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(WEB_ENV.HOMEWORK_VIDEO_GOOGLE_REDIRECT_URI);
    expect(location.searchParams.has("login_hint")).toBe(false);
    const state = location.searchParams.get("state")!;
    const cookie = cookieOf(response);
    const verifier = /^__Secure-aywa-video-drive-oauth=([A-Za-z0-9_-]{64});/.exec(cookie)?.[1] ?? "";
    expect(verifier).not.toBe("");
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/Secure/i); expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\/api\/integrations\/homework-video-drive/); expect(cookie).toMatch(/Max-Age=600/);
    expect(location.searchParams.get("code_challenge")).toBe(pkceChallenge(verifier));
    expect(location.toString()).not.toContain(verifier);
    expect(args()).toEqual({
      p_tenant: T, p_user: USER, p_state_hash: sha256Hex(state), p_challenge: pkceChallenge(verifier),
      p_expected_version: VERSION, p_oauth_client_id: "web-client", p_intent: "switch",
    });
    expect(JSON.stringify(args())).not.toContain(state); expect(JSON.stringify(args())).not.toContain(verifier);
  });
  it("'다시 연결'은 지금 연결된 계정으로 로그인하도록 이끈다(화면이 보낸 이메일이 아니라 DB의 계정) · 버전이 없으면 null", async () => {
    addConnection(db, T);
    db.tables.homework_video_drive_settings = [{ tenant_id: T, enabled: false, root_folder_id: null, connection_id: CONN, version: VERSION }];
    const response = await post({ fields: { intent: "reconnect", version: "", email: "attacker@example.com" } });
    expect(new URL(response.headers.get("location")!).searchParams.get("login_hint")).toBe("aaaa@example.com");
    expect(args()).toMatchObject({ p_intent: "reconnect", p_expected_version: null });
  });
  it("DB가 거절하면(그사이 설정이 바뀜·다시 연결할 계정이 없음) Google로 보내지 않고 쿠키도 굽지 않는다", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    created.mockImplementationOnce(() => { throw Object.assign(new Error("다른 화면에서 설정이 변경되었습니다"), { code: "P0001" }); });
    const stale = await post();
    expect(stale.status).toBe(409);
    expect(stale.headers.get("location")).toBeNull(); expect(cookieOf(stale)).toBe("");
    expect(await stale.text()).toContain("새로고침");
    created.mockImplementationOnce(() => { throw Object.assign(new Error("boom"), { code: "57014" }); });
    const failed = await post();
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain("boom");
    errors.mockRestore();
  });
});
