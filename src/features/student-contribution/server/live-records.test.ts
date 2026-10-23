import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ teacher: vi.fn(), settings: vi.fn(), cases: vi.fn() }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: m.teacher }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("@/features/makeups/server/queries", () => ({ getMakeupCases: m.cases }));
import { readLiveConsultations, readLiveMemos } from "./live-records";
import { readNativeMakeups } from "./live-makeups";
import type { LiveContext } from "./live-context";
import { markFolded } from "@/lib/folded-read";

function fixture(result: unknown) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "order"]) q[name] = vi.fn(() => q);
  q.limit = vi.fn(async () => result);
  const from = vi.fn(() => q);
  return { q, from, c: { db: { from }, tenant: "t", studentId: "s", consultations: true, makeups: true } as unknown as LiveContext };
}
beforeEach(() => { vi.resetAllMocks(); m.teacher.mockResolvedValue(null); m.settings.mockResolvedValue({ makeups: { mode: "on" } }); });
it("reads only the tenant/student/counselor scope and keeps exact count beyond five samples", async () => {
  const { q, c } = fixture({ data: [{ id: "r", summary: "학생이 수업 내용을 문의함", counselor: { display_name: "선생님" }, consulted_at: "2026-10-23" }], count: 1001, error: null });
  m.teacher.mockResolvedValue("teacher");
  const result = await readLiveConsultations(c);
  expect(q.eq).toHaveBeenCalledWith("tenant_id", "t"); expect(q.eq).toHaveBeenCalledWith("student_id", "s"); expect(q.eq).toHaveBeenCalledWith("counselor_id", "teacher");
  expect(q.limit).toHaveBeenCalledWith(5); expect(result.total).toBe(1001); expect(result.items).toHaveLength(1);
});
it("does not read a forbidden consultation source", async () => {
  const { c, from } = fixture({ data: [], count: 0 });
  expect((await readLiveConsultations({ ...c, consultations: false })).state).toBe("forbidden"); expect(from).not.toHaveBeenCalled();
});
it.each([["42501", "forbidden"], ["42P01", "schema_missing"], ["500", "failed"]])("distinguishes memo read errors: %s", async (code, state) => {
  const { c } = fixture({ data: null, count: null, error: { code } });
  const result = await readLiveMemos(c);
  expect(result).toMatchObject({ state, total: null, items: [] });
});
it("a missing count is not reported as zero", async () => {
  const { c } = fixture({ data: [], count: null, error: null });
  expect((await readLiveMemos(c)).state).toBe("failed");
});
it.each([true, false, null])("keeps the memo visible but requires an explicit searchable flag for AI: %s", async (searchable) => {
  const { c } = fixture({ data: [{ id: "m", content: "메모 본문", searchable }], count: 1, error: null });
  const result = await readLiveMemos(c);
  expect(result.items[0]).toMatchObject({ detail: "메모 본문", summaryExcluded: searchable !== true });
});
it("keeps native-off distinct from permission denial without invoking the RPC", async () => {
  const { c } = fixture(null);
  m.settings.mockResolvedValueOnce({ makeups: { mode: "off" } });
  expect((await readNativeMakeups({ ...c, makeups: false })).state).toBe("off");
  expect((await readNativeMakeups({ ...c, makeups: false })).state).toBe("forbidden");
  expect(m.cases).not.toHaveBeenCalled();
});
it("preserves RPC denial and reads native remainder without recomputation", async () => {
  const { c } = fixture(null);
  m.cases.mockResolvedValueOnce({ data: null, reason: "forbidden" });
  expect((await readNativeMakeups(c)).state).toBe("forbidden");
  m.cases.mockResolvedValueOnce({ data: { total: 45, rows: [{ id: "case", eligibility: "eligible", lifecycle: "open", outstanding_minutes: 17, committed_minutes: 9 }] } });
  const result = await readNativeMakeups(c);
  expect(result.total).toBe(45); expect(result.items[0].detail).toContain("17분"); expect(result.items[0].detail).toContain("9분");
  expect(m.cases).toHaveBeenCalledWith({ student_id: "s", page: 1, page_size: 5 });
});
it("does not call a failed settings read an off feature", async () => {
  const { c } = fixture(null);
  m.settings.mockResolvedValue(markFolded({ makeups: { mode: "off" } }, "settings unavailable"));
  expect(await readNativeMakeups(c)).toMatchObject({ state: "failed", total: null });
  expect(m.cases).not.toHaveBeenCalled();
});
