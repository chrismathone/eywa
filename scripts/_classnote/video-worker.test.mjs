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

const TENANT = "11111111-1111-4111-8111-111111111111";
const { processVideoJob } = await import("./video-worker.mjs");
const { downloadVideo } = await import("./video-download.mjs");
const { uploadVideoToDrive } = await import("./video-drive.mjs");
const { removeArchiveLeftovers } = await import("./video-compress.mjs");
const candidate = { centerId: "12", videoId: "34", postId: "56", boardName: "보드", postedAt: "2026-10-01T01:00:00Z", sources: [] };

function fakeSql(job) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join("?"); calls.push({ text, values });
    if (text.includes("select 1 as one")) return Promise.resolve([{ one: 1 }]);
    if (text.includes("set status = 'processing'")) return Promise.resolve(job ? [job] : []);
    if (text.includes("set status = 'uploaded'")) return Promise.resolve([{ id: job.id }]);
    return Promise.resolve([]);
  };
  sql.json = (value) => ({ json: value });
  sql.end = async () => {};
  return { sql, calls };
}
beforeEach(async () => {
  h.dir = await mkdtemp(path.join(os.tmpdir(), "aywa-video-worker-")); h.paused = false;
  process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID = "root123456789";
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
  });
});
