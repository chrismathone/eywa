import { beforeEach, expect, it, vi } from "vitest";

/**
 * 재고관리 쓰기 게이트 — '다른 강사 뷰'면 대상 직원이 기록 명의다(실사 확인자·점검자·등록자, 원장 2026-11-05 강사뷰 전수).
 * 쓰기 권한도 대상 역할로 본다(canWriteTenant — '읽기' 강사뷰는 거기서 막힌다).
 */
const m = vi.hoisted(() => ({ user: vi.fn(), canWrite: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/lib/supabase/db-error", () => ({ explainDbError: vi.fn() }));
import { requireInventoryWrite } from "./access";

const actual = { id: "actual", tenantId: "t1", systemRole: "master", displayName: "원장" };
const target = { id: "target", tenantId: "t1", systemRole: "manager", displayName: "실장" };

beforeEach(() => {
  vi.clearAllMocks();
  m.canWrite.mockResolvedValue(true);
});

it("강사뷰면 대상 직원의 id·이름을 기록 명의로 돌려준다", async () => {
  m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? target : actual));
  expect(await requireInventoryWrite()).toEqual({ tenantId: "t1", userId: "target", displayName: "실장" });
  expect(m.canWrite).toHaveBeenCalledWith("manager", "inventory");
});

it("쓰기 권한이 없으면(읽기 강사뷰 포함) 거절", async () => {
  m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? target : actual));
  m.canWrite.mockResolvedValue(false);
  expect(await requireInventoryWrite()).toEqual({ error: "재고관리를 수정할 권한이 없습니다" });
});
