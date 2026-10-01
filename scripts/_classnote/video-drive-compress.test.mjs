import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileDigests } from "./video-download.mjs";
import { uploadVideoToDrive } from "./video-drive.mjs";

// 압축본 업로드: 중복·예약·재시도 판정은 원본 지문으로, 실제 전송·검증은 압축본으로.
const dirs = [];
const folderId = "folder123456";
const MARK = "h264-crf22-medium-v1";
const session = "https://www.googleapis.com/upload/drive/v3/files?upload_id=test";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const folder = { id: folderId, mimeType: "application/vnd.google-apps.folder", driveId: "shared", capabilities: { canAddChildren: true } };
async function files() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aywa-drive-compress-")); dirs.push(dir);
  const filePath = path.join(dir, "classnote-12-34.mp4"); await writeFile(filePath, Buffer.alloc(1024, 7));
  const small = path.join(dir, "classnote-12-34.aywa.mp4"); await writeFile(small, Buffer.alloc(400, 5));
  const v = { filePath, centerId: "12", videoId: "34", name: "학생_반_학교_2026-10-01.mp4", ...await fileDigests(filePath) };
  return { v, c: { marker: MARK, filePath: small, ...await fileDigests(small) } };
}
const remoteOf = (v, c) => ({ id: "file123", name: v.name, size: String(c.bytes), md5Checksum: c.md5, parents: [folderId],
  properties: { aywaCompressed: MARK, aywaSourceMd5: v.md5, aywaSourceBytes: String(v.bytes), aywaUploadMd5: c.md5, aywaUploadBytes: String(c.bytes) } });
const options = (fetchImpl, extra = {}) => ({ kind: "service-account", accessToken: async () => "test-only", fetchImpl, sleep: async () => {}, ...extra });
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("압축본 Drive 업로드", () => {
  it("압축본을 보내되, 예약은 원본 지문으로 하고 Drive에 원본·압축본 지문을 함께 남긴다", async () => {
    const { v, c } = await files(); const remote = remoteOf(v, c);
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ ids: ["file123"] })).mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(new Response(null, { headers: { location: session } }))
      .mockResolvedValueOnce(new Response(null, { status: 308 }))
      .mockResolvedValueOnce(json(remote, 201)).mockResolvedValueOnce(json(remote));
    const reserve = vi.fn().mockResolvedValue("file123");
    const prepareUpload = vi.fn().mockResolvedValue(c);
    const saved = await uploadVideoToDrive(v, folderId, options(fetchImpl, { fileRegistry: { reserve }, prepareUpload }));
    expect(saved).toMatchObject({ status: "uploaded", bytes: 400, compression: MARK });
    expect(reserve.mock.calls[0][1]).toMatchObject({ md5: v.md5, bytes: 1024 });
    const init = fetchImpl.mock.calls[4][1];
    expect(init.headers["X-Upload-Content-Length"]).toBe("400");
    // 지문은 공개 properties — appProperties는 OAuth 앱마다 비공개라 인증 방식을 바꾸면 안 보인다.
    expect(JSON.parse(init.body).appProperties).toEqual({ aywaSource: "classnote:12:34", aywaSha256: v.sha256 });
    expect(JSON.parse(init.body).properties).toEqual({ aywaSourceMd5: v.md5, aywaSourceBytes: "1024", aywaUploadMd5: c.md5, aywaUploadBytes: "400", aywaCompressed: MARK });
    expect(fetchImpl.mock.calls[6][1].headers["Content-Range"]).toBe("bytes 0-399/400");
    expect(fetchImpl.mock.calls[6][1].body.byteLength).toBe(400);
    expect(JSON.parse(await readFile(`${v.filePath}.drive-state.json`, "utf8"))).toMatchObject({ md5: v.md5, uploadMd5: c.md5, completed: true });
  });

  it("같은 원본의 압축본이 이미 있으면 다시 압축·전송하지 않는다(재시도·같은 영상 두 번)", async () => {
    const { v, c } = await files(); const prepareUpload = vi.fn();
    const found = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [remoteOf(v, c)] }));
    expect(await uploadVideoToDrive(v, folderId, options(found, { prepareUpload }))).toMatchObject({ status: "already-uploaded", compression: MARK });
    const dup = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json(remoteOf(v, c)));
    expect((await uploadVideoToDrive(v, folderId, options(dup, { prepareUpload, existingFileId: "file1234567" }))).status).toBe("already-uploaded");
    expect(prepareUpload).not.toHaveBeenCalled();
  });

  it("지문이 안 맞는 압축본(다른 원본·올릴 때 적은 해시와 다른 내용)은 성공으로 치지 않는다", async () => {
    const { v, c } = await files();
    for (const bad of [{ aywaSourceMd5: "other" }, { aywaUploadMd5: "other" }, { aywaSourceBytes: "999" }]) {
      const remote = remoteOf(v, c); Object.assign(remote.properties, bad);
      const fetchImpl = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json(remote));
      await expect(uploadVideoToDrive(v, folderId, options(fetchImpl, { existingFileId: "file1234567" }))).rejects.toThrow("원본과 다릅니다");
    }
  });

  it("압축본이 바뀌면(다시 만듦) 지난 전송 세션을 버리고, 같으면 이어서 보낸다", async () => {
    const { v, c } = await files(); const remote = remoteOf(v, c);
    const statePath = `${v.filePath}.drive-state.json`;
    const tail = (f) => f.mockResolvedValueOnce(new Response(null, { status: 308 })).mockResolvedValueOnce(json(remote, 201)).mockResolvedValueOnce(json(remote));
    await writeFile(statePath, JSON.stringify({ folderId, md5: v.md5, sourceKey: "classnote:12:34", fileId: "file123", session, uploadMd5: "old" }));
    const fresh = tail(vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [] })).mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(new Response(null, { headers: { location: session } })));
    expect((await uploadVideoToDrive(v, folderId, options(fresh, { prepareUpload: async () => c }))).status).toBe("uploaded");
    expect(fresh.mock.calls[3][1].method).toBe("POST"); // 새 세션
    await writeFile(statePath, JSON.stringify({ folderId, md5: v.md5, sourceKey: "classnote:12:34", fileId: "file123", session, uploadMd5: c.md5 }));
    const resume = tail(vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [] })).mockResolvedValueOnce(json({}, 404)));
    expect((await uploadVideoToDrive(v, folderId, options(resume, { prepareUpload: async () => c }))).status).toBe("uploaded");
    expect(resume.mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
  });

  it("압축하지 않기로 했으면(절감 부족) 원본을 보내고 그 판단만 표시한다", async () => {
    const { v } = await files(); const remote = { ...remoteOf(v, v), properties: { aywaCompressed: "kept-savings" } };
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ ids: ["file123"] })).mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(new Response(null, { headers: { location: session } }))
      .mockResolvedValueOnce(new Response(null, { status: 308 }))
      .mockResolvedValueOnce(json(remote, 201)).mockResolvedValueOnce(json(remote));
    const saved = await uploadVideoToDrive(v, folderId, options(fetchImpl, { prepareUpload: async () => ({ marker: "kept-savings" }) }));
    expect(saved).toMatchObject({ status: "uploaded", bytes: 1024, compression: "kept-savings" });
    const props = JSON.parse(fetchImpl.mock.calls[4][1].body).properties;
    expect(props).toMatchObject({ aywaUploadMd5: v.md5, aywaUploadBytes: "1024", aywaCompressed: "kept-savings" });
  });
});

describe("인증 방식이 바뀌어도(앱 비공개 속성이 안 보임) 압축본을 알아본다", () => {
  it("appProperties가 비어 있어도 공개 properties의 지문으로 같은 원본의 압축본을 인정한다", async () => {
    const { v, c } = await files(); const remote = { ...remoteOf(v, c), appProperties: undefined };
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json(remote));
    expect((await uploadVideoToDrive(v, folderId, options(fetchImpl, { existingFileId: "file1234567" }))).status).toBe("already-uploaded");
    expect(fetchImpl.mock.calls[1][0]).toContain("properties");
  });
});
