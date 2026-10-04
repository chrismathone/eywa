import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db.test-util";
import { ENV, OTHER_T, ROOT, T, settings } from "./test-fixture.test-util";
import { CONN, CONN_B, WEB_ENV, addConnection, bearerOf, withAccountSchema } from "./account-fixture.test-util";

const m = vi.hoisted(() => ({ db: null as unknown, actor: null as unknown, allowed: true, moduleOn: true, audit: vi.fn(), asked: [] as string[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => true, canWriteTenant: async (_role: string, menu: string) => { m.asked.push(menu); return m.allowed; } }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => settings() }));
vi.mock("@/features/owner/classnote-gate", () => ({ classnoteModuleOn: () => m.moduleOn }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveVideoDriveSetting } from "./drive-settings-actions";
import { _resetVideoDriveConfigForTest } from "./drive-config";
import { _resetVideoDriveTokensForTest } from "./drive-token";

const NEW_ROOT = "NEW_TENANT_ROOT_123";
const VERSION = "12121212-1212-4121-8121-121212121212";
const FOLDER = "application/vnd.google-apps.folder";
/** 계정 연결의 접근 토큰(가짜 토큰 서버가 갱신 토큰으로 만든다) · 기존 env 연결의 접근 토큰. */
const ACCOUNT_TOKEN = "access:rt-aaaa";
const LEGACY_TOKEN = "access";
type Rpc = (args: Record<string, unknown>) => unknown;
let db: FakeDb;
let save: Mock<Rpc>;
let calls: { url: string; init?: RequestInit }[];
/** 폴더 번호 → 부모(없으면 맨 위). 없는 번호는 404. 내 드라이브 맨 위는 계정마다 다르다. */
let folders: Record<string, string[]>;

function form(intent = "save", root = NEW_ROOT, version = VERSION) {
  const data = new FormData();
  data.set("intent", intent); data.set("folder", root); data.set("version", version); data.set("tenant_id", OTHER_T);
  return data;
}
const savedArgs = () => save.mock.calls[0]![0] as { p_tenant: string; p_connection: string | null; p_root: string | null; p_enabled: boolean; p_expected_version: string | null; p_verified_roots: Record<string, unknown>[] };

beforeEach(() => {
  m.actor = { id: "staff", tenantId: T, systemRole: "master" }; m.allowed = true; m.moduleOn = true; m.asked = [];
  m.audit.mockReset();
  db = withAccountSchema(createFakeDb({
    classnote_video_folders: [{ tenant_id: T, root_folder_id: ROOT }],
    homework_video_drive_roots: [{ tenant_id: T, root_folder_id: ROOT, connection_id: null, ancestry_verified: true, chain_complete: true }],
    homework_video_drive_settings: [{ tenant_id: T, enabled: false, root_folder_id: null, connection_id: CONN, version: VERSION }],
    classnote_workers: [],
  }));
  addConnection(db, T);
  save = vi.fn<Rpc>(() => "33333333-3333-4333-8333-333333333333");
  db.defineRpc("save_homework_video_drive_account_setting", save);
  m.db = db;
  for (const [key, value] of Object.entries({ ...ENV, ...WEB_ENV })) vi.stubEnv(key, value);
  _resetVideoDriveConfigForTest(); _resetVideoDriveTokensForTest();
  calls = [];
  folders = { [NEW_ROOT]: ["MY_DRIVE_ROOT_1"], MY_DRIVE_ROOT_1: [], [ROOT]: ["LEGACY_TOP_0001"], LEGACY_TOP_0001: [] };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("oauth2.googleapis.com")) {
      const refresh = new URLSearchParams(String(init?.body)).get("refresh_token");
      return new Response(JSON.stringify({ access_token: refresh === "refresh" ? LEGACY_TOKEN : `access:${refresh}`, expires_in: 3600 }));
    }
    if (url.includes("/files/root?")) return new Response(JSON.stringify({ id: bearerOf({ init }) === LEGACY_TOKEN ? "LEGACY_TOP_0001" : "MY_DRIVE_ROOT_1" }));
    if (url.includes("/files?")) return new Response(JSON.stringify({ files: [] }));
    const id = /\/files\/([A-Za-z0-9_-]+)\?/.exec(url)?.[1] ?? "";
    if (!folders[id]) return new Response("", { status: 404 });
    return new Response(JSON.stringify({ id, name: "지점 영상", mimeType: FOLDER, capabilities: { canAddChildren: true }, parents: folders[id] }));
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const driveCalls = () => calls.filter((call) => call.url.includes("/drive/v3/"));

describe("저장 폴더 저장 — 권한·준비 상태", () => {
  it("편집권한 없이 직접 호출하거나 기능이 꺼지면 외부조회/쓰기 없이 거절한다", async () => {
    m.allowed = false; expect(await saveVideoDriveSetting(undefined, form())).toHaveProperty("error");
    m.allowed = true; m.moduleOn = false; expect(await saveVideoDriveSetting(undefined, form())).toHaveProperty("error");
    expect(save).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
    expect(m.asked).toEqual(["integration_settings", "integration_settings"]);
  });
  it("계정 연결 SQL 전(표 없음·폴더 표만 있음)에는 저장을 받지 않는다 — 기존 연결로 폴더를 등록하는 길이 없다", async () => {
    db.dropColumn("homework_video_drive_settings", "connection_id");
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ error: expect.stringContaining("준비 중") });
    db.dropTable("homework_video_drive_settings");
    expect(await saveVideoDriveSetting(undefined, form("save", NEW_ROOT, ""))).toMatchObject({ error: expect.stringContaining("준비 중") });
    expect(save).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
  });
  it("오래된 화면은 Drive 조회 이전에 거절한다", async () => {
    expect(await saveVideoDriveSetting(undefined, form("save", NEW_ROOT, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"))).toMatchObject({ error: expect.stringContaining("변경") });
    expect(save).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
  });
  it("🔴 Google 계정을 연결하지 않았거나 다시 연결해야 하면 폴더를 정할 수 없다 — 기존 env 연결로 대신 확인하지 않는다", async () => {
    db.tables.homework_video_drive_settings![0]!.connection_id = null;
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ error: expect.stringContaining("Google 계정을 먼저 연결") });
    db.tables.homework_video_drive_settings![0]!.connection_id = CONN;
    db.tables.homework_video_drive_connections![0]!.status = "needs_reauth";
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ error: expect.stringContaining("다시 연결") });
    expect(save).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
  });
  it("계정별 저장을 모르는 옛 발송 PC가 켜져 있으면 막는다(폴더별 저장만 아는 PC도 옛 PC다)", async () => {
    db.tables.classnote_workers = [{ tenant_id: T, last_seen: new Date().toISOString(), last_results: { postMode: true, caps: { homeworkVideoTenantFolders: true } } }];
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ error: expect.stringContaining("업데이트") });
    expect(save).not.toHaveBeenCalled(); expect(driveCalls()).toHaveLength(0);
    db.tables.classnote_workers[0]!.last_results = { postMode: true, caps: { homeworkVideoTenantAccounts: true } };
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ ok: true });
  });
});

describe("저장 폴더 저장 — 연결한 계정으로 확인한다", () => {
  it("브라우저의 지점값을 무시하고 로그인한 지점·고른 연결로 저장한다 · 폴더는 그 계정의 토큰으로만 읽는다", async () => {
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ ok: true });
    expect(savedArgs()).toMatchObject({ p_tenant: T, p_connection: CONN, p_root: NEW_ROOT, p_enabled: true, p_expected_version: VERSION });
    expect(savedArgs().p_verified_roots).toEqual([{ tenantId: T, rootId: NEW_ROOT, connectionId: CONN, folderName: "지점 영상", ancestorIds: [NEW_ROOT, "MY_DRIVE_ROOT_1"], chainComplete: true }]);
    expect(driveCalls().length).toBeGreaterThan(0);
    expect(driveCalls().every((call) => bearerOf(call) === ACCOUNT_TOKEN)).toBe(true);
    expect(calls.every((call) => !call.init?.method || call.url.includes("oauth2.googleapis.com"))).toBe(true); // Drive에는 읽기뿐
    expect(m.audit).toHaveBeenCalled();
  });
  it("🔴 다른 계정이 공유해 준 폴더(위가 안 보이는 폴더)는 받지 않는다", async () => {
    folders[NEW_ROOT] = [];
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ error: expect.stringContaining("내 드라이브") });
    expect(save).not.toHaveBeenCalled();
  });
  it("🔴 다른 지점의 폴더·다른 연결에 묶인 폴더(기존 연결의 폴더 포함)는 Google 조회 전에 막는다 — 폴더를 다른 계정으로 옮겨 붙이지 않는다", async () => {
    db.tables.homework_video_drive_roots!.push({ tenant_id: OTHER_T, root_folder_id: NEW_ROOT, connection_id: CONN_B, ancestry_verified: true, chain_complete: true });
    expect(await saveVideoDriveSetting(undefined, form())).toHaveProperty("error");
    expect(await saveVideoDriveSetting(undefined, form("save", ROOT))).toHaveProperty("error"); // 이 지점의 기존 폴더(연결 없음)
    expect(save).not.toHaveBeenCalled(); expect(driveCalls()).toHaveLength(0);
  });
  it("같은 지점·같은 연결로 쓰던 폴더는 비어 있지 않아도 다시 정할 수 있다 · 접근이 안 되면 거절한다", async () => {
    db.tables.homework_video_drive_roots!.push({ tenant_id: T, root_folder_id: NEW_ROOT, connection_id: CONN, ancestry_verified: true, chain_complete: true });
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ ok: true });
    expect(calls.some((call) => call.url.includes("/files?"))).toBe(false); // 빈 폴더 확인을 하지 않았다
    delete folders[NEW_ROOT];
    save.mockClear();
    expect(await saveVideoDriveSetting(undefined, form())).toHaveProperty("error");
    expect(save).not.toHaveBeenCalled();
  });
  it("🔴 경로를 확인한 적 없는 기존 폴더는 **그 폴더의 기존 연결 토큰으로** 확인해 함께 넘긴다 — 지금 고른 계정으로 읽지 않는다", async () => {
    db.tables.homework_video_drive_roots![0]!.ancestry_verified = false;
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ ok: true });
    expect(savedArgs().p_verified_roots).toContainEqual({ tenantId: T, rootId: ROOT, connectionId: null, folderName: "지점 영상", ancestorIds: [ROOT, "LEGACY_TOP_0001"], chainComplete: true });
    const legacyReads = driveCalls().filter((call) => call.url.includes(`/files/${ROOT}?`) || call.url.includes("/files/LEGACY_TOP_0001?"));
    expect(legacyReads.length).toBe(2);
    expect(legacyReads.every((call) => bearerOf(call) === LEGACY_TOKEN)).toBe(true);
    expect(driveCalls().filter((call) => call.url.includes(`/files/${NEW_ROOT}?`)).every((call) => bearerOf(call) === ACCOUNT_TOKEN)).toBe(true);
  });
  it("🔴 예전 방식으로 확인만 한 기존 폴더(확인됨인데 '맨 위까지 이어지는지'는 안 본 것)도 다시 확인해 함께 넘긴다 — 안 넘기면 새 폴더가 영영 안 켜진다", async () => {
    Object.assign(db.tables.homework_video_drive_roots![0]!, { ancestry_verified: true, chain_complete: false });
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ ok: true });
    expect(savedArgs().p_verified_roots.map((claim) => [claim.rootId, claim.connectionId, claim.chainComplete])).toEqual([[NEW_ROOT, CONN, true], [ROOT, null, true]]);
    // 저장하려는 폴더가 그 목록에 있어도(같은 연결로 쓰던 폴더) 고른 계정으로 한 번만 확인한다.
    db.tables.homework_video_drive_roots![0]!.chain_complete = true;
    db.tables.homework_video_drive_roots!.push({ tenant_id: T, root_folder_id: NEW_ROOT, connection_id: CONN, ancestry_verified: true, chain_complete: false });
    save.mockClear();
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ ok: true });
    expect(savedArgs().p_verified_roots.map((claim) => claim.rootId)).toEqual([NEW_ROOT]);
  });
  it("기존 폴더가 그 계정의 내 드라이브 안이 아니면(공유받은 폴더) 까닭을 밝히고 멈춘다 — 온전하지 않은 경로를 DB로 넘기지 않는다", async () => {
    db.tables.homework_video_drive_roots![0]!.chain_complete = false;
    folders.LEGACY_TOP_0001 = ["SOMEONE_ELSES_TOP"]; folders.SOMEONE_ELSES_TOP = [];
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ error: expect.stringContaining("내 드라이브 안에 있지 않아") });
    expect(save).not.toHaveBeenCalled();
  });
  it("확인한 적 없는 기존 폴더를 확인하지 못하면 추정하지 않고 멈춘다(접근 실패 · 그 지점의 기존 연결이 서버에 없음)", async () => {
    db.tables.homework_video_drive_roots![0]!.ancestry_verified = false;
    delete folders[ROOT];
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ error: expect.stringContaining("기존 저장 폴더") });
    folders[ROOT] = ["LEGACY_TOP_0001"];
    db.tables.homework_video_drive_roots!.push({ tenant_id: OTHER_T, root_folder_id: "FOREIGN_LEGACY_ROOT_1", connection_id: null, ancestry_verified: false, chain_complete: false });
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ error: expect.stringContaining("기존 저장 폴더") });
    expect(save).not.toHaveBeenCalled();
    expect(calls.some((call) => call.url.includes("FOREIGN_LEGACY_ROOT_1"))).toBe(false); // 남의 폴더를 어떤 토큰으로도 읽지 않았다
  });
});

describe("해제 · DB 거절", () => {
  it("해제는 고른 연결과 폴더를 비우고 Google을 부르지 않는다", async () => {
    expect(await saveVideoDriveSetting(undefined, form("disconnect"))).toMatchObject({ ok: true });
    expect(savedArgs()).toMatchObject({ p_tenant: T, p_connection: null, p_root: null, p_enabled: false, p_verified_roots: [] });
    expect(calls).toHaveLength(0);
  });
  it("DB가 한글 사유로 거절하면 그 문장을, 그 밖의 오류는 일반 문장을 보인다(원문 없음)", async () => {
    save.mockImplementationOnce(() => { throw Object.assign(new Error("이 폴더는 지정할 수 없습니다. 비어 있는 새 폴더를 지정해 주세요"), { code: "P0001" }); });
    expect(await saveVideoDriveSetting(undefined, form())).toMatchObject({ error: expect.stringContaining("지정할 수 없습니다") });
    save.mockImplementationOnce(() => { throw Object.assign(new Error("relation \"x\" does not exist"), { code: "42P01" }); });
    const failed = await saveVideoDriveSetting(undefined, form());
    expect(failed.error).toContain("저장하지 못했습니다");
    expect(failed.error).not.toContain("relation");
    expect(m.audit).not.toHaveBeenCalled();
  });
});
