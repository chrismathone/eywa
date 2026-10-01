// 강의실 저장의 DB 오류가 "이유"로 보이는지([[#138]]) — 예전엔 23505 외엔 영문 원문이 그대로 떴다.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), write: vi.fn(), insert: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: mocks.write }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({ insert: mocks.insert }) }) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: mocks.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { createClassroom } from "./classroom-actions";

const form = (name: string) => {
  const fd = new FormData();
  fd.set("name", name);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "u1", tenantId: "t1", systemRole: "master" });
  mocks.write.mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("이름 중복(23505)은 보관한 강의실까지 쥔다는 이유로 말하고 경고 로그를 남긴다", async () => {
  mocks.insert.mockResolvedValue({
    error: { code: "23505", message: 'duplicate key value violates unique constraint "classrooms_tenant_name_idx"' },
  });
  const res = await createClassroom(undefined, form("302"));
  expect(res?.error).toBe("같은 이름의 강의실이 이미 있습니다(보관한 강의실 포함)");
  expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("owner.classroom.create");
  expect(mocks.log).not.toHaveBeenCalled();
});

it("모르는 오류는 영문 원문 대신 일반 문구 + 에러 로그", async () => {
  mocks.insert.mockResolvedValue({ error: { code: "XX000", message: "internal error: tuple concurrently updated" } });
  const res = await createClassroom(undefined, form("302"));
  expect(res?.error).toBe("강의실을 추가하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  expect(res?.error).not.toMatch(/internal|tuple/);
  const line = JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0]));
  expect(line.scope).toBe("owner.classroom.create");
  expect(line.message).toContain("tuple concurrently updated");
});
