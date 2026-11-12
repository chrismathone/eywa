import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMyReportAuthorSettings, resolveReportAuthorSettings } from "./report-author-name";

const admin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin }));
function query(data: unknown, error: { message: string } | null = null) {
  const q = { select: vi.fn(), eq: vi.fn(), neq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.neq.mockReturnValue(q);
  q.limit.mockResolvedValue({ data, error }); q.maybeSingle.mockResolvedValue({ data, error });
  admin.mockReturnValue({ from: vi.fn().mockReturnValue(q) }); return q;
}
beforeEach(() => vi.clearAllMocks());
describe("수업보고서 이름 설정 조회", () => {
  it("테넌트·raw 이름·직원만 조회하고 동명 판정에 필요한 두 행을 읽는다", async () => {
    const q = query([{ display_name: "강사 ", report_display_name: "Jane", report_class_name_prefix: true }]);
    expect(await resolveReportAuthorSettings("tenant", "강사 ")).toEqual({ name: "Jane", includeClassName: true, englishName: null });
    expect(q.eq.mock.calls).toEqual([["tenant_id", "tenant"], ["display_name", "강사 "]]);
    expect(q.neq).toHaveBeenCalledWith("system_role", "student"); expect(q.limit).toHaveBeenCalledWith(2);
  });
  it("동명 직원은 다른 사람의 설정을 붙이지 않는다", async () => {
    query([{ display_name: "강사", report_display_name: "Jane", report_class_name_prefix: true },
      { display_name: "강사", report_display_name: null, report_class_name_prefix: false }]);
    expect(await resolveReportAuthorSettings("tenant", "강사")).toEqual({ name: null, includeClassName: false, englishName: null });
  });
  it("내 정보 프리필은 id와 테넌트를 함께 제한한다", async () => {
    const q = query({ report_display_name: " Jane ", report_class_name_prefix: true });
    expect(await fetchMyReportAuthorSettings("self", "tenant")).toEqual({ name: "Jane", includeClassName: true });
    expect(q.eq.mock.calls).toEqual([["id", "self"], ["tenant_id", "tenant"]]);
  });
  it("조회 실패 시 공개 보고서가 멈추지 않고 실명·접두 꺼짐으로 돌아간다", async () => {
    query(null, { message: "report_class_name_prefix does not exist" });
    expect(await resolveReportAuthorSettings("tenant", "강사")).toEqual({ name: null, includeClassName: false });
  });
  it("새 칸 미적용 시에도 기존 발송용 이름은 보존한다", async () => {
    const q = query(null);
    q.limit.mockResolvedValueOnce({ data: null, error: { message: "column report_class_name_prefix does not exist" } })
      .mockResolvedValueOnce({ data: [{ display_name: "강사", report_display_name: "Jane" }], error: null });
    expect(await resolveReportAuthorSettings("tenant", "강사")).toEqual({ name: "Jane", includeClassName: false, englishName: null });
    expect(q.select).toHaveBeenLastCalledWith("display_name, report_display_name, english_name");
    q.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "column report_class_name_prefix does not exist" } })
      .mockResolvedValueOnce({ data: { report_display_name: "Jane" }, error: null });
    expect(await fetchMyReportAuthorSettings("self", "tenant")).toEqual({ name: "Jane", includeClassName: false });
  });
});
