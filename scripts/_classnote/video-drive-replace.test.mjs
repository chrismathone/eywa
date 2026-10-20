import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteOldRevisions, downloadDriveVideo, driveFreeBytes, replaceDriveVideoContent } from "./video-drive-replace.mjs";
import { driveClient } from "./video-drive-http.mjs";

// `/v` 영상 사후 압축의 Drive 쪽 — 나눠 받기 · 같은 번호로 내용 바꾸기 · 원본 버전만 지우기.
const dirs = [];
const md5 = (buf) => createHash("md5").update(buf).digest("hex");
const FILE = "file12345678";
const session = "https://www.googleapis.com/upload/drive/v3/files/file12345678?upload_id=s1";
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
const direct = (fetchImpl) => (url, init) => fetchImpl(url, init);
async function tempDir() { const dir = await mkdtemp(path.join(os.tmpdir(), "aywa-replace-")); dirs.push(dir); return dir; }
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

function ranged(content, { failFirst = false } = {}) {
  let failed = false;
  return vi.fn(async (url, init) => {
    const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
    if (failFirst && !failed) { failed = true; throw new TypeError("fetch failed"); }
    const slice = content.subarray(Number(a), Number(b) + 1);
    return new Response(slice, { status: 206, headers: { "content-range": `bytes ${a}-${b}/${content.length}` } });
  });
}

describe("downloadDriveVideo", () => {
  it("범위 요청으로 나눠 받아 해시를 낸다 — 끊긴 조각은 다시 받는다", async () => {
    const dir = await tempDir(); const content = Buffer.from("0123456789abcdefghij");
    const fetchImpl = ranged(content, { failFirst: true });
    const got = await downloadDriveVideo(direct(fetchImpl), FILE, content.length, path.join(dir, "a.mp4"), { chunkBytes: 8, sleep: async () => {} });
    expect(got).toMatchObject({ bytes: 20, md5: md5(content) });
    expect(await readFile(path.join(dir, "a.mp4"))).toEqual(content);
    expect(fetchImpl.mock.calls.map(([, init]) => init.headers.Range)).toEqual(["bytes=0-7", "bytes=0-7", "bytes=8-15", "bytes=16-19"]);
    expect(fetchImpl.mock.calls[0][0]).toContain(`/files/${FILE}?alt=media`);
  });

  it("크기가 장부와 다르거나(내용이 바뀜) 끝까지 못 받으면 던지고 임시 조각을 남기지 않는다", async () => {
    const dir = await tempDir(); const content = Buffer.from("0123456789");
    await expect(downloadDriveVideo(direct(ranged(content)), FILE, 12, path.join(dir, "b.mp4"), { chunkBytes: 8, sleep: async () => {} }))
      .rejects.toThrow(/HTTP 206/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("끝내는 신호가 오면 다음 조각을 받지 않는다", async () => {
    const dir = await tempDir(); const content = Buffer.alloc(32, 1); const abort = new AbortController();
    const fetchImpl = vi.fn(async (url, init) => { abort.abort(new Error("작업 종료 요청")); return ranged(content)(url, init); });
    await expect(downloadDriveVideo(direct(fetchImpl), FILE, 32, path.join(dir, "c.mp4"), { chunkBytes: 8, signal: abort.signal }))
      .rejects.toThrow("작업 종료 요청");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("replaceDriveVideoContent", () => {
  it("같은 파일 번호에 새 내용을 보낸다 — MP4 형식·이름·공개 표식만 고치고 앱 표식(appProperties)은 보내지 않는다", async () => {
    const dir = await tempDir(); const small = path.join(dir, "s.mp4"); await writeFile(small, Buffer.alloc(300, 4));
    const after = { id: FILE, md5Checksum: "new", size: "300", headRevisionId: "r2" };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { location: session } }))
      .mockResolvedValueOnce(new Response(null, { status: 308 }))
      .mockResolvedValueOnce(json({ id: FILE }))
      .mockResolvedValueOnce(json(after));
    const props = { aywaCompressed: "h264-crf22-medium-v1", aywaSourceMd5: "orig" };
    expect(await replaceDriveVideoContent(direct(fetchImpl), FILE, { filePath: small, bytes: 300 }, { name: "a.mp4", properties: props, sleep: async () => {} }))
      .toEqual(after);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\/file12345678\?uploadType=resumable/);
    expect(init.method).toBe("PATCH");
    expect(init.headers["X-Upload-Content-Length"]).toBe("300");
    expect(JSON.parse(init.body)).toEqual({ name: "a.mp4", mimeType: "video/mp4", properties: props });
    expect(fetchImpl.mock.calls[2][0]).toBe(session);
    expect(fetchImpl.mock.calls[2][1].headers["Content-Range"]).toBe("bytes 0-299/300");
  });

  it("Drive가 공간·사용량 한도로 거절하면(403 사유 · 429) '나중에'로 던진다 — 그 밖의 403은 시도로 센다", async () => {
    const dir = await tempDir(); const small = path.join(dir, "s.mp4"); await writeFile(small, Buffer.alloc(10, 4));
    const start = (response) => replaceDriveVideoContent(direct(vi.fn().mockResolvedValueOnce(response)), FILE, { filePath: small, bytes: 10 }, { sleep: async () => {} });
    const quota = await start(json({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }, 403)).catch((e) => e);
    expect(quota).toMatchObject({ later: true, message: expect.stringContaining("HTTP 403") });
    expect((await start(json({}, 429)).catch((e) => e)).later).toBe(true);
    expect((await start(json({ error: { errors: [{ reason: "insufficientFilePermissions" }] } }, 403)).catch((e) => e)).later).toBe(false);
  });
});

describe("driveFreeBytes · driveClient", () => {
  it("남은 공간 = 한도 − 사용량 · 한도가 없으면(공유 드라이브) null", async () => {
    expect(await driveFreeBytes(direct(vi.fn().mockResolvedValueOnce(json({ storageQuota: { limit: "1000", usage: "250" } }))))).toBe(750);
    expect(await driveFreeBytes(direct(vi.fn().mockResolvedValueOnce(json({ storageQuota: { usage: "250" } }))))).toBeNull();
  });

  it("부르는 쪽의 끊기 신호를 요청에 잇는다(시간 상한과 함께) · 신호가 없으면 시간 상한만", async () => {
    const fetchImpl = vi.fn(async () => new Response(null));
    const request = driveClient({ accessToken: async () => "t", fetchImpl });
    const abort = new AbortController();
    await request("https://example.invalid/a", { signal: abort.signal });
    await request("https://example.invalid/b");
    const [withSignal, plain] = fetchImpl.mock.calls.map(([, init]) => init.signal);
    expect(withSignal.aborted).toBe(false);
    abort.abort(new Error("작업 종료 요청"));
    expect(withSignal.aborted).toBe(true);
    expect(plain.aborted).toBe(false);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer t");
  });
});

describe("deleteOldRevisions", () => {
  it("머리 버전이 아니고 원본 해시인 버전만 지운다", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ revisions: [{ id: "r1", md5Checksum: "orig" }, { id: "r0", md5Checksum: "other" }, { id: "r2", md5Checksum: "orig" }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await deleteOldRevisions(direct(fetchImpl), FILE, { headRevisionId: "r2", md5: "orig" })).toBe("deleted");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]).toEqual([`https://www.googleapis.com/drive/v3/files/${FILE}/revisions/r1`, { method: "DELETE" }]);
  });

  it("지울 것이 없으면 none · 못 지우면 left(Drive가 30일 뒤 정리)", async () => {
    const none = vi.fn().mockResolvedValueOnce(json({ revisions: [{ id: "r2", md5Checksum: "new" }] }));
    expect(await deleteOldRevisions(direct(none), FILE, { headRevisionId: "r2", md5: "orig" })).toBe("none");
    const denied = vi.fn().mockResolvedValueOnce(json({ revisions: [{ id: "r1", md5Checksum: "orig" }] })).mockResolvedValueOnce(json({}, 403));
    expect(await deleteOldRevisions(direct(denied), FILE, { headRevisionId: "r2", md5: "orig" })).toBe("left");
    expect(await deleteOldRevisions(direct(vi.fn().mockResolvedValueOnce(json({}, 500))), FILE, { headRevisionId: "r2", md5: "orig" })).toBe("left");
  });
});
