import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ unsafe: vi.fn(), begin: vi.fn(), leased: true }));
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ agentDb: () => ({ begin: h.begin }) }));
import catalog from "./query-catalog.json";
import { runAgentQuery } from "./gateway";

const device = { id: "f63a2ad4-f611-4f98-961a-d6d31f182501", tenantId: "0e87118f-5c4c-4b23-9607-31f94e0e21a2" };
const envelope = { instanceId: "76146484-402e-499e-841d-d14589672be5", generation: "1", module: "makeedu" };
const find = (text: string) => Object.entries(catalog).find(([, row]) => row.parts.join("").includes(text))![0];
const heartbeat = { ...envelope, id: find("insert into makeedu_sync_workers"), parameters: [device.tenantId, "fixture-PC", "2026-10-09T00:00:00Z"] };
const claim = { ...envelope, id: find("returning id, requested_by"), parameters: [device.tenantId] };
const result = (rows: unknown[], columns: unknown, count: number | null) => Object.defineProperties(rows, { columns: { value: columns }, count: { value: count } });

beforeEach(() => {
  vi.clearAllMocks(); h.leased = true;
  h.begin.mockImplementation(async (fn: (sql: unknown) => unknown) => {
    const tx = Object.assign(async () => h.leased ? [{ id: device.id }] : [], { unsafe: h.unsafe });
    return fn(tx);
  });
});
describe("worker gateway command responses", () => {
  it("completes the real worker heartbeat template when an UPSERT returns no columns", async () => {
    h.unsafe.mockResolvedValue(result([], null, 1));
    expect(await runAgentQuery(device, heartbeat)).toEqual({ rows: [], columns: [], count: 1 });
    expect(h.unsafe.mock.calls[0][0]).toContain("on conflict (tenant_id, hostname)");
  });
  it("keeps RETURNING rows and date column metadata for remote DB hydration", async () => {
    const rows = [{ id: "request-fixture", requested_at: "2026-10-09T00:00:00Z" }];
    h.unsafe.mockResolvedValue(result(rows, [{ name: "requested_at", type: 1184, table: 123 }], 1));
    expect(await runAgentQuery(device, claim)).toEqual({ rows, columns: [{ name: "requested_at", type: 1184 }], count: 1 });
  });
  it.each(["42P01", "42703", "23505", "23503", "42501", "57014"])("preserves SQLSTATE %s for compatibility without leaking SQL or values", async code => {
    h.unsafe.mockRejectedValue(Object.assign(new Error("private SQL/parameter fixture"), { code }));
    await expect(runAgentQuery(device, heartbeat)).rejects.toMatchObject({ status: 409, code, message: code });
  });
  it("rejects a retired lease before the worker query runs", async () => {
    h.leased = false;
    await expect(runAgentQuery(device, heartbeat)).rejects.toMatchObject({ code: "lease_lost" });
    expect(h.unsafe).not.toHaveBeenCalled();
  });
  it("rejects a write disguised as a read-only operation", async () => {
    await expect(runAgentQuery(device, { ...heartbeat, readOnly: true })).rejects.toMatchObject({ code: "read_only" });
    expect(h.begin).not.toHaveBeenCalled();
  });
});
