import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
import { ENV, OTHER_T, ROOT, T, settings } from "@/features/video-submit/server/test-fixture.test-util";
import { CONN, CONN_B, WEB_ENV, addConnection, enableAccountRoot, withAccountSchema } from "@/features/video-submit/server/account-fixture.test-util";

const m = vi.hoisted(() => ({ db: null as unknown, settings: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async () => m.settings }));

import { POST } from "./route";
import { _resetVideoDriveConfigForTest } from "@/features/video-submit/server/drive-config";
import { _resetVideoDriveTokensForTest } from "@/features/video-submit/server/drive-token";

const SECRET = "internal-secret-value";
const ACCOUNT_ROOT = "ACCOUNT_ROOT_0001";
const HOST = "SEND-PC-01";
const NOW = Date.parse("2026-10-04T12:00:00Z");
let db: FakeDb;
let google: ReturnType<typeof vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>>;
let tokenReply: (body: URLSearchParams) => Response;

const body = (over: Record<string, unknown> = {}) => ({ tenantId: OTHER_T, rootId: ACCOUNT_ROOT, connectionId: CONN, hostname: HOST, ...over });
const call = (payload: unknown, secret: string | null = SECRET) => POST(new Request("https://www.aywa.co.kr/api/internal/video-drive-token", {
  method: "POST", headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-eywa-internal": secret }) }, body: JSON.stringify(payload),
}));
const worker = (over: Record<string, unknown> = {}, seenAgoMs = 30_000) => ({
  tenant_id: OTHER_T, hostname: HOST, last_seen: new Date(NOW - seenAgoMs).toISOString(),
  last_results: { postMode: true, caps: { homeworkVideoTenantAccounts: true } }, ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const [key, value] of Object.entries({ ...ENV, ...WEB_ENV, CLASSNOTE_INTERNAL_SECRET: SECRET })) vi.stubEnv(key, value);
  _resetVideoDriveConfigForTest(); _resetVideoDriveTokensForTest();
  // T = env의 기존 지점(연결 없는 ROOT) · OTHER_T = 계정을 연결한 지점(ACCOUNT_ROOT ↔ CONN) + 살아 있는 새 발송 PC.
  db = withAccountSchema(createFakeDb({
    classnote_video_folders: [{ tenant_id: T, root_folder_id: ROOT }],
    homework_video_drive_roots: [{ tenant_id: T, root_folder_id: ROOT, connection_id: null }],
    classnote_workers: [worker()],
  }));
  addConnection(db, OTHER_T);
  enableAccountRoot(db, OTHER_T, ACCOUNT_ROOT);
  m.db = db;
  m.settings = settings();
  tokenReply = (form) => new Response(JSON.stringify({ access_token: `access:${form.get("refresh_token")}`, expires_in: 3599 }));
  google = vi.fn(async (_input, init) => tokenReply(new URLSearchParams(String(init?.body))));
  vi.stubGlobal("fetch", google);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("발송 PC용 토큰 API — 누구에게 주나", () => {
  it("시크릿이 없거나 틀리면 401 — DB도 Google도 보지 않는다 · 서버에 시크릿이 없어도 열리지 않는다", async () => {
    expect((await call(body(), null)).status).toBe(401);
    expect((await call(body(), "wrong")).status).toBe(401);
    vi.stubEnv("CLASSNOTE_INTERNAL_SECRET", "");
    expect((await call(body(), "")).status).toBe(401);
    expect(db.rpcCalls).toHaveLength(0); expect(google).not.toHaveBeenCalled();
  });
  it("🔴 세 값(지점·저장 폴더·연결)이 안 맞으면 403 — Google을 부르기 전에 막는다", async () => {
    db.tables.classnote_workers!.push(worker({ tenant_id: T }));
    for (const bad of [
      body({ tenantId: T }), // 남의 지점이 이 지점의 폴더·연결을 달라고 한다
      body({ connectionId: CONN_B }), body({ rootId: "SOME_OTHER_ROOT_1" }),
      body({ tenantId: T, rootId: ROOT }), // 기존 폴더(연결 없음)를 연결 번호로
      body({ connectionId: null }), body({ connectionId: "x" }), body({ rootId: "../x" }), body({ tenantId: "t" }), body({ hostname: "" }), null, "text",
    ]) {
      const response = await call(bad);
      expect(response.status, JSON.stringify(bad)).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    expect(google).not.toHaveBeenCalled();
  });
  it("그 지점의 그 PC가 최근 180초 안에 발송 모드로 살아 있고 계정별 저장을 아는 버전일 때만 준다", async () => {
    for (const row of [
      worker({}, 181_000), worker({ hostname: "OTHER-PC" }), worker({ tenant_id: T }),
      worker({ last_results: { postMode: false, caps: { homeworkVideoTenantAccounts: true } } }),
      worker({ last_results: { postMode: true, caps: { homeworkVideoTenantFolders: true } } }), worker({ last_results: null }),
    ]) {
      db.tables.classnote_workers = [row];
      expect((await call(body())).status).toBe(403);
    }
    db.tables.classnote_workers = [];
    expect((await call(body())).status).toBe(403);
    m.settings = { ...settings(), modules: { disabled: ["classnote"] } };
    db.tables.classnote_workers = [worker()];
    expect((await call(body())).status).toBe(403);
    expect(google).not.toHaveBeenCalled();
  });
});

describe("발송 PC용 토큰 API — 무엇을 주나", () => {
  it("접근 토큰과 실제 남은 수명만 준다(최대 3300초) — 갱신 토큰·앱 비밀·이메일은 없다 · 캐시하지 않는다", async () => {
    tokenReply = () => new Response(JSON.stringify({ access_token: "ya29.opaque-access", expires_in: 3599, refresh_token: "must-not-leak", id_token: "must-not-leak" }));
    const response = await call(body());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const json = await response.json();
    expect(json).toEqual({ accessToken: "ya29.opaque-access", expiresIn: 3300, connectionId: CONN, tokenVersion: 1 });
    expect(JSON.stringify(json)).not.toMatch(/rt-aaaa|web-secret|example\.com|must-not-leak/);
    const sent = new URLSearchParams(String(google.mock.calls[0]![1]!.body));
    expect([sent.get("client_id"), sent.get("client_secret"), sent.get("refresh_token")]).toEqual(["web-client", "web-secret", "rt-aaaa"]);
  });
  it("🔴 캐시된 토큰을 줄 때는 **그 토큰의 남은 수명**을 적는다(고정값 아님) · 10분 아래로 남았으면 새로 받는다", async () => {
    await call(body());
    vi.setSystemTime(NOW + 40 * 60_000);
    db.tables.classnote_workers = [worker({ last_seen: new Date(NOW + 40 * 60_000 - 5_000).toISOString() })];
    expect(await (await call(body())).json()).toMatchObject({ accessToken: "access:rt-aaaa", expiresIn: 3599 - 2400 - 120 });
    expect(google).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 51 * 60_000);
    db.tables.classnote_workers = [worker({ last_seen: new Date(NOW + 51 * 60_000 - 5_000).toISOString() })];
    expect(await (await call(body())).json()).toMatchObject({ expiresIn: 3300 });
    expect(google).toHaveBeenCalledTimes(2);
  });
  it("계정을 바꾸거나 해제한 뒤에도 옛 작업의 각인된 쌍에는 준다 — 지금 고른 계정의 토큰으로 바꿔 주지 않는다", async () => {
    addConnection(db, OTHER_T, CONN_B);
    enableAccountRoot(db, OTHER_T, "SECOND_ACCOUNT_ROOT", CONN_B); // 지금 고른 계정 = CONN_B
    expect(await (await call(body())).json()).toMatchObject({ accessToken: "access:rt-aaaa", connectionId: CONN });
    expect(await (await call(body({ rootId: "SECOND_ACCOUNT_ROOT", connectionId: CONN_B }))).json()).toMatchObject({ accessToken: "access:rt-bbbb", connectionId: CONN_B });
    db.tables.homework_video_drive_settings = [{ tenant_id: OTHER_T, enabled: false, root_folder_id: null, connection_id: null, version: "v" }];
    expect((await call(body())).status).toBe(200);
  });
  it("다시 연결하면(토큰 번호 +1) 새 갱신 토큰으로 받은 토큰과 새 번호를 준다", async () => {
    await call(body());
    Object.assign(db.tables.homework_video_drive_connections![0]!, { token_version: 2, refresh_token: "rt-new" });
    expect(await (await call(body())).json()).toMatchObject({ accessToken: "access:rt-new", tokenVersion: 2 });
  });
  it("Google이 허락을 거절하면 409 reauth + '다시 연결 필요' 표시 · 일시 장애는 503 · 응답에 사유 원문이 없다", async () => {
    tokenReply = () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 });
    const denied = await call(body());
    expect(denied.status).toBe(409);
    expect(await denied.json()).toEqual({ code: "reauth" });
    expect(db.tables.homework_video_drive_connections![0]!.status).toBe("needs_reauth");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    tokenReply = () => new Response(JSON.stringify({ error: "backend_error" }), { status: 500 });
    const down = await call(body());
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: "unavailable" });
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/rt-aaaa|web-secret|backend_error/);
    errors.mockRestore();
  });
  it("그 연결을 발급한 앱의 설정이 서버에 없으면 503(다른 앱의 비밀로 갱신하지 않는다) · 자격 조회 오류도 503", async () => {
    db.tables.homework_video_drive_connections![0]!.oauth_client_id = "old-web-client";
    expect((await call(body())).status).toBe(503);
    expect(google).not.toHaveBeenCalled();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    db.defineRpc("read_homework_video_drive_credential", () => { throw Object.assign(new Error("boom"), { code: "57014" }); });
    expect((await call(body())).status).toBe(503);
    errors.mockRestore();
  });
});
