import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";
import { addDays } from "@/lib/date-kst";
const m = vi.hoisted(() => ({ db: null as unknown as FakeDb, user: { id: "teacher", tenantId: "tenant", systemRole: "teacher" }, viewAs: null as { id: string; access: "full" } | null, full: false, writable: true, readonly: null as string | null, refresh: vi.fn(), holidays: [] as { date: string }[] }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
vi.mock("./reconcile-outcomes", () => ({ reconcileVideoHomework: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: async () => m.readonly, viewAsTeacher: async () => m.viewAs }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: async () => m.full ? "full" : "scoped", canWriteTenant: async () => m.writable }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { holidays: m.holidays } }) }));
import { logAction } from "@/features/audit/server/log";
import { assignHomeworkVideo, getVideoAssignmentOptions } from "./video-assignment";
const C = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", V = "33333333-3333-4333-8333-333333333333";
const input = { classId: C, studentId: S, videoId: V, homeworkDate: "2026-10-01", excluded: false, revision: 0, reason: "잘못 올린 반 수정" };
const optionsInput = { classId: C, studentId: S, fromDate: "2026-10-01", toDate: "2026-10-31" };
const video = { id: V, tenant_id: "tenant", student_id: S, status: "uploaded", posted_at: "2026-10-02T10:00:00+09:00", drive_file_id: "syntheticDriveFile123", route: {}, assignment_revision: 0 };
beforeEach(() => { m.holidays = []; m.full = false; m.writable = true; m.readonly = null; vi.clearAllMocks(); m.db = createFakeDb({ classes: [{ id: C, tenant_id: "tenant", teacher_id: "teacher" }], lesson_reports: [{ tenant_id: "tenant", student_id: S, class_id: C, report_date: "2026-10-01", video_homework: true }], homework_video_ledger_videos: [video] }); m.db.defineRpc("set_homework_video_assignment", () => "saved"); });
describe("담임의 영상 배정", () => {
  it("다른 강사 편집은 대상의 담당 반에 배정하고 감사 기록에는 실제 편집자를 남긴다", async () => {
    m.viewAs = { id: "target", access: "full" };
    m.db.tables.classes![0].teacher_id = "target";
    try {
      expect(await assignHomeworkVideo(input)).toEqual({ ok: true });
      expect(m.db.rpcCalls[0]?.args).toMatchObject({ p_actor: "teacher", p_full: true });
      expect(await assignHomeworkVideo({ ...input, excluded: true })).toMatchObject({ ok: false });
      m.db.tables.classes![0].teacher_id = "unrelated";
      expect(await assignHomeworkVideo(input)).toMatchObject({ ok: false });
      expect(m.db.rpcCalls).toHaveLength(1);
    } finally { m.viewAs = null; }
  });
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
  // 원장 2026-10-14 *"수동 영상들 다 학생들이 업로드해서 배정하고 싶은데 배정이 불가능함"* — 보고서에 '영상 과제' 표시 없이 선생님이 손으로
  // 찍은 칸(검사 기록만 있는 숙제일)은 배정 목록에 없었고 DB 함수도 거절했다.
  it("검사 기록만 있는 숙제일도 배정 목록에 서고, 배정하면 그 칸을 옮겨 남긴 숙제로 먼저 남긴 뒤 저장한다", async () => {
    m.db.tables.lesson_reports = [{ tenant_id: "tenant", student_id: S, class_id: C, report_date: "2026-10-01", video_homework: null, created_by: "teacher" }];
    m.db.tables.video_homework_marks = [{ tenant_id: "tenant", class_id: C, student_id: S, check_date: "2026-10-02", homework_date: "2026-10-01", status: "submitted" }];
    m.db.tables.video_homework_extra_issues = [];
    expect(await getVideoAssignmentOptions(optionsInput)).toMatchObject({ ok: true, dates: ["2026-10-01"], videos: [{ id: V }] });
    expect(await assignHomeworkVideo(input)).toEqual({ ok: true });
    expect(m.db.tables.video_homework_extra_issues).toEqual([expect.objectContaining({ class_id: C, student_id: S, homework_date: "2026-10-01", teacher_id: "teacher", kept: true })]);
    expect(m.db.rpcCalls).toHaveLength(1);
    expect(m.db.rpcCalls[0]?.args).toMatchObject({ p_date: "2026-10-01", p_video: V });
    // 검사 기록도 숙제도 없는 날은 여전히 거절 — 옮겨 남기지도 않는다
    expect((await assignHomeworkVideo({ ...input, homeworkDate: "2026-10-02" })).ok).toBe(false);
    expect(m.db.tables.video_homework_extra_issues).toHaveLength(1);
  });
  // 재리뷰 2026-10-14 — 거두는 사이 다른 창이 그 칸을 미확인으로 지우면 칸이 통째로 사라진다. 남은 줄은 칸을 지킬 뿐이다.
  it("🔴 배정이 실패해도 남긴 줄은 거두지 않는다 — 다시 시도하면 그 줄을 그대로 쓴다", async () => {
    m.db.tables.lesson_reports = [{ tenant_id: "tenant", student_id: S, class_id: C, report_date: "2026-10-01", video_homework: null, created_by: "teacher" }];
    m.db.tables.video_homework_marks = [{ tenant_id: "tenant", class_id: C, student_id: S, check_date: "2026-10-02", homework_date: "2026-10-01", status: "submitted" }];
    m.db.tables.video_homework_extra_issues = [];
    m.db.defineRpc("set_homework_video_assignment", () => "conflict");
    expect(await assignHomeworkVideo(input)).toMatchObject({ ok: false, error: expect.stringContaining("다른 곳") });
    expect(m.db.tables.video_homework_extra_issues).toHaveLength(1);
    m.db.defineRpc("set_homework_video_assignment", () => "saved");
    expect(await assignHomeworkVideo(input)).toEqual({ ok: true });
    expect(m.db.tables.video_homework_extra_issues).toHaveLength(1);
  });
  it("보고서 숙제에 배정할 때는 옮겨 남긴 숙제를 만들지 않는다", async () => {
    m.db.tables.video_homework_marks = [{ tenant_id: "tenant", class_id: C, student_id: S, check_date: "2026-10-02", homework_date: "2026-10-01", status: "submitted" }];
    expect(await assignHomeworkVideo(input)).toEqual({ ok: true });
    expect(m.db.tables.video_homework_extra_issues ?? []).toHaveLength(0);
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

// 원장 2026-10-22 '숙제없음 칸에 바로 배정' — 반 숙제가 0건이어도 그 학생이 들은 수업일에 이미 올라온 영상을 붙인다(옮겨 남긴 숙제 + 영상).
describe("숙제없음 수업일에 영상 배정", () => {
  const blankInput = { ...input, homeworkDate: "2026-10-05" };
  beforeEach(() => {
    // 반 숙제 0건 · 월·목 수업 · 10/5(월) 출석 · 10/8(목) 결석 · 영상은 10/8에 숙제 없이 올림
    m.db.tables.lesson_reports = [];
    m.db.tables.class_schedules = [{ tenant_id: "tenant", class_id: C, day_of_week: "mon", valid_from: "2026-03-01", valid_to: null },
      { tenant_id: "tenant", class_id: C, day_of_week: "thu", valid_from: "2026-03-01", valid_to: null }];
    m.db.tables.enrollments = [{ tenant_id: "tenant", class_id: C, student_id: S, start_date: "2026-03-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null }];
    m.db.tables.attendance_records = [
      { id: "a1", tenant_id: "tenant", class_id: C, student_id: S, session_date: "2026-10-05", slot_start: null, status: "present", recorded_at: "2026-10-05T09:00:00Z" },
      { id: "a2", tenant_id: "tenant", class_id: C, student_id: S, session_date: "2026-10-08", slot_start: null, status: "absent", recorded_at: "2026-10-08T09:00:00Z" },
    ];
    m.db.tables.video_homework_extra_issues = [];
    m.db.tables.homework_video_ledger_videos = [{ ...video, posted_at: "2026-10-08T17:06:00+09:00", route: { classId: C, free: true, note: "10월 5일 숙제" } }];
  });
  it("배정 창 — 숙제가 없어도 열리고, 들은 수업일(결석 · 수업 없는 요일 빼고)이 숙제없음 날짜로 선다 · 조회 시작 14일 전부터(월 경계)", async () => {
    const result = await getVideoAssignmentOptions({ ...optionsInput, toDate: "2026-10-10" });
    // 9/17(목)부터 — 기간 첫머리에 올린 영상이 기간 직전 수업의 숙제일 수 있다(칸이 영상을 받는 창 14일과 같다)
    expect(result).toMatchObject({ ok: true, dates: [], blankDates: ["2026-09-17", "2026-09-21", "2026-09-24", "2026-09-28", "2026-10-01", "2026-10-05"],
      videos: [{ id: V, free: true, note: "10월 5일 숙제" }] });
  });
  it("종강한 반은 종강 뒤 날을 고를 수 없다(출결이 없으면)", async () => {
    m.db.tables.classes![0].closed_at = "2026-09-30T00:00:00+00:00";
    const result = await getVideoAssignmentOptions({ ...optionsInput, toDate: "2026-10-10" });
    expect(result).toMatchObject({ ok: true, blankDates: ["2026-09-17", "2026-09-21", "2026-09-24", "2026-09-28", "2026-10-05"] });
    expect(await assignHomeworkVideo({ ...blankInput, homeworkDate: "2026-10-01" })).toMatchObject({ ok: false, error: expect.stringContaining("수업이 없었습니다") });
  });
  it("배정하면 그날을 옮겨 남긴 숙제로 세우고(감사로그 · 출처 표시) 영상을 붙인다 — 다음 수업이 지났어도", async () => {
    expect(await assignHomeworkVideo(blankInput)).toEqual({ ok: true });
    expect(m.db.tables.video_homework_extra_issues).toEqual([expect.objectContaining({ class_id: C, student_id: S, homework_date: "2026-10-05", kept: true, issued_by: "teacher" })]);
    expect(m.db.rpcCalls).toEqual([expect.objectContaining({ name: "set_homework_video_assignment", args: expect.objectContaining({ p_date: "2026-10-05", p_video: V, p_actor: "teacher" }) })]);
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "lesson_report_video_homework_issue",
      metadata: expect.objectContaining({ homeworkDate: "2026-10-05", kept: true, source: "blank_lesson" }) }));
  });
  it.each([
    ["결석한 날", "2026-10-08", "결석"],
    ["수업 없는 요일", "2026-10-06", "수업이 없었습니다"],
  ])("🔴 %s에는 붙이지 않는다 — 줄도 남기지 않는다", async (_, homeworkDate, message) => {
    expect(await assignHomeworkVideo({ ...blankInput, homeworkDate })).toMatchObject({ ok: false, error: expect.stringContaining(message) });
    expect(m.db.tables.video_homework_extra_issues).toEqual([]);
    expect(m.db.rpcCalls).toHaveLength(0);
  });
  it("출결 없는 학원 휴원일 · 출결 없는 날의 수강 밖 · 그 수업보다 먼저 올린 영상은 거절한다", async () => {
    m.holidays = [{ date: "2026-10-01" }];
    expect(await assignHomeworkVideo({ ...blankInput, homeworkDate: "2026-10-01" })).toMatchObject({ ok: false, error: expect.stringContaining("휴원일") });
    m.holidays = [];
    const enrollments = m.db.tables.enrollments;
    m.db.tables.enrollments = [];
    expect(await assignHomeworkVideo({ ...blankInput, homeworkDate: "2026-10-01" })).toMatchObject({ ok: false, error: expect.stringContaining("수강생") });
    m.db.tables.enrollments = enrollments;
    m.db.tables.homework_video_ledger_videos![0].posted_at = "2026-10-04T10:00:00+09:00";
    expect(await assignHomeworkVideo(blankInput)).toMatchObject({ ok: false, error: expect.stringContaining("14일") });
    expect(m.db.tables.video_homework_extra_issues).toEqual([]);
    expect(m.db.rpcCalls).toHaveLength(0);
  });
  it("🔴 그사이 배정이 바뀌었으면(버전) 줄을 남기기 전에 멈춘다", async () => {
    m.db.tables.homework_video_ledger_videos![0].assignment_revision = 3;
    expect(await assignHomeworkVideo(blankInput)).toMatchObject({ ok: false, error: expect.stringContaining("다른 곳") });
    expect(m.db.tables.video_homework_extra_issues).toEqual([]);
    expect(m.db.rpcCalls).toHaveLength(0);
  });
  it("🔴 배정이 저장되지 않으면 방금 세운 줄을 거둔다 — 영상 없는 '미확인' 칸이 새로 남지 않게", async () => {
    m.db.defineRpc("set_homework_video_assignment", () => "conflict");
    expect(await assignHomeworkVideo(blankInput)).toMatchObject({ ok: false, error: expect.stringContaining("다른 곳") });
    expect(m.db.tables.video_homework_extra_issues).toEqual([]);
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "lesson_report_video_homework_issue_cancel",
      metadata: expect.objectContaining({ homeworkDate: "2026-10-05", source: "blank_lesson" }) }));
    // 그사이 다른 창이 같은 날에 영상을 붙였으면(그 숙제일을 가리키는 영상) 줄을 그대로 둔다
    m.db.tables.homework_video_ledger_videos!.push({ ...video, id: "other", route: { classId: C, homeworkDate: "2026-10-05" } });
    expect((await assignHomeworkVideo(blankInput)).ok).toBe(false);
    expect(m.db.tables.video_homework_extra_issues).toHaveLength(1);
  });
  it("이미 숙제가 있는 날은 숙제 칸으로 고른다 — 숙제없음 날짜에 다시 서지 않는다", async () => {
    m.db.tables.lesson_reports = [{ tenant_id: "tenant", student_id: S, class_id: C, report_date: "2026-10-05", video_homework: true }];
    const result = await getVideoAssignmentOptions({ ...optionsInput, toDate: "2026-10-10" });
    expect(result).toMatchObject({ ok: true, dates: ["2026-10-05"], blankDates: ["2026-09-17", "2026-09-21", "2026-09-24", "2026-09-28", "2026-10-01"] });
    expect(await assignHomeworkVideo(blankInput)).toEqual({ ok: true });
    expect(m.db.tables.video_homework_extra_issues).toEqual([]);
  });
  it("숙제가 한 번도 없던 반은 집계 제외를 저장할 수 없어 까닭을 말한다(DB 함수가 그 반 숙제로 담당을 확인한다)", async () => {
    expect(await assignHomeworkVideo({ ...input, excluded: true, homeworkDate: null })).toMatchObject({ ok: false, error: expect.stringContaining("숙제없음 수업일에 붙여") });
    expect(m.db.rpcCalls).toHaveLength(0);
  });
});
