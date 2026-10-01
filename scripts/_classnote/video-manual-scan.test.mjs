// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetManualDriveScanTimer, runManualDriveScan, scanManualDriveVideos } from "./video-manual-scan.mjs";

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const ROOT = "rootFolder0001";
const TEACHER = "7ac89726-d36f-46e4-8174-6bbddbd7f378";
const STUDENT = "11111111-1111-4111-8111-111111111111";
const CLASS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOLDER = "teacherFolder01";
const HOLD = "holdFolder00001";
const HANDMADE = "handMadeFolder1"; // 사람이 만든 폴더(등록부에 없음)
const TRASHED = "trashedFolder01"; // 등록부에 있지만 휴지통
const MOVED = "movedFolder0001"; // 등록부에 있지만 루트 밖으로 옮겨짐
const NOW = new Date("2026-10-01T06:00:00Z");

const file = (id, name, extra = {}) => ({ id, name, mimeType: "video/mp4", size: "1000", md5Checksum: `${id.padEnd(32, "0").slice(0, 32).replace(/[^0-9a-f]/g, "a")}`,
  createdTime: "2026-10-01T01:00:00Z", ...extra });

/** Drive 목 — GET(목록·한 건 조회)만 받는다. 다른 요청(쓰기)이 오면 테스트가 실패한다. */
function drive(folders, { rootFolders = [{ id: FOLDER, name: "이수진 선생님" }, { id: HOLD, name: "담임 확인 필요" }] } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? "GET" });
    if ((options.method ?? "GET") !== "GET") throw new Error("Drive 쓰기 요청 금지");
    const q = new URL(url).searchParams.get("q");
    if (!q) { // files.get — 루트에서 빠진 등록부 폴더 확인
      const id = new URL(url).pathname.split("/").pop();
      if (id === TRASHED) return Response.json({ id, trashed: true });
      if (id === MOVED) return Response.json({ id, trashed: false });
      if (id === "goneHandMade1") return new Response("{}", { status: 404 });
      return new Response("{}", { status: 404 });
    }
    if (q.startsWith(`'${ROOT}' in parents`)) return Response.json({ files: rootFolders });
    const id = /^'([^']+)'/.exec(q)[1];
    if (!(id in folders)) return new Response("{}", { status: 404 });
    return Response.json({ files: folders[id] });
  };
  return { auth: { accessToken: async () => "token", fetchImpl }, calls };
}

/** sql 목 — 질의문으로 갈라 답하고, 쓰기는 기록한다. */
function db({ rows = [], workerFiles = [], duplicates = [], registry = [], shared = false } = {}) {
  const writes = [];
  const sql = async (parts, ...args) => {
    const q = parts.join("?");
    if (q.includes("information_schema.columns")) return [{ n: 2 }];
    if (q.includes("from classnote_video_folders") && q.includes("tenant_id <>")) return [{ shared }];
    if (q.includes("from classnote_video_folders")) return [
      { route_key: `${TENANT}:96575:${TEACHER}`, drive_folder_id: FOLDER },
      { route_key: `${TENANT}:96575:unassigned`, drive_folder_id: HOLD },
      { route_key: `other-tenant:96575:${TEACHER}`, drive_folder_id: "otherFolder001" },
      ...registry,
    ];
    if (q.includes("from users")) return [{ id: TEACHER }];
    if (q.includes("from classnote_video_files")) return workerFiles.map((id) => ({ drive_file_id: id }));
    if (q.includes("select id, source_ref, status")) return rows;
    if (q.includes("from students")) return [{ id: STUDENT, name: "류태경", school: "칠성초", grade: "3", status: "enrolled" }];
    if (q.includes("from enrollments")) return [{ student_id: STUDENT, class_id: CLASS, class_name: "LT4", subject: "english",
      teacher_id: TEACHER, start_date: "2026-03-01", end_date: null }];
    if (q.includes("md5 = ?") && q.includes("as class_id")) return duplicates;
    if (q.startsWith("insert into student_homework_videos")) { writes.push({ kind: "upsert", args }); return []; }
    if (q.startsWith("update student_homework_videos d")) return [];
    if (q.startsWith("delete from student_homework_videos")) { writes.push({ kind: "delete", ids: args[1] }); return args[1].map((id) => ({ id })); }
    throw new Error(`예상 밖 질의: ${q.slice(0, 60)}`);
  };
  sql.json = (value) => value;
  sql.end = async () => {};
  return { sql, writes };
}
const upserted = (writes) => writes.filter((w) => w.kind === "upsert").map((w) => ({ fileId: w.args[1], studentId: w.args[2],
  teacherId: w.args[4], status: w.args[6], route: w.args[11] }));
const quiet = { log: () => {} };

beforeEach(() => resetManualDriveScanTimer());

describe("담임 폴더 직접 업로드 훑기", () => {
  it("워커가 올린 파일은 건너뛰고, 사람이 올린 파일만 이름으로 붙인다(Drive는 목록 조회만)", async () => {
    const { auth, calls } = drive({
      [FOLDER]: [file("workerFile0001", "류태경_LT4_칠성초3_2026-09-29.mp4", { appProperties: { aywaSource: "classnote:1:2" } }),
        file("registered0001", "류태경_LT4_칠성초3_2026-09-28.mp4"),
        file("manualFile0001", "류태경_LT4_칠성초3_2026-09-30.mp4")],
      [HOLD]: [file("manualFile0002", "엉뚱한 이름.mp4")],
    });
    const { sql, writes } = db({ workerFiles: ["registered0001"] });
    const result = await scanManualDriveVideos(sql, TENANT, { rootId: ROOT, auth, now: NOW, ...quiet });
    expect(result).toMatchObject({ linked: 1, review: 1, removed: 0 });
    expect(upserted(writes)).toEqual([
      expect.objectContaining({ fileId: "manualFile0001", studentId: STUDENT, teacherId: TEACHER, status: "uploaded",
        route: expect.objectContaining({ classId: CLASS, folderName: "이수진 선생님", source: "drive" }) }),
      expect.objectContaining({ fileId: "manualFile0002", studentId: null, teacherId: null, status: "review" }),
    ]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.some((c) => c.url.includes("otherFolder001"))).toBe(false); // 남의 지점 폴더는 보지 않는다
  });

  it("이름·폴더가 그대로인 연결 행은 다시 쓰지 않고, 확인 필요 행은 결과가 같으면 조용하다", async () => {
    const name = "류태경_LT4_칠성초3_2026-09-30.mp4";
    const bad = "엉뚱한 이름.mp4";
    const { auth } = drive({ [FOLDER]: [file("manualFile0001", name)], [HOLD]: [file("manualFile0002", bad)] });
    const { sql, writes } = db({ rows: [
      { id: "r1", source_ref: "manualFile0001", status: "uploaded", student_id: STUDENT, drive_folder_id: FOLDER, route: { fileName: name } },
      { id: "r2", source_ref: "manualFile0002", status: "review", student_id: null, drive_folder_id: HOLD,
        route: { fileName: bad, classId: null, reason: "파일 이름이 ‘학생_반_학교학년_날짜’ 네 칸이 아닙니다.", duplicateOf: null } },
    ] });
    const log = vi.fn();
    expect(await scanManualDriveVideos(sql, TENANT, { rootId: ROOT, auth, now: NOW, log })).toMatchObject({ linked: 0, review: 0, removed: 0 });
    expect(writes).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it("이름을 고치면 다시 판정하고, 폴더에서 사라진 파일의 행은 지운다", async () => {
    const { auth } = drive({ [FOLDER]: [file("manualFile0002", "류태경_LT4_칠성초3_2026-09-30.mp4")], [HOLD]: [] });
    const { sql, writes } = db({ rows: [
      { id: "r-gone", source_ref: "deletedFile001", status: "uploaded", student_id: STUDENT, drive_folder_id: FOLDER, route: {} },
      // 이번에 못 본 폴더(루트 밖으로 옮겨진 등록부 폴더)의 행은 사라진 게 아니다
      { id: "r-elsewhere", source_ref: "movedFolderF1", status: "uploaded", student_id: STUDENT, drive_folder_id: MOVED, route: {} },
      { id: "r2", source_ref: "manualFile0002", status: "review", student_id: null, drive_folder_id: HOLD, route: { fileName: "엉뚱한 이름.mp4" } },
    ] });
    expect(await scanManualDriveVideos(sql, TENANT, { rootId: ROOT, auth, now: NOW, ...quiet })).toMatchObject({ linked: 1, removed: 1 });
    expect(writes.find((w) => w.kind === "delete").ids).toEqual(["r-gone"]);
  });

  it("같은 내용이 이미 보관돼 있으면 세지 않는다 · 양식 이전의 옛 파일은 목록에 올리지 않는다", async () => {
    const { auth } = drive({ [FOLDER]: [file("manualFile0001", "류태경_LT4_칠성초3_2026-09-30.mp4"),
      file("legacyFile0001", "LT4 류태경.mp4", { createdTime: "2026-09-17T03:00:00Z" })], [HOLD]: [] });
    const { sql, writes } = db({ duplicates: [{ id: "classnote-row", student_id: STUDENT, class_id: CLASS }] });
    expect(await scanManualDriveVideos(sql, TENANT, { rootId: ROOT, auth, now: NOW, ...quiet })).toMatchObject({ linked: 0, review: 1, ignored: 1 });
    expect(upserted(writes)).toEqual([expect.objectContaining({ fileId: "manualFile0001", status: "review", studentId: null,
      route: expect.objectContaining({ duplicateOf: "classnote-row", classId: null }) })]);
  });

  it("사람이 만든 폴더도 읽고(담임 없음) · 휴지통에 간 등록부 폴더의 행은 정리 · 루트 밖으로 옮겨진 폴더의 행은 둔다", async () => {
    const { auth } = drive({ [FOLDER]: [], [HOLD]: [], [HANDMADE]: [file("manualFile0003", "류태경_LT4_칠성초3_2026-09-30.mp4")] },
      { rootFolders: [{ id: FOLDER, name: "이수진 선생님" }, { id: HOLD, name: "담임 확인 필요" }, { id: HANDMADE, name: "김새로 선생님" }] });
    const { sql, writes } = db({
      registry: [{ route_key: `${TENANT}:96575:${TEACHER}`, drive_folder_id: TRASHED }, { route_key: `${TENANT}:96575:${TEACHER}`, drive_folder_id: MOVED }],
      rows: [
        { id: "r-trashed", source_ref: "inTrashedF001", status: "uploaded", student_id: STUDENT, drive_folder_id: TRASHED, route: {} },
        { id: "r-moved", source_ref: "inMovedF00001", status: "uploaded", student_id: STUDENT, drive_folder_id: MOVED, route: {} },
      ],
    });
    expect(await scanManualDriveVideos(sql, TENANT, { rootId: ROOT, auth, now: NOW, ...quiet })).toMatchObject({ linked: 1, removed: 1 });
    expect(upserted(writes)).toEqual([expect.objectContaining({ fileId: "manualFile0003", studentId: STUDENT, teacherId: null, status: "uploaded",
      route: expect.objectContaining({ folderName: "김새로 선생님" }) })]);
    expect(writes.find((w) => w.kind === "delete").ids).toEqual(["r-trashed"]);
  });

  it("다른 지점 워커의 폴더는 읽지 않고, 영상 루트를 다른 지점과 함께 쓰면 등록부 밖 폴더도 읽지 않는다 · 사라진 손 폴더의 행은 정리", async () => {
    const rootFolders = [{ id: FOLDER, name: "이수진 선생님" }, { id: HOLD, name: "담임 확인 필요" },
      { id: "otherTenantF01", name: "남의 지점 선생님", appProperties: { aywaTeacher: "other-tenant:1:x" } },
      { id: HANDMADE, name: "김새로 선생님" }];
    const folders = { [FOLDER]: [], [HOLD]: [], [HANDMADE]: [file("manualFile0003", "류태경_LT4_칠성초3_2026-09-30.mp4")] };
    const run = async (shared) => {
      const { auth, calls } = drive(folders, { rootFolders });
      const { sql, writes } = db({ shared, rows: [{ id: "r-hand", source_ref: "inGoneHand01", status: "uploaded", student_id: STUDENT,
        drive_folder_id: "goneHandMade1", route: {} }] });
      const result = await scanManualDriveVideos(sql, TENANT, { rootId: ROOT, auth, now: NOW, ...quiet });
      return { result, writes, calls };
    };
    const alone = await run(false);
    expect(alone.calls.some((c) => c.url.includes("otherTenantF01"))).toBe(false);
    expect(alone.result).toMatchObject({ linked: 1, removed: 1 });
    expect(alone.writes.find((w) => w.kind === "delete").ids).toEqual(["r-hand"]);
    const shared = await run(true);
    expect(shared.calls.some((c) => c.url.includes(HANDMADE) || c.url.includes("otherTenantF01"))).toBe(false);
    expect(shared.result).toMatchObject({ linked: 0, removed: 1 });
  });

  it("폴더 하나라도 못 읽으면 아무것도 지우지 않고 멈춘다 · 진입점은 던지지 않고 같은 사유는 한 번만 알린다", async () => {
    const { auth } = drive({ [FOLDER]: [] }); // 담임 확인 필요 폴더 404
    const { sql, writes } = db({ rows: [{ id: "r1", source_ref: "manualFile0001", status: "uploaded", student_id: STUDENT, drive_folder_id: HOLD, route: {} }] });
    await expect(scanManualDriveVideos(sql, TENANT, { rootId: ROOT, auth, now: NOW, ...quiet })).rejects.toThrow("HTTP 404");
    expect(writes).toEqual([]);
    const log = vi.fn();
    const run = (now) => runManualDriveScan(TENANT, { log, now, rootId: ROOT, authFactory: async () => auth, sqlFactory: () => sql });
    expect(await run(1)).toBeNull();
    expect(await run(2)).toBeNull(); // 10분 안 — 훑지 않는다
    expect(await run(1 + 10 * 60_000)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("[영상 직접 제출] 폴더 확인 실패");
  });

  it("0324a 전 DB에서는 Drive를 부르지 않고 한 번만 알린다", async () => {
    const { sql } = db();
    const ready = async (parts, ...args) => (parts.join("?").includes("information_schema") ? [{ n: 0 }] : sql(parts, ...args));
    ready.end = async () => {};
    const authFactory = vi.fn();
    const log = vi.fn();
    await runManualDriveScan(TENANT, { log, now: 1, rootId: ROOT, authFactory, sqlFactory: () => ready });
    await runManualDriveScan(TENANT, { log, now: 1 + 10 * 60_000, rootId: ROOT, authFactory, sqlFactory: () => ready });
    expect(authFactory).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("0324a 적용 전");
  });
});
