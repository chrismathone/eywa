// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, currentUser, visibleApps } = vi.hoisted(() => ({ rpc: vi.fn(), currentUser: vi.fn(), visibleApps: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: currentUser }));
// 연결 앱 권한 판정(authorize만 쓴다 · 2026-11-05) — 기본은 '오늘 수학 링크가 서는 사람'.
vi.mock("@/features/connected-apps/server/visible", () => ({ getMyConnectedApps: visibleApps }));
// 인가 경로의 강사뷰 거절은 sync-authorize-fallback.test.ts가 잠근다 — 여기는 강사뷰가 아닌 경로만.
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: async () => null }));
import { POST as controlPost } from "@/app/api/integrations/todays-math/v2/control/route";
import { POST as snapshotPost } from "@/app/api/integrations/todays-math/v2/snapshots/route";
import { POST as tokenPost } from "@/app/api/integrations/todays-math/v2/token/route";
import { GET as authorizeGet } from "@/app/api/connected-apps/todays-math/authorize/route";
import { GET as cronGet, POST as wakePost } from "@/app/api/cron/todays-math-sync/route";
import { dispatchSyncEvents, sourceBindingForTenant } from "./sync-server";
import { signedHeaders, type BindingConfig, type Control, type SecretPurpose, type SyncEvent } from "./sync-contract";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config: BindingConfig = { bindingId: id(1), tenantId: id(2), targetBranchId: id(3), sourceBaseUrl: "https://source.example", targetBaseUrl: "https://target.example", keyId: "key", controlSecret: "c".repeat(32), webhookSecret: "w".repeat(32), ssoSecret: "s".repeat(32) };
const now = Date.parse("2026-10-03T06:00:00Z");
const control: Control = { schemaVersion: 2, bindingId: id(1), tenantId: id(2), targetBranchId: id(3), sourceEpoch: id(4), securityRevision: "2", tenantRevocationGeneration: "2", enabled: false, mode: "active", validatedAt: new Date(now).toISOString(), nextEffectiveAt: null, healthy: true, users: [] };
function request(endpoint: string, value: unknown, purpose: SecretPurpose = "control") {
  const path = `/api/integrations/todays-math/v2/${endpoint}`;
  const body = JSON.stringify(value);
  return new Request(config.sourceBaseUrl + path, { method: "POST", body, headers: signedHeaders(config, purpose, "POST", path, body, now) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv("EYWA_SYNC_BINDINGS_JSON", JSON.stringify([config]));
  visibleApps.mockResolvedValue([{ feature: "todays_math" }]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("authenticated configuration diagnostics", () => {
  const wakeSecret = "wake".repeat(10);
  function diagnosticRequest(secret?: string) {
    return new Request("https://source.example/api/cron/todays-math-sync?diagnostics=1", {
      method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
  }
  beforeEach(() => {
    vi.stubEnv("TODAYS_MATH_SYNC_WAKE_SECRET", wakeSecret);
    vi.stubEnv("CRON_SECRET", "cron".repeat(10));
    vi.stubEnv("EYWA_SYNC_AUTO_JSON", undefined);
  });
  it("requires the method-specific credential before returning diagnostics", async () => {
    for (const secret of [undefined, "wrong", "cron".repeat(10)]) {
      const response = await wakePost(diagnosticRequest(secret));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    expect((await cronGet(diagnosticRequest(wakeSecret))).status).toBe(401);
    vi.stubEnv("TODAYS_MATH_SYNC_WAKE_SECRET", undefined);
    expect((await wakePost(diagnosticRequest(wakeSecret))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports configured and absent settings without dispatching or returning values", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await wakePost(diagnosticRequest(wakeSecret));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      EYWA_SYNC_BINDINGS_JSON: { configured: true, valid: true, count: 1 },
      EYWA_SYNC_AUTO_JSON: { configured: false, valid: true, count: 0 },
    });
    expect(rpc).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("identifies malformed legacy JSON independently of valid automatic settings", async () => {
    vi.stubEnv("EYWA_SYNC_BINDINGS_JSON", 'broken-secret-value');
    vi.stubEnv("EYWA_SYNC_AUTO_JSON", JSON.stringify([config]));
    const response = await wakePost(diagnosticRequest(wakeSecret));
    expect(await response.json()).toMatchObject({
      EYWA_SYNC_BINDINGS_JSON: { configured: true, valid: false, error: "invalid_json" },
      EYWA_SYNC_AUTO_JSON: { configured: true, valid: true, count: 1 },
    });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("identifies quote escaping and truncation without echoing malformed contents", async () => {
    vi.stubEnv("EYWA_SYNC_AUTO_JSON", '[{\\"controlSecret\\":\\"private-fragment');
    const response = await wakePost(diagnosticRequest(wakeSecret));
    const body = await response.text();
    expect(JSON.parse(body).EYWA_SYNC_AUTO_JSON.syntax).toMatchObject({
      startsWithArray: true, endsWithArray: false, hasByteOrderMark: false,
      hasSmartQuotes: false, hasEscapedQuotes: true,
    });
    expect(body).not.toContain("private-fragment");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns only validated deployment identifiers", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
    vi.stubEnv("VERCEL_URL", "eywa-test-team.vercel.app");
    expect((await (await wakePost(diagnosticRequest(wakeSecret))).json()).deployment).toEqual({ revision: "a".repeat(40), hostname: "eywa-test-team.vercel.app" });
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "unexpected-private-value");
    vi.stubEnv("VERCEL_URL", "unexpected-private-value");
    expect((await (await wakePost(diagnosticRequest(wakeSecret))).json()).deployment).toEqual({ revision: null, hostname: null });
  });
  it("returns only schema issue paths and codes without input or validation messages", async () => {
    vi.stubEnv("EYWA_SYNC_AUTO_JSON", JSON.stringify([{ ...config, controlSecret: "sensitive-too-short" }]));
    const response = await wakePost(diagnosticRequest(wakeSecret));
    const body = await response.text();
    expect(JSON.parse(body).EYWA_SYNC_AUTO_JSON).toEqual({
      configured: true, valid: false, error: "invalid_schema", issues: [{ path: [0, "controlSecret"], code: "too_small" }],
    });
    for (const secret of ["sensitive-too-short", config.webhookSecret, config.ssoSecret, config.sourceBaseUrl]) expect(body).not.toContain(secret);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("classifies conflicting automatic entries without exposing keys", async () => {
    vi.stubEnv("EYWA_SYNC_AUTO_JSON", JSON.stringify([config, config]));
    const response = await wakePost(diagnosticRequest(wakeSecret));
    expect((await response.json()).EYWA_SYNC_AUTO_JSON).toEqual({ configured: true, valid: false, error: "duplicate_automatic_key" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
describe("automatic source dispatch", () => {
  it("bootstraps ON tenants, sweeps retained OFF bindings, and reserves explicit tenant mappings", async () => {
    vi.stubEnv("EYWA_SYNC_AUTO_JSON", JSON.stringify([config]));
    rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "tm_sync_configure_automatic" ? [id(8)] : name === "tm_sync_claim_events" ? [] : true }));
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ busy: false, results: [] }));
    vi.stubGlobal("fetch", fetcher);
    const result = await dispatchSyncEvents();
    expect(rpc).toHaveBeenNthCalledWith(1, "tm_sync_configure_automatic", { p_enabled: true, p_excluded_tenants: [config.tenantId] });
    expect(result.receiverSweeps).toBe(2);
    expect(fetcher.mock.calls.map((call) => JSON.parse(call[1].body).bindingId).sort()).toEqual([config.bindingId, id(8)].sort());
  });
  it("does not send when automatic discovery fails or contains invalid identity data", async () => {
    vi.stubEnv("EYWA_SYNC_BINDINGS_JSON", "[]");
    vi.stubEnv("EYWA_SYNC_AUTO_JSON", JSON.stringify([config]));
    rpc.mockResolvedValue({ error: null, data: ["invalid"] });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(dispatchSyncEvents()).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
describe("source control API security", () => {
  it("resolves a new tenant from installation trust and verifies its exact signed identity", async () => {
    vi.stubEnv("EYWA_SYNC_BINDINGS_JSON", "[]");
    vi.stubEnv("EYWA_SYNC_AUTO_JSON", JSON.stringify([config]));
    const automatic = sourceBindingForTenant(id(8))!;
    expect(automatic).toMatchObject({ bindingId: id(8), tenantId: id(8), targetBranchId: id(8) });
    const path = "/api/integrations/todays-math/v2/control";
    const body = JSON.stringify({ bindingId: id(8) });
    rpc.mockResolvedValue({ data: { ...control, bindingId: id(8), tenantId: id(8), targetBranchId: id(8), tenantName: "침산" }, error: null });
    const signed = new Request(config.sourceBaseUrl + path, { method: "POST", body, headers: signedHeaders(automatic, "control", "POST", path, body, now) });
    expect((await controlPost(signed)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("tm_sync_control", { p_binding_id: id(8), p_user_id: null });
    rpc.mockClear();
    const invalid = new Request(config.sourceBaseUrl + path, { method: "POST", body, headers: signedHeaders(automatic, "control", "POST", path, body, now) });
    invalid.headers.set("x-eywa-binding", id(9));
    expect((await controlPost(invalid)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports explicit OFF as authoritative 200 and leaves reads without nonce writes", async () => {
    rpc.mockResolvedValue({ data: control, error: null });
    const response = await controlPost(request("control", { bindingId: id(1) }));
    expect(response.status).toBe(200); expect((await response.json()).enabled).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("tm_sync_control", { p_binding_id: id(1), p_user_id: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects cross-binding bodies before any data lookup", async () => {
    const response = await controlPost(request("control", { bindingId: id(9) }));
    expect(response.status).toBe(403); expect(rpc).not.toHaveBeenCalled();
  });
  it("does not accept a production binding on a different preview origin", async () => {
    const signed = request("control", { bindingId: id(1) });
    const preview = new Request("https://preview.example/api/integrations/todays-math/v2/control", {
      method: "POST", headers: signed.headers, body: await signed.text(),
    });
    expect((await controlPost(preview)).status).toBe(401); expect(rpc).not.toHaveBeenCalled();
  });
  it("does not translate storage failure into OFF or leak SQL messages", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "secret SQL internals" } });
    const response = await controlPost(request("control", { bindingId: id(1) }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret SQL internals");
  });
  it("does not trust a stored binding that points at a different target branch", async () => {
    rpc.mockResolvedValue({ data: { ...control, targetBranchId: id(9) }, error: null });
    expect((await controlPost(request("control", { bindingId: id(1) }))).status).toBe(503);
  });
  it("requires a persisted unique nonce before generating an export", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await snapshotPost(request("snapshots", { bindingId: id(1) }))).status).toBe(409);
    expect(rpc).toHaveBeenCalledTimes(1); expect(rpc.mock.calls[0][0]).toBe("tm_sync_consume_nonce");
  });
  it("exchanges PKCE authorization and nonce through one atomic RPC", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const response = await tokenPost(request("token", { bindingId: id(1), code: "c".repeat(43), state: "s".repeat(43), codeVerifier: "v".repeat(43) }, "sso"));
    expect(response.status).toBe(401);
    expect(rpc).toHaveBeenCalledTimes(1); expect(rpc.mock.calls[0][0]).toBe("tm_sync_exchange_code");
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("code");
    expect(rpc.mock.calls[0][1].p_challenge).toHaveLength(43);
  });
});
describe("source browser authorization", () => {
  const state = "s".repeat(43);
  const challenge = "v".repeat(43);
  function authorizeRequest(origin = config.sourceBaseUrl) {
    return new Request(`${origin}/api/connected-apps/todays-math/authorize?bindingId=${config.bindingId}&state=${state}&code_challenge=${challenge}`);
  }
  function eligible() {
    currentUser.mockResolvedValue({ id: id(7), tenantId: id(2), systemRole: "teacher" });
    rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "tm_sync_control"
      ? { ...control, enabled: true, users: [{ id: id(7), email: "teacher@example.com", name: "Teacher", status: "active", role: "teacher", subjects: ["math"], eligible: true, blockReasons: [], accountRevocationGeneration: "0", classListRevision: "0", classes: [] }] } : true }));
  }
  it("issues only a hashed one-use code to the fixed target callback", async () => {
    eligible();
    const response = await authorizeGet(authorizeRequest());
    expect(response.status).toBe(307);
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.origin).toBe(config.targetBaseUrl); expect(redirect.pathname).toBe("/api/sso/eywa/v2/callback");
    expect(redirect.searchParams.get("state")).toBe(state);
    const code = redirect.searchParams.get("code")!; expect(code).toHaveLength(43);
    expect(rpc).toHaveBeenLastCalledWith("tm_sync_issue_code", expect.objectContaining({ p_user_id: id(7), p_challenge: challenge, p_code_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(code);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("preserves the state and challenge across source login", async () => {
    currentUser.mockResolvedValue(null);
    const response = await authorizeGet(authorizeRequest());
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login"); expect(location.searchParams.get("next")).toContain(`code_challenge=${challenge}`);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects another source origin before checking the user session", async () => {
    eligible(); expect((await authorizeGet(authorizeRequest("https://preview.example"))).status).toBe(401);
    expect(currentUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses authorization from a different tenant or a student session", async () => {
    for (const user of [{ id: id(7), tenantId: id(9), systemRole: "teacher" }, { id: id(7), tenantId: id(2), systemRole: "student" }]) {
      currentUser.mockResolvedValue(user);
      expect((await authorizeGet(authorizeRequest())).status).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses code issuance while OFF", async () => {
    eligible(); rpc.mockResolvedValue({ data: control, error: null });
    expect((await authorizeGet(authorizeRequest())).status).toBe(403);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("issues no code when the connected-app permission is off — back to the target login like an ineligible account", async () => {
    eligible(); visibleApps.mockResolvedValue([]);
    const response = await authorizeGet(authorizeRequest());
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${config.targetBaseUrl}/login?eywa=not-linked`);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["tm_sync_control"]);
  });
});
describe("durable dispatch receipts", () => {
  const event: SyncEvent = { schemaVersion: 2, eventId: id(5), bindingId: id(1), tenantId: id(2), sourceEpoch: id(4), securityRevision: "2", tenantRevocationGeneration: "2", occurredAt: new Date(now).toISOString(), kind: "security", entityType: "license", entityId: id(2) };
  function setup() {
    rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "tm_sync_claim_events" ? [{ event, leaseToken: id(6), attempts: 1 }] : true }));
  }
  it("keeps received separate from applied and wakes pending receiver work", async () => {
    setup();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ eventId: id(5), status: "received" }))
      .mockResolvedValueOnce(Response.json({ processed: 0 })).mockResolvedValueOnce(Response.json({ eventId: id(5), status: "received" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await dispatchSyncEvents();
    expect(result.received).toBe(1); expect(result.applied).toBe(0);
    expect(rpc).toHaveBeenLastCalledWith("tm_sync_finish_event", expect.objectContaining({ p_event_id: id(5), p_lease_token: id(6), p_status: "received" }));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("retries mismatched event acknowledgements instead of losing revocations", async () => {
    setup(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ eventId: id(9), status: "applied" })));
    const result = await dispatchSyncEvents(); expect(result.retry).toBe(1);
    expect(rpc).toHaveBeenLastCalledWith("tm_sync_finish_event", expect.objectContaining({ p_status: "retry" }));
  });
  it("does not report durable success after losing its source lease", async () => {
    setup();
    const implementation = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name: string, ...args: unknown[]) => name === "tm_sync_finish_event"
      ? { error: null, data: false } : implementation(name, ...args));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ eventId: id(5), status: "applied" })));
    const result = await dispatchSyncEvents();
    expect(result.applied).toBe(0); expect(result.leaseLost).toBe(1);
  });
  it("resumes receiver-local retries even when the source outbox is empty", async () => {
    rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "tm_sync_claim_events" ? [] : true }));
    const fetcher = vi.fn().mockResolvedValue(Response.json({ busy: false, results: [] }));
    vi.stubGlobal("fetch", fetcher);
    const result = await dispatchSyncEvents();
    expect(result.claimed).toBe(0); expect(result.receiverSweeps).toBe(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(config.targetBaseUrl + "/api/integrations/eywa/v2/process");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ bindingId: config.bindingId, limit: 3 });
  });
  it("records an unavailable receiver sweep without inventing a successful delivery", async () => {
    rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "tm_sync_claim_events" ? [] : true }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await dispatchSyncEvents();
    expect(result.applied).toBe(0); expect(result.receiverSweeps).toBe(0); expect(result.receiverUnavailable).toBe(1);
  });
});
