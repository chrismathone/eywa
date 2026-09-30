import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileDigests } from "./video-download.mjs";
import { checkDriveFolder, uploadVideoToDrive } from "./video-drive.mjs";

const dirs = [];
const folderId = "folder123456";
const session = "https://www.googleapis.com/upload/drive/v3/files?upload_id=test";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const folder = { id: folderId, mimeType: "application/vnd.google-apps.folder", driveId: "shared", capabilities: { canAddChildren: true } };
async function video() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aywa-drive-test-")); dirs.push(dir);
  const filePath = path.join(dir, "video.mp4"); await writeFile(filePath, Buffer.alloc(1024, 7));
  return { filePath, centerId: "12", videoId: "34", name: "video.mp4", ...await fileDigests(filePath) };
}
const remote = (v) => ({ id: "file123", name: v.name, size: String(v.bytes), md5Checksum: v.md5, parents: [folderId], webViewLink: "https://drive.google.com/file/d/file123/view" });
const options = (fetchImpl) => ({ kind: "service-account", accessToken: async () => "test-only", fetchImpl, sleep: async () => {} });
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("클래스노트 Drive 업로드", () => {
  it("다른 PC가 같은 내용으로 예약한 파일 ID를 채택하고 이미 완료됐으면 재전송하지 않는다", async () => {
    const v = await video();
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ ids: ["losingFile123"] })).mockResolvedValueOnce(json(remote(v)));
    const reserve = vi.fn().mockResolvedValue("file123");
    expect((await uploadVideoToDrive(v, folderId, { ...options(fetchImpl), fileRegistry: { reserve } })).status).toBe("already-uploaded");
    expect(reserve).toHaveBeenCalledWith(folderId, v, "losingFile123");
    expect(fetchImpl.mock.calls.at(-1)[0]).toContain("/files/file123?");
    expect(fetchImpl.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
  it("서비스계정의 개인 폴더·쓰기 불가 폴더는 전송 전에 거절한다", async () => {
    await expect(checkDriveFolder(folderId, options(async () => json({ ...folder, driveId: undefined })))).rejects.toThrow("OAuth");
    await expect(checkDriveFolder(folderId, options(async () => json({ ...folder, capabilities: {} })))).rejects.toThrow("권한");
  });
  it("같은 영상이 있으면 위치·해시를 검증하고 업로드를 건너뛴다", async () => {
    const v = await video(); const fetchImpl = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [remote(v)] }));
    expect((await uploadVideoToDrive(v, folderId, options(fetchImpl))).status).toBe("already-uploaded");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("업로드 성공 후 Drive의 실제 크기·해시를 검증한다", async () => {
    const v = await video();
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ ids: ["file123"] })).mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(new Response(null, { headers: { location: session } }))
      .mockResolvedValueOnce(new Response(null, { status: 308 }))
      .mockResolvedValueOnce(json(remote(v), 201)).mockResolvedValueOnce(json(remote(v)));
    expect((await uploadVideoToDrive(v, folderId, options(fetchImpl))).status).toBe("uploaded");
    const upload = fetchImpl.mock.calls[6][1];
    expect(upload.headers["Content-Range"]).toBe("bytes 0-1023/1024");
    expect(upload.body.byteLength).toBe(1024);
    expect(JSON.parse(await readFile(`${v.filePath}.drive-state.json`, "utf8"))).toMatchObject({ fileId: "file123", completed: true, session: null });
  });
  it("전송 중 연결이 끊겨도 서버가 받은 바이트 뒤부터 다시 보낸다", async () => {
    const v = await video();
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ ids: ["file123"] })).mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(new Response(null, { headers: { location: session } }))
      .mockResolvedValueOnce(new Response(null, { status: 308 })).mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response(null, { status: 308, headers: { range: "bytes=0-511" } }))
      .mockResolvedValueOnce(json(remote(v), 201)).mockResolvedValueOnce(json(remote(v)));
    expect((await uploadVideoToDrive(v, folderId, options(fetchImpl))).status).toBe("uploaded");
    expect(fetchImpl.mock.calls[8][1].headers["Content-Range"]).toBe("bytes 512-1023/1024");
  });
  it("전송 응답을 잃은 뒤 재실행해도 미리 발급한 ID로 완료 파일을 찾는다", async () => {
    const v = await video();
    await writeFile(`${v.filePath}.drive-state.json`, JSON.stringify({ folderId, md5: v.md5, sourceKey: "classnote:12:34", fileId: "file123", session }));
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [] })).mockResolvedValueOnce(json(remote(v)));
    expect((await uploadVideoToDrive(v, folderId, options(fetchImpl))).status).toBe("already-uploaded");
    expect(fetchImpl.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
  it("원본과 다른 파일이나 중복 파일을 성공으로 처리하지 않는다", async () => {
    const v = await video();
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [{ ...remote(v), md5Checksum: "bad" }] }));
    await expect(uploadVideoToDrive(v, folderId, options(fetchImpl))).rejects.toThrow("원본과 다릅니다");
  });
  it("서버가 같은 위치만 반복하면 무한 전송하지 않고 작업을 보존한다", async () => {
    const v = await video();
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(folder)).mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ ids: ["file123"] })).mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(new Response(null, { headers: { location: session } }))
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 308 })));
    await expect(uploadVideoToDrive(v, folderId, options(fetchImpl))).rejects.toThrow("진행되지 않아");
    expect(fetchImpl.mock.calls.length).toBeLessThan(20);
    expect(JSON.parse(await readFile(`${v.filePath}.drive-state.json`, "utf8"))).toMatchObject({ fileId: "file123", session });
  });
});
