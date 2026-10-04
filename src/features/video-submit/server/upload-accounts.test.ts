import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./fake-db.test-util";
import { C, ENV, FILE, FOLDER, OTHER_T, ROOT, S, SESSION, T, TEACHER, TOKEN, fakeDrive, seedDb, settings } from "./test-fixture.test-util";
import { CONN, CONN_B, WEB_ENV, addConnection, bearerOf, enableAccountRoot, withAccountSchema } from "./account-fixture.test-util";

/**
 * 지점마다 다른 Google 계정(2026-10-04) — 업로드 시작·완료가 **각인된 `(저장 폴더, 연결)`의 자격**만 쓰는지.
 * 기존 env 연결(연결 없는 폴더)·계정 연결·계정을 바꾼 뒤·해제한 뒤를 한 DB에서 섞어 본다.
 */
const m = vi.hoisted(() => ({ db: null as unknown, settings: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async () => m.settings }));

import { startLinkUpload } from "./upload-start";
import { completeLinkUpload } from "./upload-complete";
import { _resetVideoDriveConfigForTest } from "./drive-config";
import { _resetVideoDriveQuotaForTest } from "./drive-quota";
import { _resetVideoDriveTokensForTest } from "./drive-token";
import { _resetVideoSubmitAvailabilityForTest } from "./availability";

const ACCOUNT_ROOT = "ACCOUNT_ROOT_0001";
const OLD_ROOT = "OLD_ACCOUNT_ROOT_1";
const ACCOUNT_TOKEN = "access:rt-aaaa";
const LEGACY_TOKEN = "access";
const GB = 1024 ** 3;
const UPLOAD = "55555555-5555-4555-8555-555555555555";
const UPLOAD_2 = "66666666-6666-4666-8666-666666666666";
const file = { name: "IMG_0001.MOV", size: 5_000_000, type: "video/quicktime" };
const start = () => startLinkUpload({ token: TOKEN, file, origin: "https://www.aywa.co.kr", host: "www.aywa.co.kr" });
const uploaded = (id: string, upload: string, size = "77") =>
  ({ id, size, md5Checksum: "0123456789abcdef0123456789abcdef", parents: [FOLDER], trashed: false, appProperties: { aywaSource: "link", aywaUpload: upload } });
const startedRow = (id: string, fileId: string, route: Record<string, unknown>) => ({
  id, tenant_id: T, link_id: "L1", drive_file_id: fileId, drive_folder_id: FOLDER, bytes: 77, status: "started", video_id: null,
  route: { classId: C, studentId: S, ...route }, created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
});
let db: FakeDb;
let drive: ReturnType<typeof fakeDrive>;
const stubDrive = (opts: Parameters<typeof fakeDrive>[0] = {}) => { drive = fakeDrive(opts); vi.stubGlobal("fetch", vi.fn(drive.impl)); };
const driveCalls = () => drive.calls.filter((call) => !call.url.includes("oauth2.googleapis.com"));

/** 이 지점이 Google 계정(CONN)을 연결해 ACCOUNT_ROOT로 받고 있다. 기존 폴더 ROOT(연결 없음)의 등록은 그대로 남는다. */
function connectAccount() {
  addConnection(db, T);
  enableAccountRoot(db, T, ACCOUNT_ROOT);
  db.tables.classnote_video_folders = [{ tenant_id: T, root_folder_id: ACCOUNT_ROOT, route_key: `${T}:96575:${TEACHER}`, drive_folder_id: FOLDER }];
}

beforeEach(() => {
  db = withAccountSchema(seedDb());
  db.tables.homework_video_drive_roots = [{ tenant_id: T, root_folder_id: ROOT, connection_id: null }];
  m.db = db;
  m.settings = settings();
  for (const [key, value] of Object.entries({ ...ENV, ...WEB_ENV })) vi.stubEnv(key, value);
  _resetVideoDriveConfigForTest(); _resetVideoSubmitAvailabilityForTest(); _resetVideoDriveTokensForTest(); _resetVideoDriveQuotaForTest();
  stubDrive();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("업로드 시작 — 어느 계정으로 여나", () => {
  it("계정을 연결한 지점: 경로에 폴더와 연결을 함께 각인하고 **그 계정의 토큰으로만** Drive를 부른다", async () => {
    connectAccount();
    stubDrive({ root: ACCOUNT_ROOT });
    expect((await start()).result).toMatchObject({ ok: true, sessionUrl: SESSION });
    expect(db.tables.homework_video_link_uploads![0]!.route).toMatchObject({ rootId: ACCOUNT_ROOT, connectionId: CONN });
    expect(driveCalls().length).toBeGreaterThan(0);
    expect(driveCalls().every((call) => bearerOf(call) === ACCOUNT_TOKEN)).toBe(true);
  });
  it("기존 연결 지점: 경로에 연결 칸이 없다(예전 기록과 같은 모양) · env의 기존 토큰으로 연다", async () => {
    expect((await start()).result).toMatchObject({ ok: true });
    const route = db.tables.homework_video_link_uploads![0]!.route as Record<string, unknown>;
    expect(route).toMatchObject({ rootId: ROOT });
    expect(route).not.toHaveProperty("connectionId");
    expect(driveCalls().every((call) => bearerOf(call) === LEGACY_TOKEN)).toBe(true);
  });
  it("🔴 다시 연결이 필요한 계정은 새 업로드를 받지 않는다 — env의 기존 연결로 대신 열지 않는다", async () => {
    connectAccount();
    db.tables.homework_video_drive_connections![0]!.status = "needs_reauth";
    expect((await start()).result).toMatchObject({ ok: false, code: "unavailable" });
    expect(db.tables.homework_video_link_uploads).toHaveLength(0);
    expect(drive.calls).toHaveLength(0);
  });
  it("🔴 계정을 연결하지 않고 폴더만 정한 지점은 다른 지점의 env 자격을 타지 못한다", async () => {
    vi.stubEnv("CLASSNOTE_VIDEO_TENANT_ID", OTHER_T); // env의 기존 연결은 다른 지점 것
    _resetVideoDriveConfigForTest();
    db.tables.homework_video_drive_settings = [{ tenant_id: T, enabled: true, root_folder_id: ROOT, connection_id: null, version: "v" }];
    expect((await start()).result).toMatchObject({ ok: false, code: "unavailable" });
    expect(drive.calls).toHaveLength(0);
  });
  it("그 계정의 남은 공간이 모자라면 새 업로드를 열지 않는다(세션·기록 없음) — 넉넉하면 연다", async () => {
    connectAccount();
    stubDrive({ root: ACCOUNT_ROOT, quota: { limit: 15 * GB, usage: 14.5 * GB } });
    expect((await start()).result).toMatchObject({ ok: false, code: "unavailable" });
    expect(db.tables.homework_video_link_uploads).toHaveLength(0);
    expect(drive.calls.some((call) => call.url.includes("uploadType=resumable"))).toBe(false);
    _resetVideoDriveQuotaForTest();
    stubDrive({ root: ACCOUNT_ROOT, quota: { limit: 15 * GB, usage: 2 * GB } });
    expect((await start()).result).toMatchObject({ ok: true });
  });
});

describe("이미 시작한 업로드 — 처음 계정으로 끝낸다", () => {
  it("🔴 못 알린 지난 업로드는 **줄마다 각인된 계정**으로 마무리한다 — 계정을 바꾼 뒤에도 지금 계정으로 읽지 않는다", async () => {
    connectAccount(); // 지금 계정 = CONN(ACCOUNT_ROOT)
    addConnection(db, T, CONN_B); // 예전에 쓰던 계정(OLD_ROOT)
    db.tables.homework_video_drive_roots!.push({ tenant_id: T, root_folder_id: OLD_ROOT, connection_id: CONN_B });
    db.tables.homework_video_link_uploads = [
      startedRow(UPLOAD, "LEGACY_FILE_00001", { rootId: ROOT }), // 기존 연결로 시작한 업로드
      startedRow(UPLOAD_2, "OLDACC_FILE_00001", { rootId: OLD_ROOT, connectionId: CONN_B }), // 예전 계정으로 시작한 업로드
    ];
    const calls: { url: string; init?: RequestInit }[] = [];
    const base = fakeDrive({ root: ACCOUNT_ROOT });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/files/LEGACY_FILE_00001?")) return new Response(JSON.stringify(uploaded("LEGACY_FILE_00001", UPLOAD)));
      if (url.includes("/files/OLDACC_FILE_00001?")) return new Response(JSON.stringify(uploaded("OLDACC_FILE_00001", UPLOAD_2)));
      return base.impl(input, init);
    }));
    const out = await start();
    expect(await out.followUp!()).toHaveLength(2);
    const read = (id: string) => calls.filter((call) => call.url.includes(`/files/${id}?`)).map(bearerOf);
    expect(read("LEGACY_FILE_00001")).toEqual([LEGACY_TOKEN]);
    expect(read("OLDACC_FILE_00001")).toEqual(["access:rt-bbbb"]);
    const routes = db.tables.student_homework_videos!.map((row) => row.route as Record<string, unknown>);
    expect(routes.find((route) => route.rootId === OLD_ROOT)).toMatchObject({ connectionId: CONN_B });
    expect(routes.find((route) => route.rootId === ROOT)).not.toHaveProperty("connectionId");
  });
  it("해제한 뒤에도 각인된 계정으로 완료하고, 영상 줄의 경로는 시작할 때의 폴더·연결 그대로다", async () => {
    connectAccount();
    db.tables.homework_video_drive_settings = [{ tenant_id: T, enabled: false, root_folder_id: null, connection_id: null, version: "v2" }];
    db.tables.homework_video_link_uploads = [startedRow(UPLOAD, FILE, { rootId: ACCOUNT_ROOT, connectionId: CONN })];
    stubDrive({ uploaded: uploaded(FILE, UPLOAD) });
    expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: true, created: true });
    expect(db.tables.student_homework_videos![0]!.route).toMatchObject({ rootId: ACCOUNT_ROOT, connectionId: CONN });
    expect(driveCalls().every((call) => bearerOf(call) === ACCOUNT_TOKEN)).toBe(true);
  });
  it("🔴 경로의 폴더·연결이 등록부와 어긋나면(바꿔 적힌 연결·연결이 빠진 계정 폴더) 완료하지 않고 Drive도 부르지 않는다", async () => {
    connectAccount();
    for (const route of [{ rootId: ACCOUNT_ROOT, connectionId: CONN_B }, { rootId: ACCOUNT_ROOT }, { rootId: ROOT, connectionId: CONN }]) {
      db.tables.homework_video_link_uploads = [startedRow(UPLOAD, FILE, route)];
      stubDrive({ uploaded: uploaded(FILE, UPLOAD) });
      expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: false, code: "unavailable" });
      expect(drive.calls).toHaveLength(0);
    }
    expect(db.tables.student_homework_videos).toHaveLength(0);
  });
  it("남은 공간이 모자라 새 업로드가 닫혀도, 이미 올라간 영상의 완료 확인은 받는다", async () => {
    connectAccount();
    db.tables.homework_video_link_uploads = [startedRow(UPLOAD, FILE, { rootId: ACCOUNT_ROOT, connectionId: CONN })];
    stubDrive({ root: ACCOUNT_ROOT, uploaded: uploaded(FILE, UPLOAD), quota: { limit: 15 * GB, usage: 14.9 * GB } });
    expect((await start()).result).toMatchObject({ ok: false, code: "unavailable" });
    expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: true });
  });
});
