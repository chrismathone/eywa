import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateMyReportName } from "./me-actions";

const m = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), resolve: vi.fn(), log: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/features/onescreen/server/report-author-name", () => ({ resolveReportAuthorSettings: m.resolve }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));

function form(name: string, prefix?: string) {
  const data = new FormData(); data.set("reportName", name);
  if (prefix !== undefined) data.set("includeClassName", prefix);
  data.set("userId", "other-user"); data.set("tenantId", "other-tenant");
  return data;
}
function database(error: { message: string } | null = null) {
  const q = { update: vi.fn(), eq: vi.fn() };
  q.update.mockReturnValue(q); q.eq.mockReturnValueOnce(q).mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue(q); m.admin.mockReturnValue({ from }); return { q, from };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "self", tenantId: "tenant", displayName: "강사" });
  m.resolve.mockResolvedValue({ name: "Jane", includeClassName: true });
});

describe("수업보고서 이름·반명 설정 저장", () => {
  it("본인·현재 지점만 두 값을 한번에 갱신한다", async () => {
    const { q } = database();
    expect((await updateMyReportName(undefined, form(" Jane ", "true")))?.ok).toBe(true);
    expect(q.update).toHaveBeenCalledWith({ report_display_name: "Jane", report_class_name_prefix: true });
    expect(q.eq.mock.calls).toEqual([["id", "self"], ["tenant_id", "tenant"]]);
    expect(m.revalidate).toHaveBeenCalledWith("/onescreen");
  });
  it("꺼짐은 false 저장, 구버전 폼은 옵션을 덮어쓰지 않는다", async () => {
    let db = database();
    await updateMyReportName(undefined, form("Jane", "false"));
    expect(db.q.update).toHaveBeenCalledWith({ report_display_name: "Jane", report_class_name_prefix: false });
    db = database();
    await updateMyReportName(undefined, form("Jane"));
    expect(db.q.update).toHaveBeenCalledWith({ report_display_name: "Jane" });
  });
  it("미로그인·변조 값·긴 이름은 DB를 갱신하지 않는다", async () => {
    m.user.mockResolvedValueOnce(null);
    expect((await updateMyReportName(undefined, form("Jane", "true")))?.error).toBeTruthy();
    expect((await updateMyReportName(undefined, form("Jane", "yes")))?.error).toBeTruthy();
    expect((await updateMyReportName(undefined, form("x".repeat(31), "true")))?.error).toBeTruthy();
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("저장 실패를 성공으로 알리거나 감사로그에 남기지 않는다", async () => {
    database({ message: "failure" }); vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await updateMyReportName(undefined, form("Jane", "true")))?.error).toBeTruthy();
    expect(m.log).not.toHaveBeenCalled(); expect(m.resolve).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("실명에 반명을 붙이되 동명 직원이면 적용된다고 거짓 안내하지 않는다", async () => {
    database(); m.resolve.mockResolvedValue({ name: null, includeClassName: true });
    expect((await updateMyReportName(undefined, form("", "true")))?.notice).toContain("반명 뒤에 이름");
    database(); m.resolve.mockResolvedValue({ name: null, includeClassName: false });
    expect((await updateMyReportName(undefined, form("", "true")))?.notice).toContain("적용되지 않습니다");
  });
});
