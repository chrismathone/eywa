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
const { reloadArchivedVideo } = await import("./classnote-feed-core.mjs");
import { readFileSync } from "node:fs";
import { resetVideoJobPick } from "./video-job-pick.mjs";
const candidate = { centerId: "12", videoId: "34", postId: "56", boardName: "보드", postedAt: "2026-10-01T01:00:00Z", sources: [] };

function fakeSql(job, { setting = { enabled: true, root_folder_id: SAVED, owner_id: TENANT }, owners = {}, rootsError = null } = {}) {
  const calls = [];
  let opened = false;
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
    if (text.includes("homework_video_drive_connections")) return Promise.resolve([]);
    if (text.includes("order by available_at, id")) {
      const acceptNew = values.some((value) => value === true);
      opened = !!(job?.route?.rootId || acceptNew);
      return Promise.resolve(opened && job ? [job] : []);
    }
    if (text.includes("select 1 as one")) return Promise.resolve(opened ? [{ one: 1 }] : []);
    if (text.includes("set status = 'processing'")) return Promise.resolve(opened && job ? [job] : []);
    if (text.includes("set status = 'uploaded'")) return Promise.resolve([{ id: job.id }]);
    return Promise.resolve([]);
  };
  sql.json = (value) => ({ json: value });
  sql.end = async () => {};
  return { sql, calls };
}
const rootIds = (calls) => calls.flatMap((call) => call.values.filter((value) => value?.json?.rootId).map((value) => value.json.rootId));
beforeEach(async () => {
  resetVideoJobPick();
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
    const failed = foreign.calls.find((call) => call.text.includes("set status = 'failed'"));
    expect(failed.text).toContain("locked_at < now() - interval '10 minutes'");
    expect(failed.text).not.toContain("status in ('queued', 'failed', 'processing')");

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
    const requeued = db.calls.find((call) => call.text.includes("set status = 'queued'"));
    expect(requeued.text).toContain("locked_at < now() - interval '10 minutes'");
    expect(requeued.text).not.toContain("status in ('queued', 'failed', 'processing')");
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

/**
 * 원장 2026-10-06: *"해당 숙제 보고서 고유의 링크 주소가 있는 보고서에 영상을 업로드하면 무조건 체킹가능하지."*
 * 재조회가 실어 준 보고서 토큰(`reportToken`) → 판정이 실어 준 숙제일(`homeworkDate`)이 route에 찍혀 완료 기록까지 가는지,
 * 이미 한 번 시도된 작업·글을 못 읽은 작업이 어떻게 되는지(리뷰 2026-10-06)를 실행으로 잠근다.
 */
describe("보고서 글에 댓글로 올린 영상 — 숙제 연결", () => {
  const TOKEN = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const oldRoot = "oldRoot1234567";
  const comment = { ...candidate, commentId: "9" };
  const linked = { tenantId: TENANT, studentId: "student", subject: "math", teacherId: "teacher", folderName: "김 선생님",
    classId: "class-a", className: "초등M 3A", homeworkDate: "2026-10-06" };
  const stamped = { rootId: oldRoot, folderName: "담임 확인 필요", studentId: "student", subject: null, teacherId: null, classId: null };
  const pinnedDb = (route, attempts = 2) => fakeSql({ id: "job1", payload: comment, route, attempts }, {
    setting: { enabled: true, root_folder_id: "newRoot1234567", owner_id: TENANT }, owners: { [oldRoot]: TENANT },
  });
  const ready = async () => {
    const filePath = path.join(h.dir, "classnote-12-34.mp4"); await writeFile(filePath, "x");
    downloadVideo.mockResolvedValue({ filePath, metadataPath: `${filePath}.json`, md5: "a".repeat(32), bytes: 1000, sha256: "b".repeat(64) });
    uploadVideoToDrive.mockResolvedValue({ id: "file123", bytes: 400, compression: null, status: "uploaded" });
  };
  const routes = (calls) => calls.flatMap((call) => call.values.filter((value) => value?.json?.rootId).map((value) => value.json));

  it("새 작업: 판정이 실어 준 숙제일이 route에 찍히고 완료 기록까지 남는다", async () => {
    const db = fakeSql({ id: "job1", payload: comment, route: null, attempts: 1 }); h.sql = db.sql; await ready();
    reloadArchivedVideo.mockResolvedValueOnce({ ...comment, reportToken: TOKEN, reportUnread: false });
    loadVideoTeacher.mockResolvedValueOnce(linked);
    const log = vi.fn();
    await processVideoJob(null, TENANT, log);
    expect(reloadArchivedVideo).toHaveBeenCalledWith(null, comment, { readReport: true });
    expect(loadVideoTeacher).toHaveBeenCalledWith(expect.anything(), TENANT, expect.objectContaining({ reportToken: TOKEN }));
    expect(routes(db.calls)).toEqual([
      expect.objectContaining({ rootId: SAVED, classId: "class-a", homeworkDate: "2026-10-06" }),
      expect.objectContaining({ rootId: SAVED, classId: "class-a", homeworkDate: "2026-10-06", archive: expect.anything() }),
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("2026-10-06 숙제로 연결"));
  });

  it("🔴 이미 한 번 시도된 작업(숙제 미정)도 보고서 글의 영상이면 다시 판정해 묶는다 — 저장 루트·담임 폴더는 찍힌 그대로", async () => {
    const db = pinnedDb(stamped); h.sql = db.sql; await ready();
    reloadArchivedVideo.mockResolvedValueOnce({ ...comment, reportToken: TOKEN, reportUnread: false });
    loadVideoTeacher.mockResolvedValueOnce(linked);
    await processVideoJob(null, TENANT, () => {});
    expect(reloadArchivedVideo).toHaveBeenCalledWith(null, comment, { readReport: true });
    // 반·숙제일은 새 판정, 폴더 키(teacherId)·폴더 이름은 첫 판정 — 업로드 재개 기록에 첫 폴더가 박혀 있어 폴더가 바뀌면 영영 실패한다.
    for (const route of routes(db.calls)) {
      expect(route).toMatchObject({ rootId: oldRoot, classId: "class-a", className: "초등M 3A", subject: "math", homeworkDate: "2026-10-06",
        teacherId: null, folderName: "담임 확인 필요" });
      expect(route.reason).toContain("담임 폴더는 첫 판정 그대로");
    }
    expect(routes(db.calls)).toHaveLength(2);
    expect(ensureTeacherFolder).toHaveBeenCalledWith(oldRoot, expect.objectContaining({ teacherId: null, folderName: "담임 확인 필요" }), expect.anything(), expect.any(String), expect.anything());
    // 칸에 적는 담임도 폴더와 같은 값이다(첫 판정)
    const stamp = db.calls.find((call) => call.text.includes("set route ="));
    expect(stamp.values.slice(1, 4)).toEqual(["student", "math", null]);
  });

  it("다시 판정한 담임이 찍힌 담임과 같으면 판정 사유도 새 판정 그대로다", async () => {
    const db = pinnedDb({ ...stamped, teacherId: "teacher", folderName: "김 선생님" }); h.sql = db.sql; await ready();
    reloadArchivedVideo.mockResolvedValueOnce({ ...comment, reportToken: TOKEN, reportUnread: false });
    loadVideoTeacher.mockResolvedValueOnce({ ...linked, reason: "보고서 글에 올린 영상 — 그 보고서 반의 현재 담임" });
    await processVideoJob(null, TENANT, () => {});
    for (const route of routes(db.calls))
      expect(route).toMatchObject({ teacherId: "teacher", folderName: "김 선생님", homeworkDate: "2026-10-06", reason: "보고서 글에 올린 영상 — 그 보고서 반의 현재 담임" });
  });

  it("다시 판정해도 그 보고서의 숙제로 안 묶이면 찍힌 판정 그대로다", async () => {
    const db = pinnedDb(stamped); h.sql = db.sql; await ready();
    reloadArchivedVideo.mockResolvedValueOnce({ ...comment, reportToken: TOKEN, reportUnread: false });
    await processVideoJob(null, TENANT, () => {}); // 판정 대역의 기본값엔 숙제일이 없다
    expect(loadVideoTeacher).toHaveBeenCalledTimes(1);
    for (const route of routes(db.calls)) {
      expect(route).toMatchObject({ rootId: oldRoot, folderName: "담임 확인 필요", studentId: "student" });
      expect(route).not.toHaveProperty("homeworkDate");
    }
  });

  it("숙제가 이미 정해진 작업은 글을 다시 읽지 않고 판정도 다시 하지 않는다", async () => {
    const db = pinnedDb({ ...stamped, ...linked, rootId: oldRoot }); h.sql = db.sql; await ready();
    // 재조회가 토큰을 실어 와도(이중 방어) 숙제가 정해진 작업은 다시 판정하지 않는다
    reloadArchivedVideo.mockResolvedValueOnce({ ...comment, reportToken: TOKEN, reportUnread: false });
    const log = vi.fn();
    await processVideoJob(null, TENANT, log);
    expect(reloadArchivedVideo).toHaveBeenCalledWith(null, comment, { readReport: false });
    expect(loadVideoTeacher).not.toHaveBeenCalled();
    expect(routes(db.calls).every((route) => route.homeworkDate === "2026-10-06" && route.rootId === oldRoot)).toBe(true);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("숙제로 연결"));
  });

  it("🔴 글을 못 읽으면 집은 횟수 세 번까지는 다음 주기로 미루고, 그 뒤로는 숙제 연결 없이 보관한다", async () => {
    const unread = { ...comment, reportToken: null, reportUnread: true };
    const early = fakeSql({ id: "job1", payload: comment, route: null, attempts: 3 }); h.sql = early.sql; await ready();
    reloadArchivedVideo.mockResolvedValueOnce(unread);
    const earlyLog = vi.fn();
    await expect(processVideoJob(null, TENANT, earlyLog)).rejects.toThrow("재시도 대기");
    expect(earlyLog).toHaveBeenCalledWith(expect.stringContaining("다음 주기에 다시 합니다")); // 원인이 로그에 남는다(Drive 문제로 읽히지 않게)
    expect(early.calls.some((call) => call.text.includes("set route ="))).toBe(false); // 판정을 찍지 않는다 — 다음에 처음부터 다시 본다
    expect(early.calls.some((call) => call.text.includes("set status = 'failed'"))).toBe(true);
    expect(downloadVideo).not.toHaveBeenCalled();
    expect(loadVideoTeacher).not.toHaveBeenCalled();

    const late = fakeSql({ id: "job1", payload: comment, route: null, attempts: 4 }); h.sql = late.sql;
    reloadArchivedVideo.mockResolvedValueOnce(unread);
    const log = vi.fn();
    await processVideoJob(null, TENANT, log);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("숙제 연결 없이 보관합니다"));
    expect(late.calls.some((call) => call.text.includes("set status = 'uploaded'"))).toBe(true);
    expect(routes(late.calls).some((route) => "homeworkDate" in route)).toBe(false);
  });
});
