/**
 * 영상이 붙은 칸을 미확인으로 = 그 숙제의 영상 반려(원장 2026-10-13 — Drive 휴지통 · 그 숙제에 붙은 영상 전부).
 * 🔴 적대적 리뷰 2026-10-13: ① 칸을 다시 판정해 "이어받는 영상"을 쫓으면 다른 숙제의 영상까지 끌려와 버려졌다 ② 칸의 대표만 떼면 그 칸으로
 *    접혀 있던 같은 날 영상·같은 파일 사본이 풀려 다른 숙제 칸을 채웠다. 반려 대상 = 지금 그 칸에 붙어 있는 영상 전부(다른 칸 것은 빼고) —
 *    그것을 잠근다. 반려 표시·영상 떼기·기록 지우기는 DB 함수 한 거래(`reject_homework_videos`).
 */
import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
import type { PairRoundMaterials } from "@/features/video-submit/server/site-homework";
import type { VideoArrival } from "../types";

const m = vi.hoisted(() => ({
  db: null as unknown as FakeDb, denied: null as string | null, materials: null as unknown,
  trash: vi.fn(), credential: vi.fn(), log: vi.fn(), after: vi.fn(), today: "2026-10-06",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("@/lib/date-kst", async (load) => ({ ...(await load<typeof import("@/lib/date-kst")>()), kstToday: () => m.today }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "teacher", tenantId: "tenant", systemRole: "teacher" }) }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("./mark-write", () => ({
  ledgerRoundWriteError: async () => m.denied,
  loadVideoHomeworkTarget: async () => ({ error: null, className: "수학 A", studentName: "김민준", enabled: true }),
}));
vi.mock("./reconcile-outcomes", () => ({ reconcileVideoHomework: vi.fn() }));
vi.mock("./video-source", () => ({ homeworkVideoSource: async () => "homework_video_ledger_videos" }));
vi.mock("@/features/video-submit/server/drive-credentials", () => ({ readPinnedVideoDriveCredential: m.credential }));
vi.mock("@/features/video-submit/server/drive-api", () => ({ driveRequest: () => "request", trashDriveFile: m.trash }));
vi.mock("@/features/video-submit/server/site-homework", async (load) => ({
  ...(await load<typeof import("@/features/video-submit/server/site-homework")>()), loadPairRoundMaterials: async () => m.materials,
}));
import { rejectHomeworkVideos } from "./reject-videos";
import { _resetRejectionsProbeForTest } from "./rejections";
import { _resetExtraIssuesProbeForTest } from "./extra-issues";

const C = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222";
const D1 = "2026-10-01", D2 = "2026-10-03";
const playback = { preview: "p", thumbnail: "t", uploadedAt: null };
const video = (id: string, at: string, patch: Partial<VideoArrival> = {}): VideoArrival =>
  ({ id, studentId: S, classId: C, postedAt: at.length === 10 ? `${at}T12:00:00+09:00` : at, playback, ...patch });
const materials = (videos: VideoArrival[], dates = [D1, D2], extra: Partial<PairRoundMaterials> = {}): PairRoundMaterials => ({
  pairs: [{ classId: C, studentId: S }], from: D1, today: m.today, assigned: new Map([[`${C}:${S}`, new Set(dates)]]), marks: [], videos,
  rejected: new Map(), ...extra,
});
const row = (id: string) => ({ id, tenant_id: "tenant", student_id: S, drive_file_id: `drive-${id}`, route: { classId: C, rootId: "root1" } });
const IDS = ["v1", "v2", "picked", "late", "copy", "d2same", "B", "P", "p1", "p2"];

beforeEach(() => {
  vi.clearAllMocks(); _resetRejectionsProbeForTest(); _resetExtraIssuesProbeForTest();
  m.denied = null; m.today = "2026-10-06";
  m.credential.mockResolvedValue({ accessToken: async () => "token" });
  m.trash.mockResolvedValue(undefined);
  m.db = createFakeDb({
    homework_video_ledger_videos: IDS.map(row),
    student_homework_videos: IDS.map((id) => ({ id, tenant_id: "tenant", drive_file_id: `drive-${id}` })),
    video_homework_rejections: [],
  });
  m.db.defineRpc("reject_homework_videos", () => "rejected");
});
const sent = () => [...((m.db.rpcCalls.find((c) => c.name === "reject_homework_videos")?.args.p_videos as string[]) ?? [])].sort();

it("🔴 그 칸의 영상만 — 다른 숙제(D2)에 붙은 영상은 건드리지 않는다 · DB 함수 한 번 · 결과를 알린다", async () => {
  m.materials = materials([video("v1", "2026-10-02"), video("v2", "2026-10-04")]);
  const result = await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 });
  expect(result).toEqual({ ok: true, rejected: 1, trashed: 1, trashFailed: 0, trashShared: 0, reopened: true });
  expect(sent()).toEqual(["v1"]);
  expect(m.db.rpcCalls.find((c) => c.name === "reject_homework_videos")?.args).toMatchObject({ p_tenant: "tenant", p_actor: "teacher", p_student: S, p_class: C, p_date: D1, p_legacy_check: null,
    p_observed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
  expect(m.trash.mock.calls.map((c) => c[1])).toEqual(["drive-v1"]);
  expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "lesson_report_video_homework_reject",
    metadata: expect.objectContaining({ homeworkDate: D1, videos: 1, trashed: 1, reopened: true }) }));
});

it("영상이 50개를 넘으면 DB 함수를 부르지 않고 이유를 알린다(함수는 'invalid'라 원인을 모른다)", async () => {
  m.materials = materials(Array.from({ length: 51 }, (_, i) => video(`x${i}`, "2026-10-02", { homeworkDate: D1 })));
  const result = await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 });
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining("51개") });
  expect(m.db.rpcCalls.some((c) => c.name === "reject_homework_videos")).toBe(false);
});

it("🔴 그 칸으로 접힌 영상까지 — 고른 영상보다 늦게 들어온 같은 날 영상 · 고른 영상의 같은 파일 사본", async () => {
  m.materials = materials([
    video("picked", "2026-10-02T09:00:00+09:00", { homeworkDate: D1, fingerprint: "f1", arrivedAt: "2026-10-02T00:00:00Z" }),
    video("late", "2026-10-02T10:00:00+09:00", { arrivedAt: "2026-10-02T02:00:00Z" }), // 고른 영상 뒤에 같은 날 — 접혀 있다
    video("copy", "2026-10-05", { fingerprint: "f1" }), // 같은 파일 사본(숙제일 이후)
    video("v2", "2026-10-04"), // D2에 붙은 영상 — 남는다
  ]);
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: true, rejected: 3 });
  expect(sent()).toEqual(["copy", "late", "picked"]);
});

it("같은 날이라도 다른 칸이 쓰는 날의 영상은 넣지 않는다", async () => {
  // D1 = 고른 영상(10/03) · D2 = 같은 10/03에 먼저 들어온 안 고른 영상이 대표 — 그날은 D2가 쓰는 날이다
  m.materials = materials([video("picked", "2026-10-03T09:00:00+09:00", { homeworkDate: D1, arrivedAt: "2026-10-03T01:00:00Z" }),
    video("d2same", "2026-10-03T08:00:00+09:00", { arrivedAt: "2026-10-02T23:00:00Z" })]);
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: true, rejected: 1 });
  expect(sent()).toEqual(["picked"]);
});

it("🔴 뒤 숙제를 반려해도 앞선 숙제(기간 밖 칸)가 받은 같은 날 영상은 건드리지 않는다(재리뷰 2026-10-13)", async () => {
  // 숙제 10/1(빈 칸) · 10/5 — 10/7 09:00 ClassNote 영상 B는 10/1 칸으로(②), 15:00에 10/5를 골라 P를 올렸다. 10/5만 반려한다.
  m.today = "2026-10-08";
  m.materials = materials([
    video("B", "2026-10-07T09:00:00+09:00", { arrivedAt: "2026-10-07T00:00:00Z" }),
    video("P", "2026-10-07T15:00:00+09:00", { homeworkDate: "2026-10-05", arrivedAt: "2026-10-07T06:00:00Z" }),
  ], [D1, "2026-10-05"], { from: "2026-10-05" });
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: "2026-10-05" })).toMatchObject({ ok: true, rejected: 1 });
  expect(sent()).toEqual(["P"]);
});

it("두 칸이 함께 접어 둔 영상은 남긴다 · 그 칸에 붙은 숙제일 없는 옛 기록은 함께 지운다", async () => {
  m.materials = materials([
    video("p1", "2026-10-04T09:00:00+09:00", { homeworkDate: D1, arrivedAt: "2026-10-04T00:00:00Z" }),
    video("p2", "2026-10-04T10:00:00+09:00", { homeworkDate: D2, arrivedAt: "2026-10-04T01:00:00Z" }),
    video("late", "2026-10-04T11:00:00+09:00", { arrivedAt: "2026-10-04T02:00:00Z" }),
  ], [D1, D2], { marks: [{ classId: C, studentId: S, checkDate: "2026-10-02", homeworkDate: null, status: "submitted" }] });
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: true, rejected: 1 });
  expect(sent()).toEqual(["p1"]);
  expect(m.db.rpcCalls.find((c) => c.name === "reject_homework_videos")?.args.p_legacy_check).toBe("2026-10-02");
});

it("이미 옮겨 남긴 숙제 칸을 반려하면 다시 넣지 않는다", async () => {
  m.materials = materials([video("v1", "2026-10-02")], [D1], { kept: new Map([[`${C}:${S}`, new Set([D1])]]) });
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: true, rejected: 1 });
  expect(m.db.tables.video_homework_extra_issues ?? []).toEqual([]);
});

it("🔴 검사 기록만으로 선 숙제 칸(보고서 표시 없음)을 반려하면 먼저 옮겨 남긴 숙제로 넣는다 — 칸과 반려 표시가 설 자리가 남는다", async () => {
  // 패치 전 수업: 숙제 표시 없이 D1에 미수행 기록만 있고, 10/02 영상이 뒷순위로 그 칸에 붙었다.
  m.materials = materials([video("v1", "2026-10-02")], [], { marks: [{ classId: C, studentId: S, checkDate: "2026-10-02", homeworkDate: D1, status: "missing" }] });
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: true, rejected: 1 });
  expect(sent()).toEqual(["v1"]);
  expect(m.db.tables.video_homework_extra_issues).toEqual([expect.objectContaining({ tenant_id: "tenant", class_id: C, student_id: S, homework_date: D1, issued_by: "teacher", kept: true })]);
  expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ keptAsIssue: true }) }));
});

it("🔴 다른 영상 줄이 같은 Drive 파일을 쓰면 휴지통으로 보내지 않는다(연동 PC는 같은 폴더의 같은 파일을 다시 쓴다)", async () => {
  m.materials = materials([video("v1", "2026-10-02")]);
  m.db.tables.student_homework_videos!.push({ id: "sibling", tenant_id: "tenant", drive_file_id: "drive-v1" });
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: true, trashed: 0, trashShared: 1 });
  expect(m.trash).not.toHaveBeenCalled();
});

it("그사이 연결이 바뀌었으면(DB 함수 'changed') 아무것도 안 바꾸고 알린다 · DB 오류는 실패", async () => {
  m.materials = materials([video("v1", "2026-10-02")]);
  m.db.defineRpc("reject_homework_videos", () => "changed");
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: false, error: expect.stringContaining("바뀌었습니다") });
  expect(m.trash).not.toHaveBeenCalled();
  expect(m.log).not.toHaveBeenCalled();
  m.db.defineRpc("reject_homework_videos", () => { throw { code: "P0001", message: "영상을 반려하지 못했습니다(conflict)." }; });
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: false });
  expect(m.trash).not.toHaveBeenCalled();
});

it("기한 지난 숙제는 다시 열리지 않는다 · 붙은 영상이 없거나 권한이 없으면 거절 · 표가 아직 없으면 거절", async () => {
  m.materials = materials([video("v1", "2026-10-02")]);
  m.today = "2026-10-20";
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: true, reopened: false });
  m.materials = materials([]);
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: false, error: expect.stringContaining("붙은 영상이 없습니다") });
  m.denied = "내가 낸 숙제만 기록할 수 있습니다.";
  m.materials = materials([video("v1", "2026-10-02")]);
  const before = m.db.rpcCalls.length;
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: false, error: "내가 낸 숙제만 기록할 수 있습니다." });
  expect(m.db.rpcCalls.length).toBe(before);
  m.denied = null;
  _resetRejectionsProbeForTest();
  m.db.dropTable("video_homework_rejections");
  expect(await rejectHomeworkVideos({ classId: C, studentId: S, homeworkDate: D1 })).toMatchObject({ ok: false, error: expect.stringContaining("아직") });
  expect(await rejectHomeworkVideos({ classId: "x", studentId: S, homeworkDate: D1 })).toMatchObject({ ok: false });
});
