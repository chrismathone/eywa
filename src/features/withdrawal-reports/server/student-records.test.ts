import { beforeEach, describe, expect, it, vi } from "vitest";

// 게이트는 실물 `reportViewer`를 그대로 태운다(보고서 화면과 같은 판정) — 그 밑의 권한·실험실·사용자만 바꾼다.
const state = vi.hoisted(() => ({
  user: { id: "actor", tenantId: "tenant", systemRole: "teacher" },
  access: true,
  lab: true,
  scope: null as string[] | null,
  tables: {} as Record<string, { rows: unknown[]; error: unknown; calls: unknown[][] }>,
  db: vi.fn(),
}));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: async () => (state.user.systemRole === "teacher" ? state.user.id : null) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => state.access, canWriteTenant: async () => state.access }));
vi.mock("@/lib/laboratory/server", () => ({ isLaboratoryMenuAvailable: async () => state.lab }));
vi.mock("@/features/staff/department/server/subject-scope", () => ({ getViewerStaffScope: async () => state.scope }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { subjects: [] } }) }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock("./consultations", () => ({ reportConsultations: async () => [] }));
vi.mock("./prefill", () => ({ loadReportPrefill: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.db }));
import { loadStudentReportRecords } from "./student-records";

function table(name: string, rows: unknown[], error: unknown = null) {
  const calls: unknown[][] = [];
  state.tables[name] = { rows, error, calls };
}
function query(name: string) {
  const t = state.tables[name];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "or"]) q[m] = (...a: unknown[]) => (t.calls.push([m, ...a]), q);
  q.range = async () => ({ data: t.error ? null : t.rows, error: t.error });
  return q;
}
const report = (id: string, teacher: string, extra: Record<string, unknown> = {}) => ({
  id, teacher_id: teacher, requested_by: "requester", manager_id: "manager", director_id: null, manager_ids: ["manager"], director_ids: [],
  exit_kind: "withdrawal", subjects: ["math"], effective_date: "2026-03-31", status: "completed", group_id: "g1",
  snapshot: { courses: [{ teacherId: teacher, teacherName: `담임 ${teacher}` }] }, ...extra,
});
const archive = (id: string, teacher: string | null, subject: string | null) => ({
  id, subject, exit_date: "2026-03-20", raw_exit_date: "3/20", teacher_name: "옛 담임", class_name: "A반", mapped_teacher_id: teacher,
});

beforeEach(() => {
  state.user = { id: "actor", tenantId: "tenant", systemRole: "teacher" };
  state.access = true; state.lab = true; state.scope = null; state.tables = {};
  state.db.mockReset();
  state.db.mockReturnValue({ from: (name: string) => query(name) });
});

describe("퇴원 상세 — 학생별 퇴원보고서", () => {
  it("퇴원보고서 메뉴를 못 여는 사람에겐 카드 자체가 없고 저장소도 안 읽는다", async () => {
    state.access = false;
    expect(await loadStudentReportRecords("s1")).toEqual({ status: "hidden" });
    state.access = true; state.lab = false;
    expect(await loadStudentReportRecords("s1")).toEqual({ status: "hidden" });
    expect(state.db).not.toHaveBeenCalled();
  });

  it("강사는 본인 배정 보고서·본인 원본만 — 지점·학생 조건을 함께 건다", async () => {
    table("withdrawal_reports", [report("r1", "actor"), report("r2", "someone")]);
    table("withdrawal_report_archives", [archive("a1", "actor", "math"), archive("a2", "someone", "math")]);
    const res = await loadStudentReportRecords("s1");
    expect(res.status === "ok" && res.reports.map((r) => r.id)).toEqual(["r1"]);
    expect(res.status === "ok" && res.archives.map((a) => a.id)).toEqual(["a1"]);
    expect(res.status === "ok" && res.reports[0].teacherName).toBe("담임 actor");
    for (const name of ["withdrawal_reports", "withdrawal_report_archives"]) {
      expect(state.tables[name].calls).toContainEqual(["eq", "tenant_id", "tenant"]);
    }
    expect(state.tables.withdrawal_reports.calls).toContainEqual(["eq", "student_id", "s1"]);
    expect(state.tables.withdrawal_reports.calls).toContainEqual(["eq", "teacher_id", "actor"]);
    expect(state.tables.withdrawal_report_archives.calls).toContainEqual(["eq", "mapped_student_id", "s1"]);
    expect(state.tables.withdrawal_report_archives.calls).toContainEqual(["eq", "mapped_teacher_id", "actor"]);
  });

  it("관리자는 참여한 보고서만 · 원본은 담당 과목 범위(과목 미기재는 보인다)", async () => {
    state.user = { id: "manager", tenantId: "tenant", systemRole: "manager" };
    state.scope = ["math"];
    table("withdrawal_reports", [report("r1", "t1"), report("r2", "t2", { manager_id: "other", manager_ids: ["other"] })]);
    table("withdrawal_report_archives", [archive("a1", "t1", "math"), archive("a2", "t1", "english"), archive("a3", null, null)]);
    const res = await loadStudentReportRecords("s1");
    expect(res.status === "ok" && res.reports.map((r) => r.id)).toEqual(["r1"]);
    expect(res.status === "ok" && res.archives.map((a) => a.id)).toEqual(["a1", "a3"]);
  });

  it("준비 안 됨 · 조회 실패 · 0건을 가른다(빈 목록으로 위장하지 않는다)", async () => {
    table("withdrawal_reports", [], { code: "42P01", message: "relation does not exist" });
    table("withdrawal_report_archives", []);
    expect(await loadStudentReportRecords("s1")).toEqual({ status: "not_ready" });
    table("withdrawal_reports", [], { code: "57014", message: "timeout" });
    expect(await loadStudentReportRecords("s1")).toEqual({ status: "error" });
    table("withdrawal_reports", []);
    table("withdrawal_report_archives", [], { code: "08006", message: "connection failure" });
    expect(await loadStudentReportRecords("s1")).toEqual({ status: "error" });
    table("withdrawal_report_archives", []);
    expect(await loadStudentReportRecords("s1")).toEqual({ status: "ok", reports: [], archives: [], complete: false });
  });

  it("'없습니다'라고 단정할 수 있는 사람은 다 보는 원장뿐 — 참여 보고서만 보는 관리자·강사는 아니다", async () => {
    table("withdrawal_reports", []);
    table("withdrawal_report_archives", []);
    state.user = { id: "owner", tenantId: "tenant", systemRole: "master" };
    expect(await loadStudentReportRecords("s1")).toMatchObject({ status: "ok", complete: true });
    state.user = { id: "admin", tenantId: "tenant", systemRole: "admin" };
    expect(await loadStudentReportRecords("s1")).toMatchObject({ status: "ok", complete: false });
  });
});
