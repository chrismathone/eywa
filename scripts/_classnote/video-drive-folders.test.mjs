import { mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureTeacherFolder } from "./video-drive-folders.mjs";

const dirs = [];
const rootId = "rootfolder123";
const route = { tenantId: "12345678-1234-1234-1234-123456789abc", teacherId: "abcdef12-1234-1234-1234-123456789abc", folderName: "김담임 선생님" };
const key = `${route.tenantId}:12:${route.teacherId}`;
const folder = { id: "teacherfolder123", name: route.folderName, mimeType: "application/vnd.google-apps.folder",
  parents: [rootId], appProperties: { aywaTeacher: key }, capabilities: { canAddChildren: true } };
const root = { ...folder, id: rootId, driveId: "shared" };
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
const options = (fetchImpl) => ({ kind: "service-account", accessToken: async () => "test-only", fetchImpl });
async function dir() { const p = await mkdtemp(path.join(os.tmpdir(), "aywa-folder-test-")); dirs.push(p); return p; }
afterEach(async () => { for (const p of dirs.splice(0)) await rm(p, { recursive: true, force: true }); });

describe("담임별 Drive 폴더", () => {
  it("기존에 연결한 폴더는 자동 생성 표식 없이도 확정 ID와 부모를 검증해 재사용한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(root)).mockResolvedValueOnce(json({ ...folder, appProperties: {} }));
    const reserve = vi.fn().mockResolvedValue(folder.id);
    expect((await ensureTeacherFolder(rootId, route, "12", await dir(), { ...options(fetchImpl), teacherFolders: { [key]: folder.id }, folderRegistry: { reserve } })).id).toBe(folder.id);
    expect(reserve).toHaveBeenCalledWith(key, folder.id);
    expect(fetchImpl.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
  it("다른 PC가 먼저 선점한 폴더 번호로 생성하여 중복을 막는다", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(root)).mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ ids: ["losingFolder123"] })).mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ id: folder.id }, 201)).mockResolvedValueOnce(json(folder));
    const registry = { find: async () => null, reserve: async () => folder.id };
    await ensureTeacherFolder(rootId, route, "12", await dir(), { ...options(fetchImpl), folderRegistry: registry });
    expect(JSON.parse(fetchImpl.mock.calls[4][1].body).id).toBe(folder.id);
  });
  it("이름이 바뀌어도 같은 담임 ID 폴더를 재사용한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(root)).mockResolvedValueOnce(json({ files: [folder] }));
    expect((await ensureTeacherFolder(rootId, { ...route, folderName: "개명한 선생님" }, "12", await dir(), options(fetchImpl))).id).toBe(folder.id);
    expect(fetchImpl.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
  it("폴더를 만들고 부모·담임 키·쓰기 권한을 다시 조회해 검증한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(root)).mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ ids: [folder.id] })).mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ id: folder.id }, 201)).mockResolvedValueOnce(json(folder));
    const stateDir = await dir();
    expect((await ensureTeacherFolder(rootId, route, "12", stateDir, options(fetchImpl))).id).toBe(folder.id);
    expect(JSON.parse(fetchImpl.mock.calls[4][1].body)).toMatchObject({ id: folder.id, parents: [rootId], appProperties: { aywaTeacher: key } });
    expect(JSON.parse(await readFile(path.join(stateDir, (await readdir(stateDir))[0]), "utf8")).completed).toBe(true);
  });
  it("폴더 생성 응답을 잃어도 같은 ID를 확인해 중복 생성하지 않는다", async () => {
    const stateDir = await dir();
    const first = vi.fn().mockResolvedValueOnce(json(root)).mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ ids: [folder.id] })).mockResolvedValueOnce(json({}, 404)).mockRejectedValueOnce(new Error("network"));
    await expect(ensureTeacherFolder(rootId, route, "12", stateDir, options(first))).rejects.toThrow("network");
    const next = vi.fn().mockResolvedValueOnce(json(root)).mockResolvedValueOnce(json({ files: [] })).mockResolvedValueOnce(json(folder));
    expect((await ensureTeacherFolder(rootId, route, "12", stateDir, options(next))).id).toBe(folder.id);
    expect(next.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
  it("중복 폴더·다른 부모·틀린 담당자·권한 없음은 저장 대상으로 사용하지 않는다", async () => {
    const duplicate = vi.fn().mockResolvedValueOnce(json(root)).mockResolvedValueOnce(json({ files: [folder, folder] }));
    await expect(ensureTeacherFolder(rootId, route, "12", await dir(), options(duplicate))).rejects.toThrow("여러 개");
    for (const change of [{ parents: ["other"] }, { appProperties: { aywaTeacher: "other" } }, { capabilities: {} }]) {
      const fetchImpl = vi.fn().mockResolvedValueOnce(json(root)).mockResolvedValueOnce(json({ files: [{ ...folder, ...change }] }));
      await expect(ensureTeacherFolder(rootId, route, "12", await dir(), options(fetchImpl))).rejects.toThrow("확인해야");
    }
  });
});
