import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// processVideoJob 배선: 용량 감시가 작업 선점 **전에** 멈추는지, 압축 훅·완료 기록·정리가 이어지는지(Drive·DB·ClassNote는 대역).
const h = vi.hoisted(() => ({ dir: "", sql: null, paused: false }));
vi.mock("postgres", () => ({ default: () => h.sql }));
vi.mock("./classnote-paths.mjs", () => ({ stateDir: () => h.dir }));
vi.mock("./classnote-feed-core.mjs", () => ({ reloadArchivedVideo: vi.fn(async (_b, payload) => payload), videoFeedSession: vi.fn() }));
vi.mock("./video-drive-auth.mjs", () => ({ videoDriveAuth: async () => ({ kind: "oauth", accessToken: async () => "test-only" }) }));
vi.mock("./video-drive-quota.mjs", () => ({ driveQuotaPaused: vi.fn(async () => h.paused) }));
vi.mock("./video-teacher-route.mjs", () => ({ loadVideoTeacher: vi.fn(async () => ({ tenantId: TENANT, studentId: null, subject: null, teacherId: null, folderName: "담임 확인 필요" })) }));
vi.mock("./video-drive-folders.mjs", () => ({ ensureTeacherFolder: vi.fn(async () => ({ id: "folder123456" })) }));
vi.mock("./video-download.mjs", async (load) => ({ ...await load(), downloadVideo: vi.fn() }));
vi.mock("./video-drive.mjs", () => ({ uploadVideoToDrive: vi.fn() }));
vi.mock("./video-compress.mjs", async (load) => ({ ...await load(), removeArchiveLeftovers: vi.fn(async () => {}) }));
vi.mock("./video-history.mjs", () => ({ scanVideoHistory: vi.fn() }));
vi.mock("./video-manual-scan.mjs", () => ({ runManualDriveScan: vi.fn() }));

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SAVED = "savedRoot12345";
const ENV_ROOT = "envOnlyFolder99";
const { processVideoJob, kickVideoWorker } = await import("./video-worker.mjs");
const { scanVideoHistory } = await import("./video-history.mjs");
const { runManualDriveScan } = await import("./video-manual-scan.mjs");
const { downloadVideo } = await import("./video-download.mjs");
const { uploadVideoToDrive } = await import("./video-drive.mjs");
const { removeArchiveLeftovers } = await import("./video-compress.mjs");
const { ensureTeacherFolder } = await import("./video-drive-folders.mjs");
const { loadVideoTeacher } = await import("./video-teacher-route.mjs");
import { readFileSync } from "node:fs";
const candidate = { centerId: "12", videoId: "34", postId: "56", boardName: "보드", postedAt: "2026-10-01T01:00:00Z", sources: [] };

function fakeSql(job, { setting = { enabled: true, root_folder_id: SAVED, owner_id: TENANT }, owners = {}, rootsError = null } = {}) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join("?"); calls.push({ text, values });
    if (text.includes("homework_video_drive_settings")) return Promise.resolve(setting ? [setting] : []);
    if (text.includes("homework_video_drive_roots")) {
      if (rootsError) return Promise.reject(rootsError);
      const id = values[0];
      if (Object.prototype.hasOwnProperty.call(owners, id)) return Promise.resolve(owners[id] ? [{ tenant_id: owners[id] }] : []);
      if (setting?.root_folder_id === id && setting.owner_id) return Promise.resolve([{ tenant_id: setting.owner_id }]);
      return Promise.resolve([]);
    }
    if (text.includes("classnote_video_folders")) return Promise.resolve([]);
    const acceptNew = values.some((value) => value === true);
    const eligible = !!(job?.route?.rootId || acceptNew);
    if (text.includes("select 1 as one")) return Promise.resolve(eligible ? [{ one: 1 }] : []);
    if (text.includes("set status = 'processing'")) return Promise.resolve(eligible && job ? [job] : []);
    if (text.includes("set status = 'uploaded'")) return Promise.resolve([{ id: job.id }]);
    return Promise.resolve([]);
  };
  sql.json = (value) => ({ json: value });
  sql.end = async () => {};
  return { sql, calls };
}
const rootIds = (calls) => calls.flatMap((call) => call.values.filter((value) => value?.json?.rootId).map((value) => value.json.rootId));
beforeEach(async () => {
  h.dir = await mkdtemp(path.join(os.tmpdir(), "aywa-video-worker-")); h.paused = false;
  process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID = ENV_ROOT;
  process.env.DATABASE_URL = "postgres://test-only";
});
afterEach(async () => { await rm(h.dir, { recursive: true, force: true }); vi.clearAllMocks(); });

describe("영상 작업 배선", () => {
  it("Drive 남은 공간이 문턱 아래면 작업을 집지 않는다(큐는 그대로 대기)", async () => {
    h.paused = true; const db = fakeSql({ id: "job1", payload: candidate, route: null }); h.sql = db.sql;
    await processVideoJob(null, TENANT, () => {});
    expect(db.calls.some((c) => c.text.includes("set status = 'processing'"))).toBe(false);
    expect(downloadVideo).not.toHaveBeenCalled();
  });

  it("압축 훅을 넘기고, 완료 기록에 Drive 크기·압축 여부를 남기고, 압축 산출물까지 정리한다", async () => {
    const db = fakeSql({ id: "job1", payload: candidate, route: null }); h.sql = db.sql;
    const filePath = path.join(h.dir, "classnote-12-34.mp4"); await writeFile(filePath, "x");
    downloadVideo.mockResolvedValue({ filePath, metadataPath: `${filePath}.json`, md5: "a".repeat(32), bytes: 1000, sha256: "b".repeat(64) });
    uploadVideoToDrive.mockResolvedValue({ id: "file123", bytes: 400, compression: "h264-crf22-medium-v1", status: "uploaded" });
    await processVideoJob(null, TENANT, () => {});
    const [, , options] = uploadVideoToDrive.mock.calls[0];
    expect(typeof options.prepareUpload).toBe("function");
    const done = db.calls.find((c) => c.text.includes("set status = 'uploaded'"));
    expect(done.values).toContainEqual({ json: expect.objectContaining({ archive: { driveBytes: 400, compression: "h264-crf22-medium-v1" } }) });
    expect(done.values).toContain(1000); // bytes·md5 칸은 원본 지문 그대로(중복 판정 키)
    expect(removeArchiveLeftovers).toHaveBeenCalledWith(filePath);
    expect(ensureTeacherFolder).toHaveBeenCalledWith(SAVED, expect.anything(), candidate.centerId, expect.any(String), expect.anything());
    expect(rootIds(db.calls)).toEqual([SAVED, SAVED]);
    expect(JSON.stringify(db.calls)).not.toContain(ENV_ROOT);
  });

  it("활성 루트가 바뀌어도 이미 찍힌 자기 루트로 끝내고, 그 루트의 등록부를 쓴다", async () => {
    const oldRoot = "oldRoot1234567";
    const db = fakeSql({ id: "job1", payload: candidate, route: { rootId: oldRoot, folderName: "담임", studentId: null, subject: null, teacherId: null } }, {
      setting: { enabled: true, root_folder_id: "newRoot1234567", owner_id: TENANT }, owners: { [oldRoot]: TENANT },
    });
    h.sql = db.sql;
    const filePath = path.join(h.dir, "classnote-12-34.mp4"); await writeFile(filePath, "x");
    downloadVideo.mockResolvedValue({ filePath, metadataPath: `${filePath}.json`, md5: "a".repeat(32), bytes: 1000, sha256: "b".repeat(64) });
    uploadVideoToDrive.mockResolvedValue({ id: "file123", bytes: 400, compression: null, status: "uploaded" });
    await processVideoJob(null, TENANT, () => {});
    expect(loadVideoTeacher).not.toHaveBeenCalled();
    expect(ensureTeacherFolder).toHaveBeenCalledWith(oldRoot, expect.objectContaining({ rootId: oldRoot }), expect.anything(), expect.any(String), expect.anything());
    expect(rootIds(db.calls)).toEqual([oldRoot, oldRoot]);
    expect(db.calls.some((call) => call.text.includes("set status = 'failed'"))).toBe(false);
  });

  it("설정이 해제된 뒤에도 소유한 기존 루트 작업은 끝낸다", async () => {
    const oldRoot = "oldRoot1234567";
    const db = fakeSql({ id: "job1", payload: candidate, route: { rootId: oldRoot, folderName: "담임", studentId: null, subject: null, teacherId: null } }, {
      setting: { enabled: false, root_folder_id: null, owner_id: null }, owners: { [oldRoot]: TENANT },
    });
    h.sql = db.sql;
    const filePath = path.join(h.dir, "classnote-12-34.mp4"); await writeFile(filePath, "x");
    downloadVideo.mockResolvedValue({ filePath, metadataPath: `${filePath}.json`, md5: "a".repeat(32), bytes: 1000, sha256: "b".repeat(64) });
    uploadVideoToDrive.mockResolvedValue({ id: "file123", bytes: 400, compression: null, status: "uploaded" });
    await processVideoJob(null, TENANT, () => {});
    expect(ensureTeacherFolder.mock.calls[0][0]).toBe(oldRoot);
    expect(rootIds(db.calls)).toEqual([oldRoot, oldRoot]);
  });

  it("다른 지점 루트와 각인 없는 해제 작업은 올리지 않는다", async () => {
    const oldRoot = "oldRoot1234567";
    const foreign = fakeSql({ id: "job1", payload: candidate, route: { rootId: oldRoot, folderName: "담임" } }, {
      setting: { enabled: true, root_folder_id: SAVED, owner_id: TENANT }, owners: { [oldRoot]: OTHER },
    });
    h.sql = foreign.sql;
    await expect(processVideoJob(null, TENANT, () => {})).rejects.toThrow("재시도 대기");
    expect(uploadVideoToDrive).not.toHaveBeenCalled();
    expect(ensureTeacherFolder).not.toHaveBeenCalled();
    expect(foreign.calls.some((call) => call.text.includes("set status = 'failed'"))).toBe(true);

    const fresh = fakeSql({ id: "job2", payload: candidate, route: null }, { setting: { enabled: false, root_folder_id: null, owner_id: null } });
    h.sql = fresh.sql;
    await processVideoJob(null, TENANT, () => {});
    expect(fresh.calls.some((call) => call.text.includes("set status = 'processing'"))).toBe(false);
    expect(fresh.calls.some((call) => call.text.includes("route->>'rootId'"))).toBe(true);
    expect(downloadVideo).not.toHaveBeenCalled();
  });

  it("루트가 달라졌다는 이유만으로 영구 실패시키지 않는다", () => {
    expect(readFileSync(path.join(process.cwd(), "scripts/_classnote/video-worker.mjs"), "utf8")).not.toContain("최초 저장 폴더와 현재 설정이 다릅니다");
  });

  it("찍힌 작업의 소유 조회가 실패하면 실패로 끝내지 않고 대기 줄로 되돌린다", async () => {
    const oldRoot = "oldRoot1234567";
    const denied = Object.assign(new Error("permission denied"), { code: "42501" });
    const db = fakeSql({ id: "job1", payload: candidate, route: { rootId: oldRoot, folderName: "담임" } }, {
      setting: { enabled: true, root_folder_id: SAVED, owner_id: TENANT }, rootsError: denied,
    });
    h.sql = db.sql;
    await processVideoJob(null, TENANT, () => {});
    expect(uploadVideoToDrive).not.toHaveBeenCalled();
    expect(ensureTeacherFolder).not.toHaveBeenCalled();
    expect(db.calls.some((call) => call.text.includes("set status = 'failed'"))).toBe(false);
    expect(db.calls.some((call) => call.text.includes("set status = 'queued'"))).toBe(true);
  });

  it("저장 폴더 설정을 읽지 못하면 새 수집과 직접 제출 훑기를 돌리지 않는다", async () => {
    const db = fakeSql(null, { setting: { enabled: false, root_folder_id: null, owner_id: null } });
    h.sql = db.sql;
    const log = vi.fn();
    await kickVideoWorker(null, TENANT, log, { setting: { enabled: false, rootId: null, source: "unknown", error: true } });
    expect(scanVideoHistory).not.toHaveBeenCalled();
    expect(runManualDriveScan).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("저장 폴더 설정을 확인하지 못해 새 수집은 건너뜁니다"));
    expect(downloadVideo).not.toHaveBeenCalled();
  });
});
