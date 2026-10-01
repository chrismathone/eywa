import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./fake-db.test-util";
import { C, ENV, FILE, FOLDER, S, T, TOKEN, fakeDrive, seedDb, settings } from "./test-fixture.test-util";
import { hashSubmitToken } from "./token";

const m = vi.hoisted(() => ({ db: null as unknown, settings: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async () => m.settings }));

import { completeLinkUpload } from "./upload-complete";
import { _resetVideoDriveConfigForTest } from "./drive-config";
import { _resetVideoSubmitAvailabilityForTest } from "./availability";

const UPLOAD = "55555555-5555-4555-8555-555555555555";
const route = { tenantId: T, studentId: S, classId: C, className: "LT4", subject: "math", teacherId: "t", folderName: "이수진 선생님", reason: "제출 링크" };
const good = {
  id: FILE, size: "1234", md5Checksum: "0123456789abcdef0123456789abcdef", parents: [FOLDER], trashed: false,
  appProperties: { aywaSource: "link", aywaUpload: UPLOAD },
};
let db: FakeDb;

function setup(uploaded: Record<string, unknown> | null, uploadOver: Record<string, unknown> = {}, linkOver: Record<string, unknown> = {}) {
  db = seedDb({ link: linkOver });
  db.tables.homework_video_link_uploads = [{
    id: UPLOAD, tenant_id: T, link_id: "L1", drive_file_id: FILE, drive_folder_id: FOLDER, bytes: 1234, status: "started",
    route, created_at: new Date(Date.now() - 60_000).toISOString(), video_id: null, ...uploadOver,
  }];
  m.db = db;
  const drive = fakeDrive({ uploaded });
  vi.stubGlobal("fetch", vi.fn(drive.impl));
  return drive.calls;
}
beforeEach(() => {
  m.settings = settings();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  _resetVideoDriveConfigForTest();
  _resetVideoSubmitAvailabilityForTest();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("완료 확인 — Drive를 다시 읽어 맞을 때만 줄을 만든다", () => {
  it("맞으면 출처 'link' 한 줄(학생·반·게시 시각) — 두 번 불러도 한 줄", async () => {
    setup(good);
    const first = await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD });
    expect(first).toMatchObject({ ok: true, created: true, studentId: S, tenantId: T });
    expect(db.tables.student_homework_videos).toHaveLength(1);
    expect(db.tables.student_homework_videos![0]).toMatchObject({
      tenant_id: T, student_id: S, source: "link", source_ref: UPLOAD, status: "uploaded", drive_file_id: FILE,
      drive_folder_id: FOLDER, bytes: 1234, md5: good.md5Checksum, route: { classId: C },
    });
    expect(db.tables.homework_video_link_uploads![0]).toMatchObject({ status: "completed" });
    const again = await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD });
    expect(again).toMatchObject({ ok: true, created: false });
    expect(db.tables.student_homework_videos).toHaveLength(1);
  });
  it("동시에 두 번 — 유니크 충돌이면 있던 줄을 쓴다", async () => {
    setup(good);
    db.tables.student_homework_videos = [{ id: "V0", tenant_id: T, source: "link", source_ref: UPLOAD }];
    expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: true, created: false, videoId: "V0" });
  });
  it("아직 Drive에 없으면 '아직' — 줄을 만들지 않는다", async () => {
    setup(null);
    expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: false, code: "pending" });
    expect(db.tables.student_homework_videos).toHaveLength(0);
  });
  const trashed = (calls: { url: string; init?: RequestInit }[]) =>
    calls.some((c) => c.init?.method === "PATCH" && c.url.includes(`/files/${FILE}?`) && String(c.init.body).includes('"trashed":true'));
  it("다른 폴더·다른 크기·표식 없음은 거절하고 실패로 남긴다 — 우리 폴더·우리 표식인 파일만 휴지통으로", async () => {
    for (const [bad, ourFile] of [
      [{ ...good, size: "9999" }, true], // 크기만 다르다(우리가 연 세션의 파일) → 휴지통
      [{ ...good, parents: ["SOMEWHERE_ELSE_1"] }, false], // 사람이 옮긴 파일 → 손대지 않는다
      [{ ...good, appProperties: {} }, false],
    ] as const) {
      const calls = setup(bad);
      expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: false, code: "mismatch" });
      expect(db.tables.student_homework_videos).toHaveLength(0);
      expect(db.tables.homework_video_link_uploads![0]).toMatchObject({ status: "failed" });
      expect(trashed(calls)).toBe(ourFile);
      expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false); // 영구 삭제는 하지 않는다
    }
  });
  it("하루가 지나도 파일이 없으면 버려진 업로드로 정리한다", async () => {
    setup(null, { created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: false, code: "pending" });
    expect(db.tables.homework_video_link_uploads![0]).toMatchObject({ status: "failed" });
  });
  it("다른 요청이 먼저 '완료'로 선점했으면 그 결과를 따른다(줄을 두 번 만들지 않는다)", async () => {
    setup(good);
    db.tables.homework_video_link_uploads![0]!.status = "completed";
    db.tables.student_homework_videos = [{ id: "V9", tenant_id: T, source: "link", source_ref: UPLOAD }];
    expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: true, created: false, videoId: "V9" });
    expect(db.tables.student_homework_videos).toHaveLength(1);
  });
  it("해시가 아직 없으면 실패가 아니라 '아직'(업로드를 망가뜨리지 않는다)", async () => {
    setup({ ...good, md5Checksum: undefined });
    expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: false, code: "pending" });
    expect(db.tables.homework_video_link_uploads![0]).toMatchObject({ status: "started" });
  });
  it("다른 링크의 업로드 번호·위조 토큰·이상한 번호는 거절", async () => {
    setup(good, { link_id: "OTHER_LINK" });
    expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: false, code: "invalid" });
    setup(good);
    expect(await completeLinkUpload({ token: "z".repeat(43), uploadId: UPLOAD })).toMatchObject({ ok: false, code: "invalid" });
    expect(await completeLinkUpload({ token: TOKEN, uploadId: "not-a-uuid" })).toMatchObject({ ok: false, code: "invalid" });
    expect(db.tables.student_homework_videos).toHaveLength(0);
  });
  it("만료 전에 시작한 업로드는 만료 뒤에도 받는다", async () => {
    setup(good, {}, { expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: true });
  });
  it("끊긴 링크는 끊기 전에 연 업로드도 받지 않고 파일을 휴지통으로", async () => {
    const calls = setup(good, {}, { revoked_at: new Date(Date.now() - 10_000).toISOString() });
    expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: false, code: "invalid" });
    expect(db.tables.student_homework_videos).toHaveLength(0);
    expect(trashed(calls)).toBe(true);
  });
  it("이미 영상 줄이 있는 업로드는 끊겨도 지우지 않는다(동시 완료가 먼저 기록)", async () => {
    const calls = setup(good, {}, { revoked_at: new Date(Date.now() - 10_000).toISOString() });
    db.tables.student_homework_videos = [{ id: "V1", tenant_id: T, source: "link", source_ref: UPLOAD }];
    await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD });
    expect(trashed(calls)).toBe(false);
  });
  it("보고서에 붙은 링크는 그 보고서가 회수·차단·재발급되면 닫힌다", async () => {
    const reportLink = { origin: "report", report_id: "R1", report_share_hash: hashSubmitToken("share-1") };
    for (const report of [{ revoked_at: "2026-10-01T00:00:00Z" }, { classnote_status: "recalled" }, { share_token: "share-2" }]) {
      setup(good, {}, reportLink);
      db.tables.lesson_reports = [{ id: "R1", tenant_id: T, share_token: "share-1", revoked_at: null, classnote_status: "success", ...report }];
      expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: false, code: "invalid" });
    }
    setup(good, {}, reportLink);
    db.tables.lesson_reports = [{ id: "R1", tenant_id: T, share_token: "share-1", revoked_at: null, classnote_status: "success" }];
    expect(await completeLinkUpload({ token: TOKEN, uploadId: UPLOAD })).toMatchObject({ ok: true });
  });
});
