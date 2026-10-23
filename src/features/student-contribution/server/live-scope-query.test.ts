import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ gate: vi.fn(), user: vi.fn(), permission: vi.fn(), directory: vi.fn(), readable: vi.fn(), identity: vi.fn(), rpc: vi.fn() }));
vi.mock("./access", () => ({ getContributionGate: m.gate }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.permission }));
vi.mock("./directory", () => ({ getContributionDirectory: m.directory }));
vi.mock("./fact-access", () => ({ readableFactStudents: m.readable }));
vi.mock("./identity-query", () => ({ getContributionReadIdentity: m.identity }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: m.rpc }) }));
import { LIVE_SCOPE_VERSION } from "@/features/students/ontology/live-scope";
import { getCurrentOntologyScope } from "./live-scope-query";

const result = { version: LIVE_SCOPE_VERSION, asOf: "2026-10-23", checkedAt: "2026-10-23T00:00:00Z", total: 0, filteredTotal: 0,
  classCount: 0, teacherCount: 0, subjectCount: 0, unassignedClasses: 0, unresolvedAssignments: 0, page: 1, pageSize: 20,
  students: [], options: [], connections: [] };
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {});
  m.gate.mockResolvedValue({ tenantId: "tenant", canConfigure: false });
  m.user.mockResolvedValue({ systemRole: "teacher" }); m.permission.mockResolvedValue(true);
  m.directory.mockResolvedValue({ rows: ["a", "b", "old", "broken"].map((id) => ({ id })), subjects: [{ key: "math", label: "수학" }] });
  m.readable.mockResolvedValue(new Set(["a", "old", "broken"]));
  m.identity.mockResolvedValue({ resolve: (id: string) => id === "old" ? "b" : id === "broken" ? null : id, issues: [] });
  m.rpc.mockResolvedValue({ data: result, error: null });
});
afterEach(() => vi.restoreAllMocks());
it("stops before source or RPC reads when either gate or original menu is denied", async () => {
  m.gate.mockResolvedValueOnce(null);
  expect(await getCurrentOntologyScope({})).toBeNull();
  expect(m.permission).not.toHaveBeenCalled();
  m.permission.mockResolvedValue(false);
  expect(await getCurrentOntologyScope({})).toMatchObject({ state: "forbidden", data: null });
  expect(m.directory).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
});
it("pins tenant and intersects original student permissions before excluding merged or damaged identities", async () => {
  expect(await getCurrentOntologyScope({ entity: "other", page: "30" })).toMatchObject({ state: "ready", request: { id: "tenant", page: 1 } });
  expect(m.rpc).toHaveBeenCalledWith("student_ontology_current_scope", {
    p_tenant: "tenant", p_students: ["a"], p_kind: "academy", p_entity: "tenant", p_search: "", p_page: 30,
  });
  expect(m.permission).toHaveBeenCalledWith("teacher", "students");
});
it("rechecks source access on a subsequent read and does not restore old access from the monthly cache", async () => {
  await getCurrentOntologyScope({}); m.readable.mockResolvedValue(new Set());
  await getCurrentOntologyScope({});
  expect(m.rpc.mock.calls[1][1].p_students).toEqual([]);
});
it.each([["PGRST202", "schema_missing"], ["42501", "forbidden"], ["57014", "failed"]])("keeps RPC error %s distinct from an empty roster", async (code, state) => {
  m.rpc.mockResolvedValue({ data: null, error: { code } });
  expect(await getCurrentOntologyScope({})).toMatchObject({ state, data: null });
});
it("rejects malformed data and private students in the picker as well as the page", async () => {
  m.rpc.mockResolvedValueOnce({ data: {}, error: null });
  expect(await getCurrentOntologyScope({})).toMatchObject({ state: "failed", data: null });
  m.rpc.mockResolvedValueOnce({ data: { ...result, options: [{ kind: "student", id: "b", label: "비공개", students: 1 }] }, error: null });
  expect(await getCurrentOntologyScope({})).toMatchObject({ state: "failed", data: null });
});
it("fails closed if source scope cannot be read", async () => {
  m.readable.mockRejectedValue(new Error("unavailable"));
  expect(await getCurrentOntologyScope({})).toMatchObject({ state: "failed", data: null });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("uses configured subject labels and reports unresolved source assignments", async () => {
  m.rpc.mockResolvedValue({ data: { ...result, unresolvedAssignments: 1,
    options: [{ kind: "subject", id: "math", label: "math", students: 0 }],
    connections: [{ kind: "subject", id: "removed", label: "removed", students: 0 }] }, error: null });
  expect(await getCurrentOntologyScope({})).toMatchObject({ state: "partial", data: {
    options: [{ label: "수학" }], connections: [{ label: "과목 확인 필요" }],
  } });
});
it("does not reveal identity problems outside the reader's original scope", async () => {
  m.identity.mockResolvedValue({ resolve: (id: string) => id, issues: [{ studentId: "b" }] });
  expect(await getCurrentOntologyScope({})).toMatchObject({ state: "ready" });
  m.identity.mockResolvedValue({ resolve: (id: string) => id, issues: [{ studentId: "a" }] });
  expect(await getCurrentOntologyScope({})).toMatchObject({ state: "partial" });
});
it("enriches only allowed picker students with school and grade without selecting one for an empty entity", async () => {
  m.directory.mockResolvedValue({ rows: [{ id: "a", school: "침산초", grade: "초4" }, { id: "b", school: "비공개초", grade: "초3" }], subjects: [] });
  m.rpc.mockResolvedValue({ data: { ...result, options: [{ kind: "student", id: "a", label: "안도현", students: 1 }] }, error: null });
  const view = await getCurrentOntologyScope({ kind: "student", entity: "" });
  expect(view).toMatchObject({ request: { kind: "student", id: "" }, data: { options: [{ id: "a", detail: "침산초4" }] } });
  expect(m.rpc.mock.lastCall?.[1]).toMatchObject({ p_students: ["a"], p_entity: "" });
  expect(JSON.stringify(view)).not.toContain("비공개초");
});
