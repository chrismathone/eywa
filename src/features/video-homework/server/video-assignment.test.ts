import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
import { addDays } from "@/lib/date-kst";
const m = vi.hoisted(() => ({ db: null as unknown as FakeDb, user: { id: "teacher", tenantId: "tenant", systemRole: "teacher" }, full: false, writable: true, readonly: null as string | null, refresh: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: async () => m.readonly }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: async () => m.full ? "full" : "scoped", canWriteTenant: async () => m.writable }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
import { assignHomeworkVideo, getVideoAssignmentOptions } from "./video-assignment";
const C = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", V = "33333333-3333-4333-8333-333333333333";
const input = { classId: C, studentId: S, videoId: V, homeworkDate: "2026-10-01", excluded: false, revision: 0, reason: "잘못 올린 반 수정" };
const optionsInput = { classId: C, studentId: S, fromDate: "2026-10-01", toDate: "2026-10-31" };
const video = { id: V, tenant_id: "tenant", student_id: S, status: "uploaded", posted_at: "2026-10-02T10:00:00+09:00", drive_file_id: "syntheticDriveFile123", route: {}, assignment_revision: 0 };
beforeEach(() => { m.full = false; m.writable = true; m.readonly = null; vi.clearAllMocks(); m.db = createFakeDb({ classes: [{ id: C, tenant_id: "tenant", teacher_id: "teacher" }], lesson_reports: [{ tenant_id: "tenant", student_id: S, class_id: C, report_date: "2026-10-01", video_homework: true }], homework_video_ledger_videos: [video] }); m.db.defineRpc("set_homework_video_assignment", () => "saved"); });
describe("담임의 영상 배정", () => {
  it("담임이 본인 반 숙제로 배정할 수 있고 처리자는 로그인 계정으로 고정된다", async () => {
    expect(await assignHomeworkVideo(input)).toEqual({ ok: true });
    expect(m.db.rpcCalls[0]?.args).toMatchObject({ p_actor: "teacher", p_tenant: "tenant", p_full: false, p_context_class: C, p_student: S });
  });
  it.each(["otherTeacher", "otherTenant", "otherStudent", "readonly", "noWrite"])("권한 밖 요청은 RPC에 도달하지 않는다: %s", async kind => {
    if (kind === "otherTeacher") m.db.tables.classes![0]!.teacher_id = "other";
    if (kind === "otherTenant") m.db.tables.classes![0]!.tenant_id = "other";
    if (kind === "otherStudent") m.db.tables.lesson_reports![0]!.student_id = "other";
    if (kind === "readonly") m.readonly = "읽기 전용입니다.";
    if (kind === "noWrite") m.writable = false;
    expect((await assignHomeworkVideo(input)).ok).toBe(false); expect(m.db.rpcCalls).toHaveLength(0);
  });
  it("없는 숙제일과 빈 사유를 거절한다", async () => {
    expect((await assignHomeworkVideo({ ...input, homeworkDate: "2026-10-02" })).ok).toBe(false);
    expect((await assignHomeworkVideo({ ...input, reason: " " })).ok).toBe(false); expect(m.db.rpcCalls).toHaveLength(0);
  });
  it("동시 수정 충돌을 조용히 덮어쓰지 않는다", async () => {
    m.db.defineRpc("set_homework_video_assignment", () => "conflict");
    expect(await assignHomeworkVideo(input)).toMatchObject({ ok: false, error: expect.stringContaining("다른 곳") });
    expect(m.refresh).not.toHaveBeenCalled();
  });
  it("조회 권한도 같은 담당 반으로 제한한다", async () => {
    m.db.tables.classes![0]!.teacher_id = "other";
    expect(await getVideoAssignmentOptions(optionsInput)).toMatchObject({ ok: false });
  });
  it("조회 기간의 실제 숙제 당일부터 14일 뒤까지 조회하며 다른 반·미지정 영상도 유지한다", async () => {
    m.db.tables.lesson_reports!.push({ ...m.db.tables.lesson_reports![0], report_date: "2026-03-01" });
    m.db.tables.homework_video_ledger_videos = [
      { ...video, id: "old", posted_at: "2026-03-15T12:54:02+09:00" },
      { ...video, id: "before", posted_at: "2026-09-30T23:59:59+09:00" },
      { ...video, id: "sameDay", posted_at: "2026-10-01T00:00:00+09:00" },
      { ...video, id: "after14", posted_at: "2026-10-15T23:59:59+09:00", route: { classId: "other" } },
      { ...video, id: "after15", posted_at: "2026-10-16T00:00:00+09:00" },
      { ...video, id: "queued", status: "queued" },
      { ...video, id: "noFile", drive_file_id: null },
      { ...video, id: "foreign", tenant_id: "other" },
      { ...video, id: "otherStudent", student_id: "other" },
    ];
    const result = await getVideoAssignmentOptions(optionsInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.dates).toEqual(["2026-10-01"]);
    expect(result.videos.map(video => video.id)).toEqual(["sameDay", "after14"]);
  });
  it("최근 보고서가 366건을 넘겨도 조회 기간의 과거 숙제를 배정할 수 있다", async () => {
    const report = m.db.tables.lesson_reports![0];
    m.db.tables.lesson_reports = [
      ...Array.from({ length: 367 }, (_, index) => ({ ...report, report_date: addDays("2026-10-02", index) })),
      report,
    ];
    const result = await getVideoAssignmentOptions({ ...optionsInput, toDate: "2026-10-01" });
    expect(result).toMatchObject({ ok: true, dates: ["2026-10-01"], videos: [{ id: V }] });
    expect(await assignHomeworkVideo(input)).toEqual({ ok: true });
  });
  it("파일 연결이 없는 기록은 배정 대상이 아니며 빈 조회 입력도 오류 응답으로 처리한다", async () => {
    m.db.tables.homework_video_ledger_videos![0].drive_file_id = null;
    expect(await getVideoAssignmentOptions(optionsInput)).toMatchObject({ ok: true, videos: [] });
    expect(await assignHomeworkVideo(input)).toMatchObject({ ok: false, error: expect.stringContaining("업로드가 완료된") });
    expect(m.db.rpcCalls).toHaveLength(0);
    expect(await getVideoAssignmentOptions(null as unknown as typeof optionsInput)).toMatchObject({ ok: false });
  });
  it.each(["2026-09-30T23:59:59+09:00", "2026-10-16T00:00:00+09:00"])("숙제일 이전과 15일 이후는 직접 저장 요청도 거절한다: %s", async posted_at => {
    m.db.tables.homework_video_ledger_videos![0].posted_at = posted_at;
    expect(await assignHomeworkVideo(input)).toMatchObject({ ok: false, error: expect.stringContaining("14일") });
    expect(m.db.rpcCalls).toHaveLength(0);
  });
  it("14일 뒤까지 저장할 수 있고, 오래된 잘못된 연결의 집계 제외도 가능하다", async () => {
    m.db.tables.homework_video_ledger_videos![0].posted_at = "2026-10-15T23:59:59+09:00";
    expect(await assignHomeworkVideo(input)).toEqual({ ok: true });
    m.db.tables.homework_video_ledger_videos![0].posted_at = "2026-03-15T12:54:02+09:00";
    expect(await assignHomeworkVideo({ ...input, excluded: true, homeworkDate: null })).toEqual({ ok: true });
  });
});
