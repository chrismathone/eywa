// 학생 등록의 23505를 제약별로 가른다([[#137]]) — 예전 translateDbError는 모든 중복을 "이름·학교·학년 중복"으로 말해
// 출결번호가 겹친 경우에도 이름 칸을 고치게 만들었다.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ id: "u1", tenantId: "t1", systemRole: "master" }),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({
  canManageTenant: async () => true,
  canWriteTenant: async () => true,
  accessLevelTenant: async () => "full",
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({ operations: { schoolSaveAliases: [] } }),
}));
vi.mock("@/lib/license/server", () => ({ seatBlockReason: async () => null }));
vi.mock("./unique-name", () => ({
  resolveUniqueStudentNameFor: async (_s: unknown, _t: string, name: string) => ({ name, suffixed: false }),
}));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ insert: () => ({ select: () => ({ single: mocks.insert }) }) }),
  }),
}));
import { createStudent } from "./actions";

const form = () => {
  const fd = new FormData();
  fd.set("name", "김민준");
  fd.set("school", "경명여중");
  fd.set("grade", "중1");
  fd.set("status", "enrolled");
  fd.set("attendanceCode", "1234");
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("출결번호 중복은 출결번호 칸에 붙고, 이름·학교·학년 중복이라고 말하지 않는다", async () => {
  mocks.insert.mockResolvedValue({
    data: null,
    error: { code: "23505", message: 'duplicate key value violates unique constraint "ux_students_attendance_code_active"' },
  });
  const res = await createStudent(undefined, form());
  expect(res?.fieldErrors?.attendanceCode).toContain("같은 출결번호");
  expect(res?.fieldErrors?.name).toBeUndefined();
  expect(res?.error).not.toContain("이름·학교·학년");
});

it("자연키 중복은 이름 칸에 붙는다", async () => {
  mocks.insert.mockResolvedValue({
    data: null,
    error: { code: "23505", message: 'duplicate key value violates unique constraint "ux_students_active_natural_key"' },
  });
  const res = await createStudent(undefined, form());
  expect(res?.fieldErrors?.name).toContain("같은 이름·학교·학년의 학생이 이미 있습니다");
});

it("모르는 오류는 영문 원문 없이 일반 문구", async () => {
  mocks.insert.mockResolvedValue({ data: null, error: { code: "XX000", message: "internal error" } });
  const res = await createStudent(undefined, form());
  expect(res?.error).toBe("학생을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  expect(res?.fieldErrors).toBeUndefined();
});
