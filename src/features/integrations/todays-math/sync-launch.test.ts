// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, currentUser, visibleApps, signSsoToken, viewAs } = vi.hoisted(() => ({
  rpc: vi.fn(), currentUser: vi.fn(), visibleApps: vi.fn(), signSsoToken: vi.fn(), viewAs: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: currentUser }));
// 강사뷰 중 거절(/home)은 visible.test.ts가 잠근다 — 여기는 강사뷰가 아닌 실제 로그인 경로만 본다.
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: viewAs }));
vi.mock("@/features/connected-apps/server/visible", () => ({ getMyConnectedApps: visibleApps }));
vi.mock("@/features/connected-apps/sso", async (original) => ({
  ...await original<typeof import("@/features/connected-apps/sso")>(), signSsoToken,
}));
import { GET } from "@/app/api/connected-apps/todays-math/launch/route";
import { CONNECTED_APPS } from "@/features/connected-apps/apps";
import { activeControl, config, eligibleEntry, id, user } from "./sync-browser.test-support";

const app = CONNECTED_APPS.find((value) => value.feature === "todays_math")!;
function request() {
  return new Request(`${config.sourceBaseUrl}/api/connected-apps/todays-math/launch?bindingId=${id(9)}&targetBaseUrl=https://evil.example&next=//evil.example&token=untrusted`);
}
function location(response: Response) {
  expect(response.status).toBe(307);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  return response.headers.get("location");
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("EYWA_SYNC_BINDINGS_JSON", JSON.stringify([config]));
  vi.stubEnv("EYWA_SYNC_AUTO_JSON", undefined); vi.stubEnv("EYWA_SSO_SECRET", "legacy".repeat(8));
  currentUser.mockResolvedValue(user); visibleApps.mockResolvedValue([app]); viewAs.mockResolvedValue(null);
  rpc.mockResolvedValue({ data: activeControl, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("source connected app launch", () => {
  it.each([
    { name: "protected identity omitted by control", role: "master", users: [] },
    { name: "missing staff row", role: "teacher", users: [] },
    { name: "subjectless staff", role: "teacher", users: [{ ...eligibleEntry, subjects: [], eligible: false, blockReasons: ["subject_ineligible"] }] },
    { name: "another user's eligible row", role: "teacher", users: [{ ...eligibleEntry, id: id(8) }] },
  ])("sends $name to the fixed configured login without SSO", async ({ role, users }) => {
    currentUser.mockResolvedValue({ ...user, systemRole: role });
    rpc.mockResolvedValue({ data: { ...activeControl, users }, error: null });
    expect(location(await GET(request()))).toBe(`${config.targetBaseUrl}/login?eywa=not-linked`);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("tm_sync_control", { p_binding_id: config.bindingId, p_user_id: user.id });
    expect(signSsoToken).not.toHaveBeenCalled();
  });

  it("sends eligible staff to the existing state/PKCE start", async () => {
    rpc.mockResolvedValue({ data: { ...activeControl, users: [eligibleEntry] }, error: null });
    expect(location(await GET(request()))).toBe(`${config.targetBaseUrl}/api/sso/eywa/v2/start?bindingId=${config.bindingId}`);
    expect(rpc).toHaveBeenCalledTimes(1); expect(signSsoToken).not.toHaveBeenCalled();
  });

  it.each([{ name: "OFF", enabled: false }, { name: "unhealthy", healthy: false }])(
    "keeps $name outside the login fallback", async (condition) => {
      rpc.mockResolvedValue({ data: { ...activeControl, ...condition }, error: null });
      expect(location(await GET(request()))).toBe(`${config.targetBaseUrl}/api/sso/eywa/v2/start?bindingId=${config.bindingId}`);
      expect(signSsoToken).not.toHaveBeenCalled();
    },
  );

  it("preserves shadow launch to the configured first page", async () => {
    rpc.mockResolvedValue({ data: { ...activeControl, mode: "shadow" }, error: null });
    expect(location(await GET(request()))).toBe(`${config.targetBaseUrl}/`);
    expect(signSsoToken).not.toHaveBeenCalled();
  });

  it("preserves the source login for anonymous callers", async () => {
    currentUser.mockResolvedValue(null);
    expect(location(await GET(request()))).toBe(`${config.sourceBaseUrl}/login`);
    expect(visibleApps).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });

  it("preserves the menu visibility gate before control lookup", async () => {
    visibleApps.mockResolvedValue([]);
    expect(location(await GET(request()))).toBe(`${config.sourceBaseUrl}/home`);
    expect(rpc).not.toHaveBeenCalled(); expect(signSsoToken).not.toHaveBeenCalled();
  });

  it("preserves student launch without a control lookup or SSO token", async () => {
    currentUser.mockResolvedValue({ ...user, systemRole: "student" });
    expect(location(await GET(request()))).toBe(new URL(app.href).href);
    expect(rpc).not.toHaveBeenCalled(); expect(signSsoToken).not.toHaveBeenCalled();
  });

  it.each([
    { name: "another tenant", data: { ...activeControl, tenantId: id(9) } },
    { name: "another binding", data: { ...activeControl, bindingId: id(9) } },
    { name: "another branch", data: { ...activeControl, targetBranchId: id(9) } },
    { name: "malformed control", data: null },
  ])("keeps $name control errors unavailable", async ({ data }) => {
    rpc.mockResolvedValue({ data, error: null });
    const response = await GET(request());
    expect(response.status).toBe(503); expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "sync_unavailable" });
    expect(signSsoToken).not.toHaveBeenCalled();
  });

  it("keeps storage failures unavailable without leaking database text", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "private database error" } });
    const response = await GET(request());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "sync_store_unavailable" });
    expect(response.headers.get("location")).toBeNull(); expect(signSsoToken).not.toHaveBeenCalled();
  });
});
