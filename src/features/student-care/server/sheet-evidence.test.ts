import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/current-user";
const m = vi.hoisted(() => ({ from: vi.fn(), menu: vi.fn(), ecs: vi.fn(), mcs: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.menu }));
vi.mock("@/features/class-sheets/server/access", () => ({ requireEcsClassAccess: m.ecs }));
vi.mock("@/features/math-sheets/server/access", () => ({ requireMcsClassAccess: m.mcs }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-11-01" }));
import { resolveSheetEvidence, hasSheetProgress, sheetReferences } from "./sheet-evidence";
const user = { id: "user", tenantId: "tenant", systemRole: "teacher" } as CurrentUser;
const id = "00000000-0000-4000-8000-000000000001";
function query(data: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), lte: vi.fn(), or: vi.fn(), is: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(async () => ({ data, error: null })) };
  for (const key of ["select", "eq", "lte", "or", "is", "limit"] as const) q[key].mockReturnValue(q);
  return q;
}
const mark = { id, student_id: "student", class_id: "class", mark_date: "2026-10-01", progress_note: "Unit 3", score: null };
beforeEach(() => {
  vi.clearAllMocks(); m.menu.mockResolvedValue(true); m.ecs.mockResolvedValue({ ok: true, access: { tenantId: "tenant" } }); m.mcs.mockResolvedValue({ ok: true, access: { tenantId: "tenant" } });
  m.from.mockImplementation((table) => query(table === "enrollments" ? { id: "enrollment" } : mark));
});
describe("시트 증거의 원본 접근 경계", () => {
  it("반 연결이 없는 이관 보고서가 정상 시트 증거 조회를 막지 않는다", async () => {
    function listQuery(data: unknown[]) {
      const q = { ...query(data), order: vi.fn(), in: vi.fn(), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
      for (const key of ["select", "eq", "lte", "or", "is", "limit", "order", "in"] as const) q[key].mockReturnValue(q);
      return q;
    }
    const span = listQuery([{ class_id: "class", start_date: "2026-01-01", end_date: null }]);
    m.from.mockImplementation(t => t === "enrollments" ? span : listQuery(t === "lesson_reports" ? [
      { ...mark, id: "unlinked", class_id: null, mark_date: undefined, report_date: "2026-10-01", progress: "이관 진도" },
      { ...mark, mark_date: undefined, report_date: "2026-10-01", progress: "확인 가능한 진도" },
    ] : []));
    const result = await sheetReferences(user, "student");
    expect(span.in).toHaveBeenCalledWith("class_id", ["class"]);
    expect(result.warning).toBe(false);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].id).toBe(id);
  });
  it("메뉴와 담당 반 모두 허용되어야 개별 기록을 제공한다", async () => {
    m.menu.mockResolvedValueOnce(false);
    expect(await resolveSheetEvidence(user, "english_sheet", id, "student")).toBeNull(); expect(m.from).not.toHaveBeenCalled();
    m.ecs.mockResolvedValueOnce({ ok: false });
    expect(await resolveSheetEvidence(user, "english_sheet", id, "student")).toBeNull();
    expect((await resolveSheetEvidence(user, "english_sheet", id, "student"))?.href).toBe("/ecs/class/month?month=2026-10");
    expect(m.ecs).toHaveBeenCalledWith("class");
  });
  it("학생과 학원 필터를 강제하고 해당 날짜의 수강 기간을 확인한다", async () => {
    const row = query(mark), span = query(null); m.from.mockImplementation((t) => t === "enrollments" ? span : row);
    expect(await resolveSheetEvidence(user, "english_sheet", id, "student")).toBeNull();
    expect(row.eq).toHaveBeenCalledWith("tenant_id", "tenant"); expect(row.eq).toHaveBeenCalledWith("student_id", "student");
    expect(span.lte).toHaveBeenCalledWith("start_date", "2026-10-01");
    expect(span.or).toHaveBeenCalledWith("end_date.is.null,end_date.gte.2026-10-01");
  });
  it("빈 진도나 계획만으로는 증거를 만들지 않는다", () => {
    expect(hasSheetProgress({ ...mark, progress_note: " ", score: "" }, "english_sheet")).toBe(false);
    expect(hasSheetProgress({ ...mark, progress: "" }, "math_sheet")).toBe(false);
    expect(hasSheetProgress({ ...mark, progress_note: null, score: "18/20" }, "english_sheet")).toBe(true);
  });
  it("수학은 기존 시트의 발송·취소 규칙과 수학 반 권한으로 확인한다", async () => {
    const report = query({ ...mark, mark_date: undefined, report_date: "2026-10-01", progress: "중2 3단원" });
    m.from.mockImplementation((t) => t === "enrollments" ? query({ id: "enrollment" }) : report);
    expect((await resolveSheetEvidence(user, "math_sheet", id, "student"))?.href).toContain("/mcs/class/month?month=2026-10&student=student");
    expect(report.is).toHaveBeenCalledWith("revoked_at", null); expect(report.or.mock.calls[0][0]).toContain("classnote_status.eq.success");
    expect(m.mcs).toHaveBeenCalledWith("class"); expect(m.ecs).not.toHaveBeenCalled();
  });
});
