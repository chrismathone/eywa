import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: null as unknown, video: null as unknown, error: null as unknown, allowed: true,
  student: null as unknown, states: {} as Record<string, unknown>, credential: null as unknown,
  reads: [] as unknown[][], userArgs: [] as unknown[], scopeArgs: [] as unknown[], token: vi.fn(), fetch: vi.fn(), pinned: vi.fn(), thread: vi.fn(), detail: vi.fn(), level: "full", scope: ["class-a"], linked: { route: { classId: "class-a" } } as unknown }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async (options?: unknown) => { m.userArgs.push(options); return m.user; } }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => m.allowed, accessLevelTenant: async () => m.level }));
vi.mock("./read-scope", () => ({ teacherViewableClassIds: async (id: unknown) => { m.scopeArgs.push(id); return m.scope; } }));
vi.mock("@/features/video-homework/server/video-source", () => ({ homeworkVideoSource: async () => "homework_video_ledger_videos" }));
vi.mock("./queries", () => ({ getStudentById: m.detail }));
vi.mock("@/features/classnote-reply/server/video-poll", () => ({ getThreadVideoStates: m.thread }));
vi.mock("@/features/video-submit/server/drive-credentials", () => ({ readPinnedVideoDriveCredential: m.pinned }));
vi.mock("@/features/video-submit/server/drive-api", () => ({ DRIVE_API: "https://www.googleapis.com/drive/v3" }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  m.reads.push(["from", table]); const q: Record<string, unknown> = {};
  for (const name of ["select", "eq"]) q[name] = (...args: unknown[]) => { m.reads.push([name, ...args]); return q; };
  q.maybeSingle = async () => ({ data: table === "homework_video_ledger_videos" ? m.linked : m.video, error: m.error }); return q;
} }) }));

import { streamHomeworkVideo, videoByteRange } from "./homework-video-stream";
const ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222222";
const ROOT = "owned_root_folder123";
const FILE = "owned_video_file123";
const request = (range?: string, query = "") => new Request(`https://aywa.test/api/homework-videos/${ID}/stream${query}`, { headers: range ? { range } : {} });
const upstream = () => new Response("abcd", { status: 206, headers: { "content-type": "video/mp4", "content-length": "4", "content-range": "bytes 0-3/12" } });
beforeEach(() => {
  vi.clearAllMocks(); m.reads = []; m.userArgs = []; m.scopeArgs = []; m.error = null; m.allowed = true; m.level = "full"; m.scope = ["class-a"]; m.linked = { route: { classId: "class-a" } };
  m.user = { tenantId: "tenant-a", systemRole: "teacher" }; m.student = { id: "student-a" }; m.states = {};
  m.video = { student_id: "student-a", status: "uploaded", drive_file_id: FILE, route: { rootId: ROOT, connectionId: null } };
  m.token.mockResolvedValue("secret-token"); m.credential = { status: "ready", accessToken: m.token };
  m.pinned.mockImplementation(async () => m.credential); m.detail.mockImplementation(async () => m.student); m.thread.mockImplementation(async () => m.states);
  m.fetch.mockImplementation(async () => upstream()); vi.stubGlobal("fetch", m.fetch);
});

it.each([null, "bytes=0-", "bytes=0-99999999"])("bounded streaming range %s", value => {
  expect(videoByteRange(value)).toBe("bytes=0-2097151");
});
it.each(["bytes=5-9", "bytes=-12", "bytes=900-900"])("preserves seek and suffix ranges %s", value => expect(videoByteRange(value)).toBe(value));
it.each(["bytes=-", "bytes=5-2", "bytes=0-2,4-6", "bytes=-99999999", "bytes=-0", "bytes=9007199254740992-", "bytes=9007199254740991-", "items=0-2", "bytes=1-NaN"])("rejects malformed/excessive ranges %s", value => expect(videoByteRange(value)).toBeNull());
it("streams the original range with session/tenant/student gates and pinned credentials; never sends the token", async () => {
  const response = await streamHomeworkVideo(request("bytes=0-3"), ID);
  expect(response.status).toBe(206); expect(await response.text()).toBe("abcd");
  expect(response.headers.get("content-range")).toBe("bytes 0-3/12"); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("accept-ranges")).toBe("bytes"); expect(response.headers.get("authorization")).toBeNull();
  expect(m.reads).toContainEqual(["eq", "tenant_id", "tenant-a"]); expect(m.reads).toContainEqual(["eq", "id", ID]);
  expect(m.detail).toHaveBeenCalledWith("student-a"); expect(m.pinned).toHaveBeenCalledWith(expect.anything(), "tenant-a", ROOT, null);
  expect(m.fetch).toHaveBeenCalledWith(`https://www.googleapis.com/drive/v3/files/${FILE}?alt=media&supportsAllDrives=true`, expect.objectContaining({ cache: "no-store", redirect: "error", headers: { Authorization: "Bearer secret-token", Range: "bytes=0-3" } }));
});
it.each([null, { systemRole: "student", tenantId: "tenant-a" }])("no session or student role cannot request server Drive bytes", async user => {
  m.user = user; expect((await streamHomeworkVideo(request(), ID)).status).toBe(401); expect(m.reads).toEqual([]); expect(m.pinned).not.toHaveBeenCalled();
});
it("blocked menu / another teacher's student cannot reach Drive", async () => {
  m.allowed = false; expect((await streamHomeworkVideo(request(), ID)).status).toBe(403); expect(m.reads).toEqual([]);
  m.allowed = true; m.student = null; expect((await streamHomeworkVideo(request(), ID)).status).toBe(403); expect(m.pinned).not.toHaveBeenCalled();
});
it("a scoped teacher cannot read this student's other subject video; manual ledger mapping uses the same class scope", async () => {
  m.level = "scoped"; m.linked = { route: { classId: "class-other-subject" } };
  expect((await streamHomeworkVideo(request(), ID)).status).toBe(403); expect(m.pinned).not.toHaveBeenCalled();
  m.linked = { route: { classId: "class-a" } }; expect((await streamHomeworkVideo(request(), ID)).status).toBe(206);
  expect(m.reads).toContainEqual(["from", "homework_video_ledger_videos"]);
  m.linked = null; expect((await streamHomeworkVideo(request(), ID)).status).toBe(403);
});
it("teacher view: the viewer is the validated target teacher, and that teacher's classes decide (2026-11-05)", async () => {
  // 관리자가 '다른 강사 뷰'로 강사 X를 열면 getCurrentUser({ teacherView: true })가 X를 준다 — 담당 반도 X의 것으로 묻는다.
  m.user = { id: "teacher-x", tenantId: "tenant-a", systemRole: "teacher" };
  expect((await streamHomeworkVideo(request(), ID)).status).toBe(206);
  expect(m.userArgs).toEqual([{ teacherView: true }]);
  expect(m.scopeArgs).toEqual(["teacher-x"]);
  m.scope = ["class-of-the-real-admin"]; expect((await streamHomeworkVideo(request(), ID)).status).toBe(403);
});
it("full student-list access does not grant a teacher access to another class's video bytes", async () => {
  m.level = "full"; m.linked = { route: { classId: "another-class" } };
  expect((await streamHomeworkVideo(request(), ID)).status).toBe(403); expect(m.fetch).not.toHaveBeenCalled();
});
it("excluding from homework counts preserves the original class's permission to watch the video", async () => {
  m.video = { student_id: "s", status: "uploaded", drive_file_id: FILE, route: { rootId: ROOT, classId: "class-a" } };
  m.linked = { route: { classId: null, excluded: true } };
  expect((await streamHomeworkVideo(request(), ID)).status).toBe(206);
  m.scope = []; expect((await streamHomeworkVideo(request(), ID)).status).toBe(403);
});
it.each([null, { student_id: "s", status: "processing", drive_file_id: FILE }, { student_id: "s", status: "uploaded", drive_file_id: "//evil.test" }])("missing/unfinished/unsafe video cannot reach Drive", async video => {
  m.video = video; expect((await streamHomeworkVideo(request(), ID)).status).toBe(404); expect(m.pinned).not.toHaveBeenCalled();
});
it("cross-tenant video id lookup and invalid id produce no media", async () => {
  expect((await streamHomeworkVideo(request(), "../../evil")).status).toBe(404); expect(m.reads).toEqual([]);
  m.video = null; expect((await streamHomeworkVideo(request(), ID)).status).toBe(404); expect(m.fetch).not.toHaveBeenCalled();
});
it("unmatched video requires a permitted thread containing this exact playable video", async () => {
  m.video = { student_id: null, status: "uploaded", drive_file_id: FILE, route: { rootId: ROOT } };
  expect((await streamHomeworkVideo(request(), ID)).status).toBe(403);
  m.states = { [MESSAGE]: [{ id: "different", playable: true, links: {} }] };
  expect((await streamHomeworkVideo(request(undefined, `?messageId=${MESSAGE}`), ID)).status).toBe(403);
  m.states = { [MESSAGE]: [{ id: ID, playable: true, links: {} }] };
  expect((await streamHomeworkVideo(request(undefined, `?messageId=${MESSAGE}`), ID)).status).toBe(206);
  expect(m.thread).toHaveBeenCalledWith(MESSAGE); expect(m.detail).not.toHaveBeenCalled();
});
it("changed root/account or unavailable connection never falls back to other credentials", async () => {
  m.credential = null; expect((await streamHomeworkVideo(request(), ID)).status).toBe(503); expect(m.fetch).not.toHaveBeenCalled();
  m.credential = { status: "needs_reauth", accessToken: m.token }; expect((await streamHomeworkVideo(request(), ID)).status).toBe(503);
  m.video = { student_id: "s", status: "uploaded", drive_file_id: FILE, route: {} }; expect((await streamHomeworkVideo(request(), ID)).status).toBe(503);
});
it.each([200, 403, 404, 500])("rejects Google error/full-file response %s without exposing its body", async status => {
  m.fetch.mockResolvedValue(new Response("private Google details", { status }));
  const r = await streamHomeworkVideo(request(), ID); expect(r.status).toBe(status === 404 ? 404 : 502);
  expect(await r.text()).not.toContain("private");
});
it("passes an unsatisfiable range's total size", async () => {
  m.fetch.mockResolvedValue(new Response(null, { status: 416, headers: { "content-range": "bytes */12" } }));
  const r = await streamHomeworkVideo(request("bytes=99-"), ID); expect(r.status).toBe(416); expect(r.headers.get("content-range")).toBe("bytes */12");
});
it.each([{ "content-type": "text/html" }, { "content-length": "99999999" }, { "content-range": "bad" }, { "content-range": "bytes 2-4/12" }, { "content-range": "bytes 0-2/2" }, { "content-range": "bytes 0-3/12" }])("rejects mismatched response headers %j", async over => {
  m.fetch.mockResolvedValue(new Response("bad", { status: 206, headers: { "content-type": "video/mp4", "content-length": "3", "content-range": "bytes 0-2/12", ...over } }));
  expect((await streamHomeworkVideo(request(), ID)).status).toBe(502);
});
it("DB failure and expired token fail closed", async () => {
  m.error = { code: "db-error" }; expect((await streamHomeworkVideo(request(), ID)).status).toBe(502); expect(m.fetch).not.toHaveBeenCalled();
  m.error = null; m.token.mockRejectedValue(new Error("token unavailable")); expect((await streamHomeworkVideo(request(), ID)).status).toBe(502); expect(m.fetch).not.toHaveBeenCalled();
});
