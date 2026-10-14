import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateEnrollmentDates } from "./actions";

const m = vi.hoisted(() => ({ user: vi.fn(), gate: vi.fn(), scope: vi.fn(), client: vi.fn(), admin: vi.fn(), audit: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("./date-access", () => ({ canEditEnrollmentDatesNow: m.gate, getEnrollmentDateAccess: m.scope }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));

const current = { start_date: "2026-01-01", end_date: null, student_id: "student", class_id: "class", is_transferred: false, is_transferred_in: false, withdrawal_reason: null };
function setup({ found = true, changed = true, attendanceError = false, attendanceCount = 0 } = {}) {
  const read = { select: vi.fn(), eq: vi.fn(), single: vi.fn().mockResolvedValue({ data: found ? current : null, error: null }) };
  read.select.mockReturnValue(read); read.eq.mockReturnValue(read);
  m.client.mockResolvedValue({ from: vi.fn().mockReturnValue(read) });
  const write = { update: vi.fn(), eq: vi.fn(), is: vi.fn(), select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: changed ? { id: "enrollment" } : null, error: null }) };
  write.update.mockReturnValue(write); write.eq.mockReturnValue(write); write.is.mockReturnValue(write); write.select.mockReturnValue(write);
  const count = { select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lte: vi.fn(), order: vi.fn(), limit: vi.fn().mockResolvedValue({ data: [{ session_date: "2026-01-02" }], count: attendanceCount, error: attendanceError ? { message: "failed" } : null }) };
  for (const name of ["select", "eq", "gte", "lte", "order"] as const) count[name].mockReturnValue(count);
  m.admin.mockReturnValue({ from: vi.fn((table) => table === "enrollments" ? write : count) });
  return { read, write, count };
}
function form(field = "start", value = "2025-12-01") {
  const fd = new FormData(); fd.set("enrollmentId", "enrollment"); fd.set("field", field); fd.set("value", value); return fd;
}
beforeEach(() => { vi.clearAllMocks(); m.user.mockResolvedValue({ id: "staff", tenantId: "tenant", systemRole: "viewer" }); m.gate.mockResolvedValue(true); m.scope.mockResolvedValue({ allowed: true, classIds: null }); });

describe("날짜 수정 저장 권한과 범위", () => {
  it("미로그인·기능 미지정은 데이터 조회 전 거절한다", async () => {
    m.user.mockResolvedValueOnce(null); expect((await updateEnrollmentDates(undefined, form()))?.error).toBeTruthy();
    m.gate.mockResolvedValue(false); expect((await updateEnrollmentDates(undefined, form()))?.error).toBe("수강 날짜를 수정할 권한이 없습니다");
    expect(m.client).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
  });
  it("메뉴 쓰기 없이 기능을 지정받아도 정해진 날짜 칸만 현재 지점에 저장한다", async () => {
    const q = setup(); expect((await updateEnrollmentDates(undefined, form()))?.ok).toBe(true);
    expect(q.read.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(q.write.update).toHaveBeenCalledWith({ start_date: "2025-12-01" });
    expect(q.write.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(q.write.eq).toHaveBeenCalledWith("start_date", "2026-01-01");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "enrollment_dates_update" }));
  });
  it("열람할 수 없는 수강·동시 변경은 성공으로 보고하지 않는다", async () => {
    let q = setup({ found: false }); expect((await updateEnrollmentDates(undefined, form()))?.error).toBeTruthy(); expect(q.write.update).not.toHaveBeenCalled();
    q = setup({ changed: false }); expect((await updateEnrollmentDates(undefined, form()))?.error).toContain("수강 정보가 변경");
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("기능 지정이 있어도 담당 범위 밖 수강은 저장 전에 거절한다", async () => {
    const q = setup(); m.scope.mockResolvedValue({ allowed: true, classIds: ["other"] });
    expect((await updateEnrollmentDates(undefined, form()))?.error).toBe("수강 날짜를 수정할 권한이 없습니다");
    expect(q.write.update).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
  });
  it("출결 조회가 실패하면 확인을 건너뛰지 않고 저장을 중단한다", async () => {
    const q = setup({ attendanceError: true }); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await updateEnrollmentDates(undefined, form("start", "2026-01-15")))?.error).toContain("출결 기록을 확인하지 못했습니다");
    expect(q.count.eq).toHaveBeenCalledWith("tenant_id", "tenant"); expect(q.write.update).not.toHaveBeenCalled(); log.mockRestore();
  });
  it("출결이 밀리면 기존 확인 절차가 먼저 실행된다", async () => {
    const q = setup({ attendanceCount: 3 }); const result = await updateEnrollmentDates(undefined, form("start", "2026-01-15"));
    expect(result?.confirm?.value).toBe("2026-01-15"); expect(q.write.update).not.toHaveBeenCalled();
  });
});
