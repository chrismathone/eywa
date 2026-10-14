import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WithdrawalReport } from "../model";
const state = vi.hoisted(() => ({ user: { id: "actor", tenantId: "tenant", systemRole: "teacher" }, access: true, write: true, lab: true, scope: null as string[] | null, db: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => state.access, canWriteTenant: async () => state.write }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: async () => state.lab }));
vi.mock("@/features/staff/server/subject-scope", () => ({ getViewerStaffScope: async () => state.scope }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.db }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { subjects: [] } }) }));
import { reportViewer, canReadReport, listReports, requestStudents } from "./queries";
const report = { requested_by: "requester", teacher_id: "actor", manager_id: "manager", director_id: "director", subjects: ["math"] } as WithdrawalReport;
describe("report read boundaries", () => {
  beforeEach(() => { state.user = { id: "actor", tenantId: "tenant", systemRole: "teacher" }; state.access = true; state.write = true; state.lab = true; state.scope = null; state.db.mockReset(); });
  it("does not read storage when the laboratory is disabled", async () => {
    state.lab = false;
    expect(await reportViewer()).toBeNull();
    expect((await listReports()).available).toBe(false);
    expect(await requestStudents()).toEqual([]);
    expect(state.db).not.toHaveBeenCalled();
  });
  it("does not read storage with a denied menu", async () => {
    state.access = false;
    expect(await reportViewer()).toBeNull();
    expect(await requestStudents()).toEqual([]);
    expect(state.db).not.toHaveBeenCalled();
  });
  it("teacher cannot obtain the academy-wide request student picker", async () => {
    expect((await reportViewer())?.request).toBe(false);
    expect(await requestStudents()).toEqual([]);
    expect(state.db).not.toHaveBeenCalled();
  });
  it("readonly viewers cannot request changes", async () => {
    state.user.systemRole = "master"; state.write = false;
    expect((await reportViewer())?.request).toBe(false);
    expect(await requestStudents()).toEqual([]);
  });
  it("teacher reads only their own participation", async () => {
    const viewer = (await reportViewer())!;
    expect(canReadReport(report, viewer)).toBe(true);
    expect(canReadReport({ ...report, teacher_id: "someone_else" }, viewer)).toBe(false);
  });
  it("an explicitly appointed reviewer can read each batch report, unrelated reviewers cannot", async () => {
    state.user.systemRole = "admin"; state.scope = ["math"];
    const viewer = (await reportViewer())!;
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_id: "actor" }, viewer)).toBe(true);
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_id: "actor", subjects: ["english"] }, viewer)).toBe(true);
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_ids: ["actor", "manager"] }, viewer)).toBe(true);
    expect(canReadReport({ ...report, teacher_id: "teacher", manager_ids: ["manager"] }, viewer)).toBe(false);
  });
  it("principal reads reports in their tenant query", async () => {
    state.user.systemRole = "master";
    expect(canReadReport({ ...report, teacher_id: "someone_else" }, (await reportViewer())!)).toBe(true);
  });
});
