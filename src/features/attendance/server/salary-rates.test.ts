import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ access: vi.fn(), manage: vi.fn(), scope: vi.fn(), from: vi.fn(), replies: [] as unknown[], writes: [] as unknown[], classes: vi.fn() }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: h.access }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canManageTenant: h.manage }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: h.scope }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./teacher-axis-queries", () => ({ loadClassAxisRows: h.classes }));
import { getAttendanceSalaryRates } from "./salary-rates";
import { saveAttendanceSalaryRates } from "./salary-rates-actions";
const teacherId = "aaaaaaaa-1111-1111-1111-111111111111";
const rates = { regular: { 초등: 40, 중등: 45, 고등: 50 }, special: { 초등: 55, 중등: 60, 고등: 65 }, classes: {} };

beforeEach(() => {
  vi.clearAllMocks(); h.replies = []; h.writes = [];
  h.access.mockResolvedValue({ id: "admin", tenantId: "tenant", systemRole: "admin" });
  h.manage.mockResolvedValue(true); h.scope.mockResolvedValue(null); h.classes.mockResolvedValue([]);
  h.from.mockImplementation(() => {
    const result = h.replies.shift() ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "maybeSingle"]) builder[method] = () => builder;
    builder.upsert = (payload: unknown) => { h.writes.push(payload); return builder; };
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  });
});
it.each(["teacher", "accountant", "viewer"])("never reads or writes salary rates for %s", async (systemRole) => {
  h.access.mockResolvedValue({ id: teacherId, tenantId: "tenant", systemRole });
  expect(await getAttendanceSalaryRates(teacherId)).toBeNull();
  expect((await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates })).ok).toBe(false);
  expect(h.from).not.toHaveBeenCalled();
});
it("does not expose rates in an administrator's teacher preview", async () => {
  h.scope.mockResolvedValue(teacherId);
  expect(await getAttendanceSalaryRates(teacherId)).toBeNull();
  expect(h.from).not.toHaveBeenCalled();
});
it("respects the attendance administrator permission gate", async () => {
  h.manage.mockResolvedValue(false);
  expect((await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates })).ok).toBe(false);
  expect(h.from).not.toHaveBeenCalled();
});
it("saves the six rates for only the selected freelance teacher in the authenticated tenant", async () => {
  h.replies = [{ data: { employment_type: "프리랜서" }, error: null }, { data: null, error: null }, { error: null }];
  expect(await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates })).toEqual({ ok: true });
  expect(h.writes).toEqual([expect.objectContaining({ tenant_id: "tenant", teacher_id: teacherId, rates, updated_by: "admin" })]);
});
it("rejects a rate for an unrelated class and invalid ranges without saving", async () => {
  expect((await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates: { ...rates, special: { 고등: 101 } } })).ok).toBe(false);
  h.replies = [{ data: { employment_type: "프리랜서" }, error: null }, { data: null, error: null }];
  expect((await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates: { ...rates, classes: { [teacherId]: 40 } } })).ok).toBe(false);
  expect(h.writes).toEqual([]);
});
it("loads saved six-way rates without reverting to legacy rates", async () => {
  h.replies = [{ data: { employment_type: "프리랜서", commission_rate: 10, commission_rates: {} }, error: null }, { data: { rates, updated_at: "2026-09-21" }, error: null }];
  expect(await getAttendanceSalaryRates(teacherId)).toMatchObject({ rates });
});
