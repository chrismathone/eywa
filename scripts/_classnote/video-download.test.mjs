import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadVideo, loadDownloadedVideo, videoCandidate } from "./video-download.mjs";

const dirs = [];
const fixture = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(64)]);
const post = { id: 23, author: { type: "parent" }, content: "", attached_video: { id: 34, high: "https://cdn.example/high.mp4", low: "https://cdn.example/low.mp4" } };
const candidate = videoCandidate(post, 12);
async function temp() { const dir = await mkdtemp(path.join(os.tmpdir(), "aywa-video-test-")); dirs.push(dir); return dir; }
const ok = () => new Response(fixture, { headers: { "content-type": "video/mp4", "content-length": String(fixture.length) } });
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("클래스노트 영상 내려받기", () => {
  it("본문 없는 학부모 영상도 찾고 기본적으로 강사 글은 제외한다", () => {
    expect(candidate.videoId).toBe("34");
    expect(videoCandidate({ ...post, author: { type: "teacher" } }, 12)).toBeNull();
    expect(videoCandidate({ ...post, author: { type: "teacher" } }, 12, true)).not.toBeNull();
    expect(videoCandidate({ ...post, attached_video: { ...post.attached_video, id: "../bad" } }, 12)).toBeNull();
  });
  it("실제 파일을 저장하고 다시 실행하면 해시 대조 후 추가 다운로드를 하지 않는다", async () => {
    const dir = await temp(); const fetchImpl = vi.fn(ok);
    const first = await downloadVideo(candidate, dir, { fetchImpl });
    expect(await readFile(first.filePath)).toEqual(fixture);
    expect(first.sha256).toHaveLength(64);
    expect((await downloadVideo(candidate, dir, { fetchImpl })).status).toBe("already-downloaded");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readFile(first.metadataPath, "utf8")).not.toContain("https:");
    expect((await loadDownloadedVideo(first.filePath)).sha256).toBe(first.sha256);
  });
  it("고화질 주소가 만료되면 저화질 주소를 시도한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockImplementationOnce(ok);
    expect((await downloadVideo(candidate, await temp(), { fetchImpl })).quality).toBe("low");
  });
  it("파일 확정 직후 중단돼도 사전 해시 기록으로 복구하고 다시 받지 않는다", async () => {
    const dir = await temp(); const fetchImpl = vi.fn(ok);
    const first = await downloadVideo(candidate, dir, { fetchImpl });
    await rename(first.metadataPath, `${first.metadataPath}.pending`);
    expect((await downloadVideo(candidate, dir, { fetchImpl })).status).toBe("already-downloaded");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("HTML 응답·깨진 MP4는 저장 완료로 취급하지 않고 임시 파일을 치운다", async () => {
    const dir = await temp();
    const fetchImpl = vi.fn(() => new Response("not a video", { headers: { "content-type": "video/mp4" } }));
    await expect(downloadVideo(candidate, dir, { fetchImpl })).rejects.toThrow("다운로드 실패");
    expect(await readdir(dir)).toEqual([]);
  });
  it("변경된 기존 파일을 덮어쓰거나 정상으로 오인하지 않는다", async () => {
    const dir = await temp(); const fetchImpl = vi.fn(ok);
    const result = await downloadVideo(candidate, dir, { fetchImpl });
    await writeFile(result.filePath, "changed");
    await expect(downloadVideo(candidate, dir, { fetchImpl })).rejects.toThrow("기존 영상 검증 실패");
    await expect(loadDownloadedVideo(result.filePath)).rejects.toThrow("일치하지");
    expect(await readFile(result.filePath, "utf8")).toBe("changed");
  });
});
