import { beforeEach, describe, expect, it, vi } from "vitest";

// 원생 보호자2 저장(s2_0024) — 수정 저장의 칸 가드 · 정규화 · 검증(보호자2만 · 보호자1은 종전 그대로). DB는 가짜.
const m = vi.hoisted(() => ({ client: vi.fn(), update: vi.fn(), insert: vi.fn(),
  row: { status: "enrolled", withdrawn_at: null, withdrawal_metadata: null, name: "Synthetic", notes: null } }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "actor", tenantId: "tenant", systemRole: "admin" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canManageTenant: async () => true, canWriteTenant: async () => true, accessLevelTenant: async () => "full" }));
vi.mock("./status-access", () => ({ canManageStudentStatusNow: async () => false }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { schoolSaveAliases: [] } }) }));
vi.mock("@/features/schools/server/complete-kind", () => ({ completeSchoolKind: async (_db: unknown, _t: unknown, school: string | null) => school }));
vi.mock("./unique-name", () => ({ resolveUniqueStudentNameFor: async (_db: unknown, _t: unknown, name: string) => ({ name, suffixed: false }) }));
vi.mock("@/lib/license/server", () => ({ seatBlockReason: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { createStudent, updateStudent } from "./actions";
import { GUARDIAN2_NAME_MAX } from "../guardian";

function form() {
  const fd = new FormData();
  fd.set("id", "student");
  fd.set("name", "Synthetic");
  return fd;
}
const guardian2 = (fd: FormData, v: { name?: string; phone?: string; relation?: string }) => {
  fd.set("parent2Name", v.name ?? "");
  fd.set("parent2Phone", v.phone ?? "");
  fd.set("parent2Relation", v.relation ?? "");
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const k of ["select", "eq", "is"]) q[k] = vi.fn(() => q);
  q.update = m.update.mockReturnValue(q);
  q.insert = m.insert.mockReturnValue(q);
  q.single = vi.fn(async () => ({ data: m.insert.mock.calls.length ? { id: "student" } : m.row, error: null }));
  q.maybeSingle = vi.fn(async () => ({ data: { id: "student" }, error: null }));
  m.client.mockResolvedValue({ from: vi.fn(() => q) });
});

describe("원생 보호자2 저장(s2_0024)", () => {
  it("🔴 보호자2 칸이 없는 저장(옛 화면)은 보호자2를 건드리지 않는다", async () => {
    expect((await updateStudent(undefined, form()))?.ok).toBe(true);
    const patch = m.update.mock.calls[0]![0];
    expect(patch).not.toHaveProperty("parent2_name");
    expect(patch).not.toHaveProperty("parent2_phone");
    expect(patch).not.toHaveProperty("parent2_relation");
  });

  it("칸이 있는 저장('삭제' 뒤 빈 값)은 보호자2를 null로 지운다", async () => {
    expect((await updateStudent(undefined, guardian2(form(), {})))?.ok).toBe(true);
    expect(m.update.mock.calls[0]![0]).toMatchObject({ parent2_name: null, parent2_phone: null, parent2_relation: null });
  });

  it("연락처는 보호자1과 같게 정규화되고 형식이 틀리면 거절 · 등록도 같은 칸을 저장한다", async () => {
    expect((await updateStudent(undefined, guardian2(form(), { name: "김어머니", phone: "01033334444", relation: "모" })))?.ok).toBe(true);
    expect(m.update.mock.calls[0]![0]).toMatchObject({ parent2_name: "김어머니", parent2_phone: "010-3333-4444", parent2_relation: "모" });
    expect((await updateStudent(undefined, guardian2(form(), { phone: "12345" })))?.fieldErrors?.parent2Phone).toBe("연락처 형식을 확인해주세요");
    // 숫자가 하나도 없는 값은 보호자1과 같이 빈 값이 된다(정규화 규칙 그대로)
    expect((await updateStudent(undefined, guardian2(form(), { phone: "엄마폰" })))?.ok).toBe(true);
    expect(m.update.mock.calls.at(-1)![0]).toMatchObject({ parent2_phone: null });
    expect((await createStudent(undefined, guardian2(form(), { phone: "010 3333 4444", relation: "조모" })))?.ok).toBe(true);
    expect(m.insert.mock.calls[0]![0]).toMatchObject({ parent2_phone: "010-3333-4444", parent2_relation: "조모" });
  });

  it("관계는 목록(부·모·조부·조모·기타) 밖이면 거절 · 이름은 상한을 넘으면 거절 — 저장하지 않는다", async () => {
    const badRelation = await updateStudent(undefined, guardian2(form(), { relation: "이모" }));
    expect(badRelation?.fieldErrors?.parent2Relation).toBeTruthy();
    const longName = await updateStudent(undefined, guardian2(form(), { name: "가".repeat(GUARDIAN2_NAME_MAX + 1) }));
    expect(longName?.fieldErrors?.parent2Name).toBeTruthy();
    expect((await createStudent(undefined, guardian2(form(), { relation: "x".repeat(500) })))?.fieldErrors?.parent2Relation).toBeTruthy();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    // 상한 그대로는 받는다
    expect((await updateStudent(undefined, guardian2(form(), { name: "가".repeat(GUARDIAN2_NAME_MAX), relation: "기타" })))?.ok).toBe(true);
  });

  it("보호자1은 종전 그대로 — 관계·이름에 새 검사를 걸지 않는다", async () => {
    const fd = form();
    fd.set("parentRelation", "이모");
    fd.set("parentName", "가".repeat(GUARDIAN2_NAME_MAX + 10));
    expect((await updateStudent(undefined, fd))?.ok).toBe(true);
    expect(m.update.mock.calls[0]![0]).toMatchObject({ parent_relation: "이모" });
  });
});
