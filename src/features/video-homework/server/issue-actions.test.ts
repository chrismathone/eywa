import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "@/features/video-submit/server/fake-db.test-util";

const m = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  user: { id: "teacher", tenantId: "tenant", systemRole: "teacher" } as { id: string; tenantId: string; systemRole: string } | null,
  denied: null as string | null, readonly: null as string | null, view: "teacher" as "teacher" | "admin", acting: null as string | null,
  level: "scoped", writable: true, enabled: true, today: "2026-10-08", log: vi.fn(), reconcile: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/date-kst", async (load) => ({ ...(await load<typeof import("@/lib/date-kst")>()), kstToday: () => m.today }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: async () => m.readonly, getShellView: async () => m.view, effectiveTeacherId: async () => m.acting }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: async () => m.level, canWriteTenant: async () => m.writable }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { holidays: [] } }) }));
vi.mock("./reconcile-outcomes", () => ({ reconcileVideoHomework: m.reconcile }));
vi.mock("./mark-write", () => ({
  videoHomeworkWriteError: async () => m.denied,
  loadVideoHomeworkTarget: async () => ({ error: null, className: "초등M A", studentName: "김민준", enabled: m.enabled }),
}));
import { _resetExtraIssuesProbeForTest } from "./extra-issues";
import { cancelExtraVideoHomework, issueExtraVideoHomework } from "./issue-actions";

const C = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222";
const input = { classId: C, studentId: S, date: "2026-10-06" };
const scope = { tenant_id: "tenant", class_id: C };
beforeEach(() => {
  vi.clearAllMocks(); _resetExtraIssuesProbeForTest();
  Object.assign(m, { user: { id: "teacher", tenantId: "tenant", systemRole: "teacher" }, denied: null, readonly: null, view: "teacher", acting: null,
    level: "scoped", writable: true, enabled: true, today: "2026-10-08" });
  m.db = createFakeDb({
    classes: [{ id: C, tenant_id: "tenant", teacher_id: "homeroom" }],
    // 화·금 수업(10-06 화 · 10-09 금)
    class_schedules: [{ ...scope, day_of_week: "tue", valid_from: "2026-03-01", valid_to: null }, { ...scope, day_of_week: "fri", valid_from: "2026-03-01", valid_to: null }],
    enrollments: [{ ...scope, student_id: S, start_date: "2026-03-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null }],
    attendance_records: [{ id: "a1", ...scope, student_id: S, session_date: "2026-10-06", slot_start: null, status: "present", recorded_at: "2026-10-06T08:00:00Z" }],
    lesson_reports: [{ ...scope, student_id: S, report_date: "2026-10-06", video_homework: null }],
    video_homework_extra_issues: [],
  }, { video_homework_extra_issues: [["tenant_id", "class_id", "student_id", "homework_date"]] });
});

describe("숙제없음 칸에서 영상 숙제 내기", () => {
  it("그날 수업을 들었고 다음 수업 전이면 낸다 — 보고서는 건드리지 않고, 강사 화면에서 냈으면 그 강사의 숙제다", async () => {
    expect(await issueExtraVideoHomework(input)).toEqual({ ok: true, deadline: "2026-10-13" });
    expect(m.db.tables.video_homework_extra_issues).toEqual([expect.objectContaining({ tenant_id: "tenant", class_id: C, student_id: S,
      homework_date: "2026-10-06", teacher_id: "teacher", issued_by: "teacher" })]);
    expect(m.db.tables.lesson_reports![0]!.video_homework).toBeNull();
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "lesson_report_video_homework_issue", metadata: expect.objectContaining({ homeworkDate: "2026-10-06", deadline: "2026-10-13" }) }));
    expect(m.reconcile).toHaveBeenCalledWith("tenant", { studentId: S }); // 응답 전에 재판정(장부가 판정 전 상태로 다시 그려지지 않게)
  });
  it("관리자 화면에서 내면 그날 보고서를 쓴 사람(없으면 그 반 담임)의 숙제로 선다(실제로 누른 사람은 따로 남긴다)", async () => {
    m.view = "admin";
    expect((await issueExtraVideoHomework(input)).ok).toBe(true);
    expect(m.db.tables.video_homework_extra_issues![0]).toMatchObject({ teacher_id: "homeroom", issued_by: "teacher" });
    // 그날 실제로 가르친 강사(팀티칭 등)가 보고서를 썼으면 그 강사의 숙제다 — 알림·'내가 낸 숙제'가 그 강사에게
    m.db.tables.video_homework_extra_issues = [];
    m.db.tables.lesson_reports![0]!.created_by = "co-teacher";
    expect((await issueExtraVideoHomework(input)).ok).toBe(true);
    expect(m.db.tables.video_homework_extra_issues![0]).toMatchObject({ teacher_id: "co-teacher", issued_by: "teacher" });
  });
  it("다른 강사 편집으로 내면 그 강사의 숙제다", async () => {
    m.acting = "target";
    await issueExtraVideoHomework(input);
    expect(m.db.tables.video_homework_extra_issues![0]).toMatchObject({ teacher_id: "target", issued_by: "teacher" });
  });
  it("다음 수업(금)이 지나면 못 낸다 — 오늘이 다음 수업일이어도 그 수업 기록이 생기면 못 낸다", async () => {
    m.today = "2026-10-10";
    expect(await issueExtraVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("다음 수업(10.09)") });
    m.today = "2026-10-09";
    expect((await issueExtraVideoHomework({ ...input })).ok).toBe(true);
    m.db.tables.video_homework_extra_issues = [];
    m.db.tables.attendance_records!.push({ id: "a2", ...scope, student_id: S, session_date: "2026-10-09", slot_start: null, status: "present", recorded_at: "2026-10-09T08:00:00Z" });
    expect(await issueExtraVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("다음 수업") });
    expect(m.db.tables.video_homework_extra_issues).toHaveLength(0);
  });
  it("결석한 날 · 이미 숙제가 나간 날 · 두 번 내기는 거절한다", async () => {
    m.db.tables.attendance_records![0]!.status = "absent";
    expect(await issueExtraVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("결석") });
    m.db.tables.attendance_records![0]!.status = "present";
    m.db.tables.lesson_reports![0]!.video_homework = true;
    expect(await issueExtraVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("이미") });
    m.db.tables.lesson_reports![0]!.video_homework = false;
    expect((await issueExtraVideoHomework(input)).ok).toBe(true);
    expect(await issueExtraVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("이미") });
    expect(m.db.tables.video_homework_extra_issues).toHaveLength(1);
  });
  it("미래 · 30일 지난 수업 · 모양이 틀린 값 · 권한 없음 · 검사 대상 아님 · 열람 전용은 쓰지 않는다", async () => {
    expect((await issueExtraVideoHomework({ ...input, date: "2026-10-09" })).ok).toBe(false);
    expect((await issueExtraVideoHomework({ ...input, date: "2026-09-01" })).ok).toBe(false);
    expect((await issueExtraVideoHomework({ ...input, classId: "x" })).ok).toBe(false);
    m.denied = "담당 반만 수정할 수 있습니다.";
    expect(await issueExtraVideoHomework(input)).toEqual({ ok: false, error: "담당 반만 수정할 수 있습니다." });
    m.denied = null; m.enabled = false;
    expect(await issueExtraVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("검사 대상") });
    m.enabled = true; m.readonly = "열람 전용입니다.";
    expect(await issueExtraVideoHomework(input)).toEqual({ ok: false, error: "열람 전용입니다." });
    expect(m.db.tables.video_homework_extra_issues).toHaveLength(0);
  });
  it("SQL 적용 전(표 없음)에는 쓰지 않고 알린다 · 그 밖의 조회 실패는 숙제 없음으로 읽지 않는다", async () => {
    m.db.dropTable("video_homework_extra_issues");
    expect(await issueExtraVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("아직") });
  });
  it("표는 있는데 못 읽으면(표 없음이 아닌 오류) 숙제 없음으로 읽고 내지 않는다 — 실패를 알린다", async () => {
    m.db.dropColumn("video_homework_extra_issues", "homework_date");
    expect(await issueExtraVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("내지 못했습니다") });
    expect(m.db.tables.video_homework_extra_issues).toHaveLength(0);
    expect(m.log).not.toHaveBeenCalled();
  });
});

describe("따로 낸 숙제 취소", () => {
  beforeEach(() => { m.db.tables.video_homework_extra_issues = [{ ...scope, student_id: S, homework_date: "2026-10-06", teacher_id: "teacher" }]; m.db.defineRpc("cancel_video_homework_extra_issue", () => "cancelled"); });
  it("낸 강사는 거둔다 — DB 함수가 영상·기록을 다시 확인한다", async () => {
    expect(await cancelExtraVideoHomework(input)).toEqual({ ok: true });
    expect(m.db.rpcCalls.at(-1)).toMatchObject({ name: "cancel_video_homework_extra_issue", args: { p_tenant: "tenant", p_class: C, p_student: S, p_date: "2026-10-06" } });
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "lesson_report_video_homework_issue_cancel" }));
  });
  it("남이 낸 숙제는 강사가 못 거둔다 · 전체 권한은 거둔다", async () => {
    m.db.tables.video_homework_extra_issues![0]!.teacher_id = "other";
    expect(await cancelExtraVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("내가 낸") });
    expect(m.db.rpcCalls).toHaveLength(0);
    m.level = "full";
    expect((await cancelExtraVideoHomework(input)).ok).toBe(true);
  });
  it("그날 보고서에도 영상 과제가 있으면 따로 낸 표시만 지웠다고 알린다(숙제는 그대로)", async () => {
    m.db.defineRpc("cancel_video_homework_extra_issue", () => "kept");
    expect(await cancelExtraVideoHomework(input)).toEqual({ ok: true, kept: true });
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ keptByReport: true }) }));
  });
  it("영상이 붙었거나 직접 찍은 기록이 있으면 까닭을 말한다", async () => {
    m.db.defineRpc("cancel_video_homework_extra_issue", () => "has_video");
    expect(await cancelExtraVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("영상이 올라온") });
    m.db.defineRpc("cancel_video_homework_extra_issue", () => "marked");
    expect(await cancelExtraVideoHomework(input)).toMatchObject({ ok: false, error: expect.stringContaining("직접 찍은") });
    expect(m.log).not.toHaveBeenCalled();
  });
});
