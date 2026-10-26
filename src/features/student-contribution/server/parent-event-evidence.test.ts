import { beforeEach, expect, it, vi } from "vitest";
const student = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", source = "a".repeat(64);
const state = vi.hoisted(() => ({ linked: true, status: "applied", reads: [] as string[], filters: [] as unknown[][] }));
const gate = vi.hoisted(() => vi.fn(async () => ({ tenantId: "tenant" })));
vi.mock("./access", () => ({ requireContributionWrite: gate }));
vi.mock("./identity-query", () => ({ getContributionReadIdentity: async () => ({ ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"], canonical: (id: string) => id }) }));
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPagedInChunks: async (ids: string[], query: (ids: string[], a: number, b: number) => Promise<{ data: unknown }>) => (await query(ids, 0, 999)).data }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  state.reads.push(table);
  const q = { select: () => q, eq: (key: string, value: unknown) => { state.filters.push([table, key, value]); return q; }, in: () => q,
    contains: () => q, order: () => q, range: async () => ({ data: state.linked ? [{ event_id: "event" }] : [], error: null }),
    maybeSingle: async () => ({ data: table === "student_parent_event_imports" ? { status: state.status }
      : { event_id: "event", source_file: "verified-file", source_sheet: 1, source_row: 2, state: "recognized", import_id: "import" }, error: null }) };
  return q;
} }) }));
import { getParentEventEvidence } from "./parent-event-evidence";
beforeEach(() => { state.linked = true; state.status = "applied"; state.reads = []; state.filters = []; gate.mockReset(); gate.mockResolvedValue({ tenantId: "tenant" }); });
it("checks write permission before source reads and rejects unknown students", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  gate.mockRejectedValueOnce(new Error("denied"));
  expect(await getParentEventEvidence(source, student)).toHaveProperty("error");
  expect(state.reads).toEqual([]);
  expect(await getParentEventEvidence(source, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toHaveProperty("error");
  expect(state.reads).toEqual([]); warning.mockRestore();
});
it("returns only a safe location for the linked student and scopes every table to the academy", async () => {
  expect(await getParentEventEvidence(source, student)).toEqual({ url: "https://docs.google.com/spreadsheets/d/verified-file/edit#gid=1&range=A2", row: 2, cancelled: false });
  for (const table of state.reads) expect(state.filters).toContainEqual([table, "tenant_id", "tenant"]);
});
it("rejects an unlinked source or a revoked import", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  state.linked = false; expect(await getParentEventEvidence(source, student)).toHaveProperty("error");
  state.linked = true; state.status = "revoked"; expect(await getParentEventEvidence(source, student)).toHaveProperty("error");
  warning.mockRestore();
});
