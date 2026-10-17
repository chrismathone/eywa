import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), optIn: vi.fn(), sync: vi.fn(), after: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: mocks.optIn }));
vi.mock("@/features/integrations/todays-math/results-sync", () => ({ syncTenant: mocks.sync }));
vi.mock("@/features/integrations/todays-math/sync-server", async () => {
  class SyncHttpError extends Error { constructor(public status: number, public code: string) { super(code); } }
  return {
    authenticateSyncRequest: mocks.auth,
    parseSyncBody: (schema: { parse: (v: unknown) => unknown }, body: string) => {
      try { return schema.parse(JSON.parse(body)); } catch { throw new SyncHttpError(400, "invalid_payload"); }
    },
    requireRequestBinding: (id: string, config: { bindingId: string }) => { if (id !== config.bindingId) throw new SyncHttpError(403, "binding_mismatch"); },
    syncResponse: (data: unknown, status = 200) => Response.json(data, { status }),
    syncErrorResponse: (e: unknown) => Response.json({ error: (e as { code?: string }).code ?? "sync_unavailable" }, { status: (e as { status?: number }).status ?? 503 }),
  };
});
import { POST } from "./route";

const bindingId = "00000000-0000-4000-8000-000000000002";
const config = { bindingId, tenantId: "00000000-0000-4000-8000-000000000001" };
const req = () => new Request("https://www.aywa.co.kr/api/integrations/todays-math/v2/results-wake", { method: "POST" });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.optIn.mockResolvedValue(true);
  mocks.auth.mockResolvedValue({ config, body: JSON.stringify({ bindingId }) });
});

it("answers 202 at once and syncs only that tenant afterwards", async () => {
  const res = await POST(req());
  expect(res.status).toBe(202);
  expect(mocks.sync).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0][0]();
  expect(mocks.sync).toHaveBeenCalledWith(config);
});

it("rejects unsigned requests and a binding that is not the signed one", async () => {
  mocks.auth.mockRejectedValueOnce(Object.assign(new Error("invalid_signature"), { status: 401, code: "invalid_signature" }));
  expect((await POST(req())).status).toBe(401);
  mocks.auth.mockResolvedValueOnce({ config, body: JSON.stringify({ bindingId: config.tenantId }) });
  expect((await POST(req())).status).toBe(403);
  mocks.auth.mockResolvedValueOnce({ config, body: JSON.stringify({ bindingId, extra: 1 }) });
  expect((await POST(req())).status).toBe(400);
  expect(mocks.after).not.toHaveBeenCalled();
});

it("does nothing for a tenant whose Today Math is off", async () => {
  mocks.optIn.mockResolvedValue(false);
  const res = await POST(req());
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ accepted: false });
  expect(mocks.after).not.toHaveBeenCalled();
});
