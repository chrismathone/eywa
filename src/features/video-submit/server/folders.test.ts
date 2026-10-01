import { describe, expect, it, vi } from "vitest";
import { ensureLinkTeacherFolder, type FolderRegistry } from "./folders";

const ROOT = "ROOT_FOLDER_123";
const KEY = "11111111-1111-4111-8111-111111111111:96575:22222222-2222-4222-8222-222222222222";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const folder = (id: string, appProperties: Record<string, string> = { aywaTeacher: KEY }) =>
  ({ id, mimeType: FOLDER_MIME, parents: [ROOT], trashed: false, appProperties, capabilities: { canAddChildren: true } });

/** 메모리 Drive — 만든 폴더를 기억한다. 409 = 같은 번호가 이미 있음. */
function drive(initial: Record<string, ReturnType<typeof folder>> = {}, search: unknown[] = []) {
  const files: Record<string, unknown> = { [ROOT]: { ...folder(ROOT, {}), parents: ["x"] }, ...initial };
  const calls: string[] = [];
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
    const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes("/files/generateIds")) return ok({ ids: ["GENERATED_ID_1"] });
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (files[body.id]) return ok({}, 409);
      files[body.id] = { ...folder(body.id, body.appProperties), name: body.name };
      return ok({ id: body.id });
    }
    if (/\/files\?/.test(url)) return ok({ files: search });
    const id = /\/files\/([^?]+)\?/.exec(url)![1]!;
    return files[id] ? ok(files[id]) : ok({}, 404);
  });
  return { request, files, calls };
}
function registry(initial: Record<string, string> = {}, winner?: string): FolderRegistry & { rows: Record<string, string> } {
  const rows = { ...initial };
  return {
    rows,
    find: async (key) => rows[key] ?? null,
    reserve: async (key, id) => (rows[key] ??= winner ?? id),
  };
}

describe("담임 폴더 — 워커와 같은 등록부·같은 표식", () => {
  it("등록부에 있으면 그 폴더(새로 만들지 않는다)", async () => {
    const d = drive({ EXISTING_FOLDER: folder("EXISTING_FOLDER") });
    const r = await ensureLinkTeacherFolder({ request: d.request, registry: registry({ [KEY]: "EXISTING_FOLDER" }), rootId: ROOT, key: KEY, folderName: "이수진 선생님" });
    expect(r.id).toBe("EXISTING_FOLDER");
    expect(d.calls.some((c) => c.startsWith("POST"))).toBe(false);
  });
  it("사람이 연결해 둔 폴더(표식 없음)도 등록부에 있으면 쓴다", async () => {
    const d = drive({ MANUAL_FOLDER_1: folder("MANUAL_FOLDER_1", {}) });
    const r = await ensureLinkTeacherFolder({ request: d.request, registry: registry({ [KEY]: "MANUAL_FOLDER_1" }), rootId: ROOT, key: KEY, folderName: "x" });
    expect(r.id).toBe("MANUAL_FOLDER_1");
  });
  it("없으면 번호를 먼저 등록부에 선점하고 그 번호로 표식을 붙여 만든다", async () => {
    const d = drive();
    const reg = registry();
    const r = await ensureLinkTeacherFolder({ request: d.request, registry: reg, rootId: ROOT, key: KEY, folderName: "이수진 선생님" });
    expect(r.id).toBe("GENERATED_ID_1");
    expect(reg.rows[KEY]).toBe("GENERATED_ID_1");
    expect(d.files.GENERATED_ID_1).toMatchObject({ name: "이수진 선생님", appProperties: { aywaTeacher: KEY }, parents: [ROOT] });
  });
  it("워커가 같은 순간 먼저 선점했으면 그 번호로 모인다(폴더 둘이 생기지 않는다)", async () => {
    const d = drive();
    const reg = registry({}, "WORKER_FOLDER_ID");
    const r = await ensureLinkTeacherFolder({ request: d.request, registry: reg, rootId: ROOT, key: KEY, folderName: "이수진 선생님" });
    expect(r.id).toBe("WORKER_FOLDER_ID");
    expect(Object.keys(d.files).filter((id) => id !== ROOT)).toEqual(["WORKER_FOLDER_ID"]);
  });
  it("워커가 이미 그 번호로 만들었으면(409) 그대로 확인만 한다", async () => {
    const d = drive({ RESERVED_ID_01: folder("RESERVED_ID_01") });
    const reg = registry({ [KEY]: "RESERVED_ID_01" });
    expect((await ensureLinkTeacherFolder({ request: d.request, registry: reg, rootId: ROOT, key: KEY, folderName: "x" })).id).toBe("RESERVED_ID_01");
  });
  it("다른 담임 표식·다른 위치·휴지통 폴더는 쓰지 않는다", async () => {
    const wrong = { ...folder("WRONG_FOLDER_1"), appProperties: { aywaTeacher: "other" } };
    const d = drive({ WRONG_FOLDER_1: wrong as ReturnType<typeof folder> });
    await expect(ensureLinkTeacherFolder({ request: d.request, registry: registry({ [KEY]: "WRONG_FOLDER_1" }), rootId: ROOT, key: KEY, folderName: "x" }))
      .rejects.toThrow("담임 폴더");
  });
  it("표식 붙은 폴더가 등록부 밖에 둘이면 사람이 봐야 한다", async () => {
    const d = drive({}, [folder("A_FOLDER_0001"), folder("B_FOLDER_0001")]);
    await expect(ensureLinkTeacherFolder({ request: d.request, registry: registry(), rootId: ROOT, key: KEY, folderName: "x" })).rejects.toThrow("여러 개");
  });
});
