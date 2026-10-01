import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOMEWORK_VIDEO_MAX_BYTES } from "@/features/students/homework-video-limits";
import type { FakeDb } from "./fake-db.test-util";
import { C, ENV, FILE, FOLDER, OTHER_T, S, SESSION, T, TOKEN, fakeDrive, seedDb, settings } from "./test-fixture.test-util";

const m = vi.hoisted(() => ({ db: null as unknown, settings: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async () => m.settings }));

import { startLinkUpload } from "./upload-start";
import { _resetVideoDriveConfigForTest } from "./drive-config";
import { _resetVideoSubmitAvailabilityForTest } from "./availability";

const file = { name: "IMG_0001.MOV", size: 5_000_000, type: "video/quicktime" };
const req = async (over: Partial<Parameters<typeof startLinkUpload>[0]> = {}) =>
  (await startLinkUpload({ token: TOKEN, file, origin: "https://www.aywa.co.kr", host: "www.aywa.co.kr", ...over })).result;
let db: FakeDb;
let drive: ReturnType<typeof fakeDrive>;

beforeEach(() => {
  db = seedDb();
  m.db = db;
  m.settings = settings();
  drive = fakeDrive();
  vi.stubGlobal("fetch", vi.fn(drive.impl));
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  _resetVideoDriveConfigForTest();
  _resetVideoSubmitAvailabilityForTest();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("업로드 시작 — 거절", () => {
  it("위조·모양이 다른 토큰은 Drive를 부르지 않는다", async () => {
    expect(await req({ token: "x".repeat(43) })).toMatchObject({ ok: false, code: "invalid" });
    expect(await req({ token: "../../etc" })).toMatchObject({ ok: false, code: "invalid" });
    expect(drive.calls).toHaveLength(0);
  });
  it("끊긴 링크·만료된 링크", async () => {
    m.db = seedDb({ link: { revoked_at: new Date().toISOString() } });
    expect(await req()).toMatchObject({ ok: false, code: "invalid" });
    m.db = seedDb({ link: { expires_at: new Date(Date.now() - 1000).toISOString() } });
    expect(await req()).toMatchObject({ ok: false, code: "expired", error: "만료된 링크입니다." });
    expect(drive.calls).toHaveLength(0);
  });
  it("1GB 초과·영상 아님은 세션을 열지 않는다", async () => {
    expect(await req({ file: { ...file, size: HOMEWORK_VIDEO_MAX_BYTES + 1 } })).toMatchObject({ ok: false, code: "file" });
    expect(await req({ file: { name: "a.pdf", size: 10, type: "application/pdf" } })).toMatchObject({ ok: false, code: "file" });
    expect(drive.calls).toHaveLength(0);
  });
  it("다른 출처가 세션을 받아 가지 못한다", async () => {
    expect(await req({ origin: "https://evil.example" })).toMatchObject({ ok: false });
    expect(drive.calls).toHaveLength(0);
  });
  it("Drive 값이 다른 지점 것이면 쓸 수 없다(그 학원 Drive로 안 올린다)", async () => {
    vi.stubEnv("CLASSNOTE_VIDEO_TENANT_ID", OTHER_T);
    expect(await req()).toMatchObject({ ok: false, code: "unavailable" });
    expect(drive.calls).toHaveLength(0);
  });
  it("ClassNote 기능이 꺼진 학원·SQL 전 DB는 쓸 수 없다", async () => {
    m.settings = { ...settings(), modules: { disabled: ["classnote"] } };
    expect(await req()).toMatchObject({ ok: false, code: "unavailable" });
    m.settings = settings();
    db.dropTable("homework_video_link_uploads");
    expect(await req()).toMatchObject({ ok: false, code: "unavailable" });
  });
  it("한 시간 10번을 넘기면 멈추고, 그때는 지난 업로드 대신 마무리(Drive 조회)도 하지 않는다", async () => {
    const now = new Date().toISOString();
    db.tables.homework_video_link_uploads = Array.from({ length: 10 }, (_, i) => ({ id: `u${i}`, tenant_id: T, link_id: "L1", status: "started", created_at: now }));
    const out = await startLinkUpload({ token: TOKEN, file, origin: "https://www.aywa.co.kr", host: "www.aywa.co.kr" });
    expect(out.result).toMatchObject({ ok: false, code: "limit" });
    expect(out.followUp).toBeNull();
  });
  it("동시에 몰려도 한도를 넘는 시작은 세션을 열지 못한다(넣은 뒤 다시 센다)", async () => {
    const now = new Date().toISOString();
    db.tables.homework_video_link_uploads = Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, tenant_id: T, link_id: "L1", status: "failed", created_at: now }));
    const results = await Promise.all(Array.from({ length: 6 }, () => req()));
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(2);
    expect(drive.calls.filter((c) => c.url.includes("uploadType=resumable")).length).toBeLessThanOrEqual(2);
  });
});

describe("업로드 시작 — 정상", () => {
  it("담임 폴더·미리 받은 번호·세션 주소 — 메타데이터는 서버가 정하고 크기를 못박는다", async () => {
    const result = await req();
    expect(result).toMatchObject({ ok: true, sessionUrl: SESSION });
    const upload = db.tables.homework_video_link_uploads![0]!;
    expect(upload).toMatchObject({ tenant_id: T, link_id: "L1", drive_file_id: FILE, drive_folder_id: FOLDER, bytes: 5_000_000, mime_type: "video/quicktime" });
    expect(String(upload.file_name)).toMatch(/^류태경_LT4_칠성초3_\d{4}-\d{2}-\d{2}\.mov$/);
    expect(upload.route).toMatchObject({ tenantId: T, studentId: S, classId: C, teacherId: expect.any(String), folderName: "이수진 선생님", reason: "제출 링크" });
    const start = drive.calls.find((c) => c.url.includes("uploadType=resumable"))!;
    const headers = start.init!.headers as Record<string, string>;
    expect(headers.Origin).toBe("https://www.aywa.co.kr");
    expect(headers["X-Upload-Content-Length"]).toBe("5000000");
    const body = JSON.parse(String(start.init!.body));
    expect(body).toMatchObject({ id: FILE, parents: [FOLDER], appProperties: { aywaSource: "link", aywaUpload: result.ok ? result.uploadId : "" } });
  });
  it("세션 응답에 접근 토큰·클라이언트 비밀이 실리지 않는다", async () => {
    const result = await req();
    expect(JSON.stringify(result)).not.toMatch(/access|secret|refresh/);
  });
});

describe("못 알린 지난 업로드 — 다시 시작할 때 서버가 대신 마무리", () => {
  it("2분 넘게 '시작됨'인 업로드가 Drive에 다 있으면 줄을 만들고 돌려준다", async () => {
    db.tables.homework_video_link_uploads = [{
      id: "55555555-5555-4555-8555-555555555555", tenant_id: T, link_id: "L1", drive_file_id: FILE, drive_folder_id: FOLDER, bytes: 77,
      status: "started", video_id: null, route: { classId: C, studentId: S }, created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    }];
    drive = fakeDrive({ uploaded: {
      id: FILE, size: "77", md5Checksum: "0123456789abcdef0123456789abcdef", parents: [FOLDER], trashed: false,
      appProperties: { aywaSource: "link", aywaUpload: "55555555-5555-4555-8555-555555555555" },
    } });
    vi.stubGlobal("fetch", vi.fn(drive.impl));
    const { result, followUp } = await startLinkUpload({ token: TOKEN, file, origin: "https://www.aywa.co.kr", host: "www.aywa.co.kr" });
    expect(db.tables.student_homework_videos).toHaveLength(0); // 응답 전에는 하지 않는다(응답 뒤 after)
    expect(await followUp!()).toHaveLength(1);
    expect(db.tables.student_homework_videos).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(S); // 마무리 결과(학생·반)는 응답에 싣지 않는다
  });
});
