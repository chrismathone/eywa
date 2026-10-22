import { beforeEach, expect, it, vi } from "vitest";
import type { WithdrawalReport } from "../model";
import type { reportViewer } from "./queries";
const state = vi.hoisted(() => ({ access: true, from: vi.fn() }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => state.access }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: state.from }) }));
import { reportConsultations } from "./consultations";
const report = { tenant_id: "tenant", student_id: "student" } as WithdrawalReport;
const viewer = { teacherId: "teacher", user: { systemRole: "master" } } as NonNullable<Awaited<ReturnType<typeof reportViewer>>>;
beforeEach(() => { state.access = true; state.from.mockReset(); });
it("uses the consultation menu permission before reading records", async () => {
  state.access = false; expect(await reportConsultations(report, viewer)).toEqual([]); expect(state.from).not.toHaveBeenCalled();
});
it("limits choices to the report student, tenant, and teacher's own consultation records", async () => {
  const q = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() };
  for (const fn of Object.values(q)) fn.mockReturnValue(q);
  q.range.mockResolvedValue({ data: [{ id: "c", consulted_at: "2026-10-22", audience: "parent", summary: "상담 내용" }], error: null });
  state.from.mockReturnValue(q);
  expect(await reportConsultations(report, viewer)).toHaveLength(1);
  expect(q.eq).toHaveBeenCalledWith("tenant_id", "tenant"); expect(q.eq).toHaveBeenCalledWith("student_id", "student"); expect(q.eq).toHaveBeenCalledWith("counselor_id", "teacher");
});
