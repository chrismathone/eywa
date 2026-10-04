import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db.test-util";
import { ENV, OTHER_T, ROOT, T } from "./test-fixture.test-util";
import { CONN, CONN_B, WEB_ENV, addConnection, enableAccountRoot, withAccountSchema } from "./account-fixture.test-util";
import { lookupPinnedVideoDriveCredential, readPinnedVideoDriveCredential, readSelectedVideoDriveCredential, videoDriveForTenant } from "./drive-credentials";
import { _resetVideoDriveConfigForTest } from "./drive-config";
import { _resetVideoDriveTokensForTest, VideoDriveReauthError, VideoDriveTokenError } from "./drive-token";

const ACCOUNT_ROOT = "ACCOUNT_ROOT_0001";
type Db = Parameters<typeof readPinnedVideoDriveCredential>[0];
const typed = (db: unknown) => db as Db;
let db: FakeDb;
let tokenCalls: URLSearchParams[];
let tokenReply: (body: URLSearchParams) => Response;

beforeEach(() => {
  for (const [key, value] of Object.entries({ ...ENV, ...WEB_ENV })) vi.stubEnv(key, value);
  _resetVideoDriveConfigForTest(); _resetVideoDriveTokensForTest();
  // T = env에 적힌 기존 지점(연결 없는 폴더 ROOT) · OTHER_T = 자기 계정을 연결한 지점(ACCOUNT_ROOT ↔ CONN).
  db = withAccountSchema(createFakeDb({
    classnote_video_folders: [{ tenant_id: T, root_folder_id: ROOT }],
    homework_video_drive_roots: [{ tenant_id: T, root_folder_id: ROOT, connection_id: null }],
  }));
  addConnection(db, OTHER_T);
  enableAccountRoot(db, OTHER_T, ACCOUNT_ROOT);
  tokenCalls = [];
  tokenReply = (body) => new Response(JSON.stringify({ access_token: `access:${body.get("refresh_token")}`, expires_in: 3600 }));
  vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body));
    tokenCalls.push(body);
    return tokenReply(body);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const token = async (tenant: string, root: string, connection: string | null) => (await readPinnedVideoDriveCredential(typed(db), tenant, root, connection))?.accessToken();

describe("자격은 (지점, 저장 폴더, 연결)이 정확히 맞을 때만 나온다", () => {
  it("기존 폴더는 env의 기존 연결, 계정 폴더는 그 연결의 토큰 — 서로 다른 클라이언트·다른 갱신 토큰으로 받는다", async () => {
    expect(await token(T, ROOT, null)).toBe("access:refresh");
    expect(await token(OTHER_T, ACCOUNT_ROOT, CONN)).toBe("access:rt-aaaa");
    expect(tokenCalls.map((body) => [body.get("client_id"), body.get("client_secret"), body.get("refresh_token")])).toEqual([
      ["client", "secret", "refresh"], ["web-client", "web-secret", "rt-aaaa"],
    ]);
  });
  it("🔴 연결 자격을 기존 연결로, 기존 연결을 연결 자격으로 바꿔 읽지 않는다 — 어긋나면 null이고 Google을 부르지 않는다", async () => {
    expect(await readPinnedVideoDriveCredential(typed(db), OTHER_T, ACCOUNT_ROOT, null)).toBeNull(); // 계정 폴더를 연결 없이
    expect(await readPinnedVideoDriveCredential(typed(db), T, ROOT, CONN)).toBeNull(); // 기존 폴더를 남의 연결로
    expect(await readPinnedVideoDriveCredential(typed(db), OTHER_T, ACCOUNT_ROOT, CONN_B)).toBeNull(); // 다른 연결
    expect(await readPinnedVideoDriveCredential(typed(db), T, ACCOUNT_ROOT, CONN)).toBeNull(); // 남의 지점 폴더·연결
    expect(await readPinnedVideoDriveCredential(typed(db), OTHER_T, ROOT, null)).toBeNull(); // 남의 지점 기존 폴더
    expect(await readPinnedVideoDriveCredential(typed(db), OTHER_T, ACCOUNT_ROOT, "not-a-uuid")).toBeNull();
    expect(tokenCalls).toHaveLength(0);
  });
  it("🔴 env에 적힌 지점이 아니면 기존 연결을 쓰지 못한다 — 연결 없는 폴더를 가진 다른 지점도 env 자격을 받지 않는다", async () => {
    db.tables.homework_video_drive_roots!.push({ tenant_id: OTHER_T, root_folder_id: "SHARED_STYLE_ROOT_1", connection_id: null });
    expect(await lookupPinnedVideoDriveCredential(typed(db), OTHER_T, "SHARED_STYLE_ROOT_1", null)).toEqual({ ok: false, reason: "mismatch" });
    expect(tokenCalls).toHaveLength(0);
  });
  it("해제하거나 계정을 바꾼 뒤에도 각인된 쌍의 자격은 그대로 나온다(지금 고른 계정으로 바뀌지 않는다)", async () => {
    addConnection(db, OTHER_T, CONN_B);
    db.tables.homework_video_drive_settings = [{ tenant_id: OTHER_T, enabled: false, root_folder_id: null, connection_id: CONN_B, version: "v" }];
    expect(await token(OTHER_T, ACCOUNT_ROOT, CONN)).toBe("access:rt-aaaa");
    db.tables.homework_video_drive_settings = [{ tenant_id: OTHER_T, enabled: false, root_folder_id: null, connection_id: null, version: "v" }];
    expect(await token(OTHER_T, ACCOUNT_ROOT, CONN)).toBe("access:rt-aaaa");
    expect(await token(T, ROOT, null)).toBe("access:refresh");
  });
  it("조회 오류는 '없음'으로 삼키지 않고 던진다 — 다른 자격으로 넘어가지 않는다", async () => {
    db.defineRpc("read_homework_video_drive_credential", () => { throw Object.assign(new Error("boom"), { code: "57014" }); });
    await expect(readPinnedVideoDriveCredential(typed(db), T, ROOT, null)).rejects.toThrow();
    await expect(readPinnedVideoDriveCredential(typed(db), OTHER_T, ACCOUNT_ROOT, CONN)).rejects.toThrow();
    expect(tokenCalls).toHaveLength(0);
  });
  it("계정 SQL 전(함수 없음)에는 기존 폴더만 옛 소유 판정으로 받고, 연결 각인은 받지 않는다", async () => {
    const old = createFakeDb({ classnote_video_folders: [{ tenant_id: T, root_folder_id: ROOT }], homework_video_drive_roots: [{ tenant_id: T, root_folder_id: ROOT }] });
    expect((await readPinnedVideoDriveCredential(typed(old), T, ROOT, null))?.kind).toBe("legacy");
    expect(await readPinnedVideoDriveCredential(typed(old), T, ROOT, CONN)).toBeNull();
    expect(await readPinnedVideoDriveCredential(typed(old), OTHER_T, ROOT, null)).toBeNull();
  });
});

describe("토큰 — 다시 연결·취소·앱 설정", () => {
  it("같은 연결·같은 토큰 번호는 캐시, 다시 연결하면(번호 +1) 새 갱신 토큰으로 다시 받는다 · 계정이 다르면 섞이지 않는다", async () => {
    expect(await token(OTHER_T, ACCOUNT_ROOT, CONN)).toBe("access:rt-aaaa");
    expect(await token(OTHER_T, ACCOUNT_ROOT, CONN)).toBe("access:rt-aaaa");
    expect(tokenCalls).toHaveLength(1);
    Object.assign(db.tables.homework_video_drive_connections![0]!, { token_version: 2, refresh_token: "rt-new" });
    expect(await token(OTHER_T, ACCOUNT_ROOT, CONN)).toBe("access:rt-new");
    expect(tokenCalls).toHaveLength(2);
  });
  it("Google이 허락을 거절하면(invalid_grant) 그 토큰 번호로 '다시 연결 필요'를 표시하고 던진다 — 기존 연결로 넘어가지 않는다", async () => {
    tokenReply = () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 });
    const credential = (await readPinnedVideoDriveCredential(typed(db), OTHER_T, ACCOUNT_ROOT, CONN))!;
    const error = await credential.accessToken().catch((thrown: Error) => thrown);
    expect(error).toBeInstanceOf(VideoDriveReauthError);
    expect(String((error as Error).message)).not.toMatch(/rt-aaaa|web-secret|revoked/);
    expect(db.tables.homework_video_drive_connections![0]!.status).toBe("needs_reauth");
    expect(db.rpcCalls.filter((call) => call.name === "mark_homework_video_drive_needs_reauth")).toEqual([
      { name: "mark_homework_video_drive_needs_reauth", args: { p_tenant: OTHER_T, p_connection: CONN, p_token_version: 1 } },
    ]);
    expect(tokenCalls.every((body) => body.get("refresh_token") === "rt-aaaa")).toBe(true);
  });
  it("일시 오류(5xx)는 '다시 연결 필요'로 표시하지 않는다", async () => {
    tokenReply = () => new Response(JSON.stringify({ error: "backend_error" }), { status: 503 });
    const credential = (await readPinnedVideoDriveCredential(typed(db), OTHER_T, ACCOUNT_ROOT, CONN))!;
    await expect(credential.accessToken()).rejects.toBeInstanceOf(VideoDriveTokenError);
    expect(db.tables.homework_video_drive_connections![0]!.status).toBe("ready");
  });
  it("🔴 그 연결을 발급한 앱의 비밀이 서버에 없으면 갱신하지 않는다 · 예전 앱은 선택 env 한 쌍으로 이어 쓴다", async () => {
    db.tables.homework_video_drive_connections![0]!.oauth_client_id = "old-web-client";
    expect(await lookupPinnedVideoDriveCredential(typed(db), OTHER_T, ACCOUNT_ROOT, CONN)).toEqual({ ok: false, reason: "client" });
    expect(tokenCalls).toHaveLength(0);
    vi.stubEnv("HOMEWORK_VIDEO_GOOGLE_PREVIOUS_CLIENT_ID", "old-web-client");
    vi.stubEnv("HOMEWORK_VIDEO_GOOGLE_PREVIOUS_CLIENT_SECRET", "old-web-secret");
    expect(await token(OTHER_T, ACCOUNT_ROOT, CONN)).toBe("access:rt-aaaa");
    expect([tokenCalls[0]!.get("client_id"), tokenCalls[0]!.get("client_secret")]).toEqual(["old-web-client", "old-web-secret"]);
  });
  it("자격 객체를 통째로 직렬화해도 갱신 토큰·비밀이 나오지 않는다", async () => {
    const credential = await readPinnedVideoDriveCredential(typed(db), OTHER_T, ACCOUNT_ROOT, CONN);
    expect(JSON.stringify(credential)).not.toMatch(/rt-aaaa|web-secret/);
  });
});

describe("새 업로드가 쓸 저장 폴더", () => {
  it("켜진 설정의 폴더·연결을 그대로 준다 · 다시 연결이 필요하면 받지 않는다 · 폴더만 고른 연결은 다른 지점 것을 읽지 못한다", async () => {
    expect(await videoDriveForTenant(OTHER_T, typed(db))).toMatchObject({ ok: true, drive: { tenantId: OTHER_T, rootId: ACCOUNT_ROOT, connectionId: CONN, tokenVersion: 1 } });
    expect(await videoDriveForTenant(T, typed(db))).toMatchObject({ ok: true, drive: { rootId: ROOT, connectionId: null, tokenVersion: null } });
    db.tables.homework_video_drive_connections![0]!.status = "needs_reauth";
    expect(await videoDriveForTenant(OTHER_T, typed(db))).toEqual({ ok: false, reason: "reauth" });
    expect(await readSelectedVideoDriveCredential(typed(db), T, CONN)).toBeNull(); // 남의 지점 연결
    expect((await readSelectedVideoDriveCredential(typed(db), OTHER_T, CONN))?.connectionId).toBe(CONN);
  });
  it("계정은 골랐고 폴더는 아직이면 '잠시 못 받음'(setup_pending) — 해제했거나 폴더가 적힌 채 꺼 둔 설정은 '폴더 없음'(no_config) 그대로", async () => {
    const version = "12121212-1212-4121-8121-121212121212";
    const set = (row: Record<string, unknown>) => { db.tables.homework_video_drive_settings = [{ tenant_id: OTHER_T, version, ...row }]; };
    set({ enabled: false, root_folder_id: null, connection_id: CONN }); // 계정을 연결·바꾼 직후
    expect(await videoDriveForTenant(OTHER_T, typed(db))).toEqual({ ok: false, reason: "setup_pending" });
    set({ enabled: false, root_folder_id: null, connection_id: null }); // 연결 해제
    expect(await videoDriveForTenant(OTHER_T, typed(db))).toEqual({ ok: false, reason: "no_config" });
    set({ enabled: false, root_folder_id: ACCOUNT_ROOT, connection_id: CONN }); // 폴더가 적힌 채 꺼 둠
    expect(await videoDriveForTenant(OTHER_T, typed(db))).toEqual({ ok: false, reason: "no_config" });
    db.tables.homework_video_drive_settings = []; // 설정 행이 없는 지점
    expect(await videoDriveForTenant(OTHER_T, typed(db))).toEqual({ ok: false, reason: "no_config" });
    expect(tokenCalls).toHaveLength(0);
  });
});
