import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  resolve: vi.fn(),
  gate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: h.rpc, from: h.from }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true, accessLevelTenant: async () => "full" }));
vi.mock("@/features/attendance/server/auto-units", () => ({ resolveAutoUnits: h.resolve }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("./access", () => ({ requireEcsClassAccess: h.gate }));

import { clearPresentAttendance } from "./actions";

const input = { classId: "class-1", studentId: "student-1", date: "2026-09-22", slot: "15:00" };
beforeEach(() => {
  vi.clearAllMocks();
  h.gate.mockResolvedValue({ ok: true, access: { tenantId: "tenant-1", user: { id: "actor-1", systemRole: "master" } } });
  h.resolve.mockResolvedValue(new Map([["class-1|2026-09-22|15:00", 1.5]]));
  h.from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "학생" } }) }) }) }) });
  h.rpc.mockResolvedValue({ data: { cleared: 1 }, error: null });
});

describe("ECS 자동 시수 출석 취소", () => {
  it("클라이언트가 보낸 하루 합 대신 서버 교시 기본값 1.5로 취소한다", async () => {
    expect(await clearPresentAttendance({ ...input, autoUnits: 4 })).toEqual({ ok: true, cleared: 1 });
    expect(h.resolve).toHaveBeenCalledWith(expect.anything(), [
      { classId: input.classId, date: input.date, slotStart: input.slot },
    ], { tenantId: "tenant-1" });
    expect(h.rpc).toHaveBeenCalledWith("ecs_clear_present", expect.objectContaining({
      p_tenant: "tenant-1", p_class: input.classId, p_student: input.studentId, p_slot: "15:00", p_auto_units: 1.5,
    }));
  });
  it("수동 2.5를 자동값이라고 보내도 허용하지 않고 RPC의 보호 결과를 따른다", async () => {
    h.rpc.mockResolvedValue({ data: { blocked: "rich" }, error: null });
    expect(await clearPresentAttendance({ ...input, autoUnits: 2.5 })).toMatchObject({ ok: false });
    expect(h.rpc).toHaveBeenCalledWith("ecs_clear_present", expect.objectContaining({ p_auto_units: 1.5 }));
    expect(h.from).not.toHaveBeenCalled();
  });
  it("옛 교시 미지정 기록의 자동값 취소 호환성을 유지한다", async () => {
    expect(await clearPresentAttendance({ ...input, slot: null, autoUnits: 1.8 })).toEqual({ ok: true, cleared: 1 });
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith("ecs_clear_present", expect.objectContaining({ p_slot: null, p_auto_units: 1.8 }));
  });
  it("반 접근 권한이 없으면 시수 조회와 삭제 모두 하지 않는다", async () => {
    h.gate.mockResolvedValue({ ok: false, error: "접근 불가" });
    expect(await clearPresentAttendance(input)).toEqual({ ok: false, error: "접근 불가" });
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
