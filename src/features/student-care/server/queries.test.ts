import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ user: vi.fn(), level: vi.fn(), teacher: vi.fn(), scope: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: h.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: h.level }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: h.teacher }));
vi.mock("@/lib/supabase/server", () => ({ createClient: h.client }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { subjects: [
  { key: "math", label: "수학", color: "primary" }, { key: "english", label: "영어", color: "green" },
] } }) }));
vi.mock("@/features/students/server/read-scope", () => ({ teacherClassScopeStrict: h.scope, READ_GRACE_DAYS: 60 }));
vi.mock("@/lib/date-kst", async (original) => ({ ...await original<typeof import("@/lib/date-kst")>(), kstToday: () => "2026-10-20" }));
import { getStudentCare } from "./queries";
import { testDb } from "./test-db";
import { careFixture } from "../fixtures";

const studentId = careFixture().studentId;
let db: ReturnType<typeof testDb>;
let levels: Record<string, string>;
beforeEach(() => {
  vi.clearAllMocks();
  const f = careFixture();
  const scoped = (rows: object[]) => rows.map((row) => ({ ...row, tenant_id: "tenant-a", student_id: studentId }));
  db = testDb({
    students: [{ id: studentId, enrolled_at: f.enrolledAt, tenant_id: "tenant-a" }],
    enrollments: scoped(f.enrollments.rows.map((row) => ({ ...row, class_id: "class-a" }))),
    lesson_reports: scoped(f.reports.rows.map((row) => ({ ...row, revoked_at: null }))),
    student_grades: scoped(f.grades.rows), level_tests: scoped(f.levels.rows),
    attendance_records: scoped(f.attendance.rows), invoices: scoped(f.invoices.rows),
    student_consultations: scoped(f.consultations.rows.map((row) => ({ ...row, counselor_id: "teacher-a" }))),
  });
  levels = { students: "full", billing: "full", consultations: "full" };
  h.user.mockResolvedValue({ id: "teacher-a", tenantId: "tenant-a", systemRole: "master" });
  h.level.mockImplementation(async (_role, menu: string) => levels[menu] ?? "none");
  h.teacher.mockResolvedValue(null);
  h.scope.mockResolvedValue({ own: ["class-a"], slots: [], delegated: [] });
  h.client.mockResolvedValue(db);
});

describe("학생 관리 서버 경계", () => {
  it("학원 밖 학생은 원본 조회 전에 차단한다", async () => {
    db.tables.students![0]!.tenant_id = "tenant-b";
    expect(await getStudentCare(studentId)).toBeNull();
    expect(db.calls.map((c) => c.table)).toEqual(["students"]);
  });
  it("비로그인·학생 메뉴 권한 없음·잘못된 id는 조회하지 않는다", async () => {
    h.user.mockResolvedValue(null); expect(await getStudentCare(studentId)).toBeNull();
    h.user.mockResolvedValue({ id: "u", tenantId: "tenant-a", systemRole: "teacher" });
    levels.students = "none"; expect(await getStudentCare(studentId)).toBeNull();
    expect(await getStudentCare("invalid-id")).toBeNull();
    expect(db.calls).toHaveLength(0);
  });
  it("학생 열람이 가능해도 수납 권한이 없으면 금액 쿼리를 실행하지 않는다", async () => {
    levels.billing = "none";
    const result = await getStudentCare(studentId);
    expect(db.calls.some((c) => c.table === "invoices")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("300,000");
    expect(result?.sections.find((s) => s.key === "payments")?.state).toBe("restricted");
  });
  it("담당 학생과 최근 종료 유예를 확인하고 다른 강사의 상담을 제외한다", async () => {
    levels.students = "scoped"; levels.consultations = "scoped"; h.teacher.mockResolvedValue("teacher-a");
    db.tables.student_consultations!.push({ ...db.tables.student_consultations![0], id: "hidden", counselor_id: "teacher-b", summary: "비공개 상담 본문" });
    const result = await getStudentCare(studentId);
    expect(result).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain("비공개 상담 본문");
    db.tables.enrollments![0]!.end_date = "2026-01-01";
    expect(await getStudentCare(studentId)).toBeNull();
  });
  it("담당 범위 조회 실패가 전체 학생 접근으로 확대되지 않는다", async () => {
    levels.students = "scoped"; h.teacher.mockResolvedValue("teacher-a");
    h.scope.mockRejectedValue(new Error("scope offline"));
    await expect(getStudentCare(studentId)).rejects.toThrow("scope offline");
    expect(db.calls).toHaveLength(0);
  });
  it("학생 전체 열람 권한이 상담의 담당자 제한을 해제하지 않는다", async () => {
    levels.students = "full"; levels.consultations = "scoped";
    db.tables.student_consultations!.push({ ...db.tables.student_consultations![0], id: "hidden", counselor_id: "teacher-b", summary: "비공개 상담 본문" });
    expect(JSON.stringify(await getStudentCare(studentId))).not.toContain("비공개 상담 본문");
    expect(db.calls.find((c) => c.table === "student_consultations")?.filters).toContainEqual({ key: "counselor_id", value: "teacher-a", op: "eq" });
  });
  it("수강 확인 쿼리 실패도 차단한다", async () => {
    levels.students = "scoped"; h.teacher.mockResolvedValue("teacher-a"); db.failures.add("enrollments");
    await expect(getStudentCare(studentId)).rejects.toThrow();
    expect(db.calls.some((c) => c.table === "invoices")).toBe(false);
  });
  it("1000건을 넘는 보고서와 취소 보고서를 올바르게 처리한다", async () => {
    const row = db.tables.lesson_reports![0]!;
    db.tables.lesson_reports = Array.from({ length: 1001 }, (_, i) => ({ ...row, id: `report-${String(i).padStart(4, "0")}`, report_date: "2026-10-10" }));
    db.tables.lesson_reports.push({ ...row, id: "revoked", revoked_at: "2026-10-01T00:00:00Z" });
    const result = await getStudentCare(studentId);
    expect(result?.sections.find((s) => s.key === "homework")?.details.join(" ")).toContain("평가 0/1001건");
    expect(db.calls.filter((c) => c.table === "lesson_reports").map((c) => c.from)).toEqual([0, 1000]);
  });
  it("한 자료 조회 실패는 다른 자료를 유지하며 오류 상태로 표시한다", async () => {
    db.failures.add("invoices"); db.failures.add("student_consultations");
    const result = await getStudentCare(studentId);
    expect(result?.sections.find((s) => s.key === "payments")?.state).toBe("failed");
    expect(result?.sections.find((s) => s.key === "homework")?.state).toBe("ready");
    expect(result?.followupsState).toBe("failed");
  });
  it("모든 원본 조회는 학원 범위를 명시하고 상담 접근권한을 따로 따른다", async () => {
    levels.consultations = "none";
    const result = await getStudentCare(studentId);
    expect(result?.canWriteConsultation).toBe(false);
    expect(db.calls.some((c) => c.table === "student_consultations")).toBe(false);
    expect(db.calls.every((c) => c.filters.some((f) => f.key === "tenant_id" && f.value === "tenant-a"))).toBe(true);
  });
});
