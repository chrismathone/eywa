// @vitest-environment node
import { describe, expect, it } from "vitest";
import { videoWorkerReadiness } from "./video-worker-readiness.mjs";
const now = Date.parse("2026-09-30T12:00:00Z");
const row = { last_seen: "2026-09-30T11:59:50Z", started_at: "2026-09-30T11:59:00Z",
  last_results: { postMode: true, caps: { homeworkVideoArchive: true }, videoArchive: { enabled: true, folderId: "folder" } } };
const options = { now, folderId: "folder", startedAfter: "2026-09-30T11:58:30Z" };
describe("영상 워커 적용 확인", () => {
  it("새 프로세스의 기능·폴더·최근 심장박동을 모두 확인한다", () => {
    expect(videoWorkerReadiness(row, options).ready).toBe(true);
    expect(videoWorkerReadiness({ ...row, started_at: new Date("2026-09-30T11:59:00.900Z") },
      { ...options, startedAfter: "2026-09-30T11:59:00.500Z" }).ready).toBe(true);
  });
  it("살아 있는 옛 버전과 재시작 전 프로세스를 성공으로 표시하지 않는다", () => {
    expect(videoWorkerReadiness({ ...row, last_results: { ...row.last_results, caps: {} } }, options).ready).toBe(false);
    expect(videoWorkerReadiness({ ...row, started_at: "2026-09-30T11:00:00Z" }, options).ready).toBe(false);
  });
  it("다른 폴더·꺼진 설정·시험 모드·오프라인을 감지한다", () => {
    for (const change of [{ postMode: false }, { videoArchive: { enabled: false, folderId: "folder" } }, { videoArchive: { enabled: true, folderId: "other" } }])
      expect(videoWorkerReadiness({ ...row, last_results: { ...row.last_results, ...change } }, options).ready).toBe(false);
    expect(videoWorkerReadiness({ ...row, last_seen: "2026-09-30T11:50:00Z" }, options).ready).toBe(false);
    expect(videoWorkerReadiness(null, options).ready).toBe(false);
  });
  it("지점 폴더를 아는 워커는 하트비트 폴더를 저장된 루트와 비교하고, 구워커는 env 폴더와 비교한다", () => {
    const caps = { homeworkVideoArchive: true, homeworkVideoTenantFolders: true };
    const current = { ...row, last_results: { ...row.last_results, caps, videoArchive: { enabled: true, folderId: "saved-root" } } };
    expect(videoWorkerReadiness(current, { ...options, folderId: "env-folder", savedRootId: "saved-root" }).ready).toBe(true);
    expect(videoWorkerReadiness(current, { ...options, folderId: "saved-root", savedRootId: "other-root" }).ready).toBe(false);
    expect(videoWorkerReadiness(current, { ...options, folderId: "env-folder", savedRootId: null }).ready).toBe(false);
    expect(videoWorkerReadiness(row, { ...options, folderId: "folder", savedRootId: "saved-root" }).ready).toBe(true);
    expect(videoWorkerReadiness(row, { ...options, folderId: "env-folder", savedRootId: "folder" }).ready).toBe(false);
  });
});
