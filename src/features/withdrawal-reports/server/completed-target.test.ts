import { describe, expect, it, vi } from "vitest";
import type { WithdrawalReport } from "../model";
const mocks = vi.hoisted(() => ({ single: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, single: mocks.single }; return q;
} }) }));
import { completedEnrollmentIds } from "./completed-target";
const report = { tenant_id: "tenant", group_id: "group", subjects: ["math"], enrollment_ids: ["a"], snapshot: { courses: [
  { id: "a", subject: "math" }, { id: "b", subject: "math" }, { id: "c", subject: "english" },
] } } as WithdrawalReport;
describe("completed report export targets", () => {
  it("exports exactly the approved enrollments across all sibling reports", async () => {
    mocks.single.mockResolvedValue({ data: { subjects: ["math", "english"], enrollment_ids: ["a", "c"] }, error: null });
    expect(await completedEnrollmentIds(report)).toEqual(["a", "c"]);
  });
  it("keeps legacy report export scope when enrollment IDs were not stored", async () => {
    expect(await completedEnrollmentIds({ ...report, group_id: null, enrollment_ids: null })).toEqual(["a", "b"]);
  });
  it("never broadens to all subject enrollments when reading the approved group fails", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await expect(completedEnrollmentIds(report)).rejects.toThrow("승인된 종료 반");
  });
});
