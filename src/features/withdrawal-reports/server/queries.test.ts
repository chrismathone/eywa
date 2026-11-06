import { describe, it, expect, vi, beforeEach } from "vitest";
import { EMPTY_BODY, type WithdrawalReport } from "../model";
const state = vi.hoisted(() => ({ user: { id: "actor", tenantId: "tenant", systemRole: "teacher" }, teacherId: null as string | null, access: true, write: true, lab: true, labAssigned: true, scope: null as string[] | null, db: vi.fn(), prefill: vi.fn() }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: async () => state.teacherId ?? (state.user.systemRole === "teacher" ? state.user.id : null) }));
vi.mock("./consultations", () => ({ reportConsultations: async () => [] }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => state.access, canWriteTenant: async () => state.write }));
// 실물과 같은 규칙: 운영 콘솔이 실험실에 배정한 메뉴만 지점의 실험실 사용 여부를 묻는다.
vi.mock("@/lib/laboratory/server", () => ({ isLaboratoryMenuAvailable: async () => !state.labAssigned || state.lab }));
vi.mock("@/features/staff/department/server/subject-scope", () => ({ getViewerStaffScope: async () => state.scope }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { subjects: [] } }) }));
vi.mock("./prefill", () => ({ loadReportPrefill: state.prefill }));
import { reportViewer, canReadReport, listReports, requestStudents, getReport, groupStatusesOf } from "./queries";
import type { ReportListRow } from "../model";
const report = { requested_by: "requester", teacher_id: "actor", manager_id: "manager", director_id: "director", subjects: ["math"] } as WithdrawalReport;
describe("report read boundaries", () => {
  beforeEach(() => { state.user = { id: "actor", tenantId: "tenant", systemRole: "teacher" }; state.access = true; state.write = true; state.lab = true; state.labAssigned = true; state.scope = null; state.teacherId = null; state.db.mockReset(); });
  it("does not read storage when the laboratory is disabled", async () => {
    state.lab = false;
    expect(await reportViewer()).toBeNull();
    expect((await listReports()).available).toBe(false);
    expect(await requestStudents()).toEqual([]);
    expect(state.db).not.toHaveBeenCalled();
  });
  it("opens as a general menu once the console unassigns it, even without the laboratory", async () => {
    state.lab = false; state.labAssigned = false;
    expect(await reportViewer()).not.toBeNull();
  });
  it("does not read storage with a denied menu", async () => {
    state.access = false;
    expect(await reportViewer()).toBeNull();
    expect(await requestStudents()).toEqual([]);
    expect(state.db).not.toHaveBeenCalled();
  });
  it("teacher cannot obtain the academy-wide request student picker", async () => {
    expect((await reportViewer())?.request).toBe(false);
    expect(await requestStudents()).toEqual([]);
    expect(state.db).not.toHaveBeenCalled();
  });
  it("readonly viewers cannot request changes", async () => {
    state.user.systemRole = "master"; state.write = false;
    expect((await reportViewer())?.request).toBe(false);
    expect(await requestStudents()).toEqual([]);
  });
  it("offers only current enrollments in operating classes", async () => {
    state.user.systemRole = "master";
    const course = { id: "open", start_date: "2020-01-01", end_date: null, on_hold: false, is_transferred: false, classes: { id: "open", class_name: "운영 반", subject: "math", teacher_id: "teacher", teacher: { display_name: "담임" }, is_active: true, closed_at: null } };
    const enrollments = [course,
      { ...course, id: "ended", classes: { ...course.classes, closed_at: "2020-01-01" } },
      { ...course, id: "inactive", classes: { ...course.classes, is_active: false } },
      { ...course, id: "past-enrollment", end_date: "2020-01-02" },
    ];
    const q = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), is: vi.fn(), order: vi.fn(), range: vi.fn() };
    for (const fn of Object.values(q)) fn.mockReturnValue(q);
    q.range.mockResolvedValue({ data: [{ id: "student", name: "학생", school: "학교", grade: "중1", enrollments }], error: null });
    state.db.mockReturnValue({ from: () => q });
    expect((await requestStudents())[0].courses.map(c => c.id)).toEqual(["open"]);
  });
  it("teacher reads only their own participation", async () => {
    const viewer = (await reportViewer())!;
    expect(canReadReport(report, viewer)).toBe(true);
    expect(canReadReport({ ...report, teacher_id: "someone_else" }, viewer)).toBe(false);
  });
  it("an explicitly appointed reviewer can read each batch report, unrelated reviewers cannot", async () => {
    state.user.systemRole = "admin"; state.scope = ["math"];
    const viewer = (await reportViewer())!;
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_id: "actor" }, viewer)).toBe(true);
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_id: "actor", subjects: ["english"] }, viewer)).toBe(true);
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_ids: ["actor", "manager"] }, viewer)).toBe(true);
    // 원장 2026-10-30 — 관리자급은 승인자가 아니어도 담당 과목 보고서를 '열람'(쓰기는 DB 처리 함수가 따로 막는다).
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_ids: ["manager"] }, viewer)).toBe(true);
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_ids: ["manager"], subjects: ["english"] }, viewer)).toBe(false);
  });
  it("a manager reads by assigned subjects (no special scope → own subjects → none = all); a non-manager role reads only participation", async () => {
    state.user.systemRole = "manager"; state.scope = null;
    let own: string[] = ["math"];
    const users = { select: () => users, eq: () => users, maybeSingle: async () => ({ data: { subjects: own }, error: null }) };
    state.db.mockReturnValue({ from: () => users });
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_ids: ["manager"], subjects: ["english"] }, (await reportViewer())!)).toBe(false);
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_ids: ["manager"], subjects: ["math"] }, (await reportViewer())!)).toBe(true);
    own = [];
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_ids: ["manager"], subjects: ["english"] }, (await reportViewer())!)).toBe(true);
    state.user.systemRole = "counselor";
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_ids: ["manager"] }, (await reportViewer())!)).toBe(false);
  });
  it("principal reads reports in their tenant query", async () => {
    state.user.systemRole = "master";
    expect(canReadReport({ ...report, teacher_id: "someone_else" }, (await reportViewer())!)).toBe(true);
  });
  it("a principal in teacher view sees only their authored reports and cannot request new reports", async () => {
    state.user.systemRole = "master"; state.teacherId = "actor";
    const viewer = (await reportViewer())!;
    expect(viewer.request).toBe(false);
    expect(viewer.manage).toBe(false);
    expect(canReadReport({ ...report, requested_by: "actor", teacher_id: "someone_else" }, viewer)).toBe(false);
    expect(canReadReport(report, viewer)).toBe(true);
  });
});

describe("automatic report fields stay within a fresh authorized draft", () => {
  const snapshot = { name: "테스트", school: null, grade: null, enrolledAt: null, status: "enrolled", withdrawnAt: null, courses: [] };
  const draft = { ...report, id: "report", tenant_id: "tenant", student_id: "student", status: "requested", snapshot, body: EMPTY_BODY } as WithdrawalReport;
  function storage(r: WithdrawalReport, actions: string[] = []) {
    const from = vi.fn((table: string) => {
      const result = table === "withdrawal_reports" ? r : table === "withdrawal_report_events" ? actions.map(action => ({ action })) : { ...snapshot, enrolled_at: null, withdrawn_at: null, enrollments: [] };
      const q = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), order: vi.fn(), limit: vi.fn() };
      for (const fn of Object.values(q)) fn.mockReturnValue(q);
      q.maybeSingle.mockResolvedValue({ data: result, error: null });
      q.limit.mockResolvedValue({ data: result, error: null });
      return q;
    });
    state.db.mockReturnValue({ from });
    return from;
  }
  beforeEach(() => {
    state.user = { id: "actor", tenantId: "tenant", systemRole: "teacher" }; state.access = true; state.lab = true;
    state.db.mockReset(); state.prefill.mockReset().mockResolvedValue({ prefill: { attendance: "자동 출결" } });
  });
  it("fills a fresh draft after report and live student validation", async () => {
    storage(draft);
    expect((await getReport("report"))?.prefill).toEqual({ attendance: "자동 출결" });
    expect(state.prefill).toHaveBeenCalledWith(draft, "teacher");
  });
  it("refreshes automatic billing for previously saved drafts", async () => {
    storage(draft, ["save"]);
    await getReport("report");
    expect(state.prefill).toHaveBeenCalledWith(draft, "teacher");
  });
  it("keeps a submitted document unchanged", async () => {
    storage({ ...draft, status: "manager_pending" }, ["submit"]);
    expect((await getReport("report"))?.prefill).toBeUndefined();
    expect(state.prefill).not.toHaveBeenCalled();
  });
  it("does not read auxiliary sources for a nonparticipant", async () => {
    const from = storage({ ...draft, teacher_id: "someone-else" });
    expect(await getReport("report")).toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
    expect(state.prefill).not.toHaveBeenCalled();
  });
  it("does not change a completed report", async () => {
    storage({ ...draft, status: "completed" });
    expect((await getReport("report"))?.prefill).toBeUndefined();
    expect(state.prefill).not.toHaveBeenCalled();
  });
});

describe("groupStatusesOf — 승인 완료 줄의 묶음 형제 상태(목록 상태 칸 · 리뷰 2026-11-06)", () => {
  beforeEach(() => { state.db.mockReset(); });
  const row = (over: Partial<ReportListRow>) => ({ id: "r1", group_id: "g1", status: "approved", ...over }) as ReportListRow;
  /** from → select → eq → in(마지막 · 결과) 사슬을 적어 두는 가짜 조회. */
  const fake = (result: { data: unknown[] | null; error: { message: string } | null }) => {
    const calls = { from: [] as string[], select: [] as string[], eq: [] as unknown[][], in: [] as unknown[][] };
    const q = {
      select: (c: string) => { calls.select.push(c); return q; },
      eq: (...a: unknown[]) => { calls.eq.push(a); return q; },
      in: async (...a: unknown[]) => { calls.in.push(a); return result; },
    };
    state.db.mockReturnValue({ from: (t: string) => { calls.from.push(t); return q; } });
    return calls;
  };
  it("승인 완료 줄의 묶음만 · 같은 학원에서 · 묶음 id로 상태 한 칸만 읽어 묶음별로 모은다", async () => {
    const calls = fake({ data: [{ id: "r1", group_id: "g1", status: "approved" }, { id: "r2", group_id: "g1", status: "manager_pending" }], error: null });
    const out = await groupStatusesOf("tenant", [row({}), row({ id: "r1b", group_id: "g1" }), row({ id: "r3", group_id: "g2", status: "manager_pending" }), row({ id: "r4", group_id: null }), row({ id: "r5", group_id: "g3", status: "completed" })]);
    expect(calls.from).toEqual(["withdrawal_reports"]);
    expect(calls.select).toEqual(["id,group_id,status"]); // 본문·이름은 읽지 않는다
    expect(calls.eq).toEqual([["tenant_id", "tenant"]]); // 다른 학원 묶음은 안 섞인다
    expect(calls.in).toEqual([["group_id", ["g1"]]]); // 승인 완료 줄의 묶음만(중복 없이)
    expect(out).toEqual(new Map([["g1", [{ id: "r1", status: "approved" }, { id: "r2", status: "manager_pending" }]]]));
  });
  it("승인 완료 줄이 없으면 읽지 않고 빈 판", async () => {
    expect(await groupStatusesOf("tenant", [row({ status: "manager_pending" }), row({ id: "r2", group_id: null })])).toEqual(new Map());
    expect(state.db).not.toHaveBeenCalled();
  });
  it("못 읽으면 undefined — 목록 전체를 죽이지 않는다(조회 오류 · 클라이언트 오류 모두)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    fake({ data: null, error: { message: "boom" } });
    await expect(groupStatusesOf("tenant", [row({})])).resolves.toBeUndefined();
    state.db.mockImplementation(() => { throw new Error("no client"); });
    await expect(groupStatusesOf("tenant", [row({})])).resolves.toBeUndefined();
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});
