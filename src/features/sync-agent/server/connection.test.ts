import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ postgres: vi.fn(), statements: { begin: vi.fn(), end: vi.fn(), unsafe: vi.fn() }, transactions: { begin: vi.fn(), end: vi.fn(), unsafe: vi.fn() } }));
vi.mock("postgres", () => ({ default: h.postgres }));
import { createAgentConnection } from "./connection";
beforeEach(() => {
  vi.clearAllMocks();
  h.statements = { begin: vi.fn(), end: vi.fn(), unsafe: vi.fn() };
  h.transactions = { begin: vi.fn(), end: vi.fn(), unsafe: vi.fn() };
  h.postgres.mockReset();
  h.statements.begin.mockRejectedValue(new Error("native zero-pipeline BEGIN is broken"));
  h.statements.end.mockResolvedValue(undefined);
  h.transactions.end.mockResolvedValue(undefined);
  h.postgres.mockReturnValueOnce(h.statements).mockReturnValueOnce(h.transactions);
});
describe("agent connection pools", () => {
  it("routes BEGIN through the reserved transaction pool and retains standalone statement routing", async () => {
    const tx = { json: vi.fn() };
    h.transactions.begin.mockImplementation(async (fn: (value: unknown) => unknown) => fn(tx));
    const sql = createAgentConnection("postgres://fixture:fixture@host.test/db");
    const callback = vi.fn(async (value: unknown) => { expect(value).toBe(tx); return "committed"; });
    expect(await sql.begin(callback)).toBe("committed");
    expect(h.transactions.begin).toHaveBeenCalledWith(callback);
    expect(sql.unsafe).toBe(h.statements.unsafe);
    expect(h.transactions.unsafe).not.toHaveBeenCalled();
    expect(h.postgres.mock.calls.map(c => c[1].max_pipeline)).toEqual([0, 1]);
  });
  it("propagates a rollback failure instead of returning a successful result", async () => {
    h.transactions.begin.mockRejectedValue(new Error("transaction rejected"));
    const sql = createAgentConnection("postgres://fixture:fixture@host.test/db");
    await expect(sql.begin(async () => "result")).rejects.toThrow("transaction rejected");
  });
  it("closes both pools even when one close rejects", async () => {
    h.statements.end.mockRejectedValue(new Error("close failed"));
    const endStatements = h.statements.end;
    const sql = createAgentConnection("postgres://fixture:fixture@host.test/db");
    await expect(sql.end({ timeout: 1 })).rejects.toThrow("close failed");
    expect(endStatements).toHaveBeenCalledWith({ timeout: 1 });
    expect(h.transactions.end).toHaveBeenCalledWith({ timeout: 1 });
  });
});
