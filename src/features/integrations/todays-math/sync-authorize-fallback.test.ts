// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, currentUser, connectedApps, viewAs } = vi.hoisted(() => ({ rpc: vi.fn(), currentUser: vi.fn(), connectedApps: vi.fn(), viewAs: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: currentUser }));
// 연결 앱 권한 판정(2026-11-05) — 기본은 '오늘 수학 링크가 서는 사람'. 꺼진 경우는 아래 따로 본다.
vi.mock("@/features/connected-apps/server/visible", () => ({ getMyConnectedApps: connectedApps }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: viewAs }));
import { GET } from "@/app/api/connected-apps/todays-math/authorize/route";
import { activeControl, config, eligibleEntry, id, user } from "./sync-browser.test-support";

const state = "s".repeat(43);
const challenge = "v".repeat(43);
function request(extra = "", origin = config.sourceBaseUrl) {
  return new Request(`${origin}/api/connected-apps/todays-math/authorize?bindingId=${config.bindingId}&state=${state}&code_challenge=${challenge}${extra}`);
}
function noStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("EYWA_SYNC_BINDINGS_JSON", JSON.stringify([config]));
  vi.stubEnv("EYWA_SYNC_AUTO_JSON", undefined);
  currentUser.mockResolvedValue(user); viewAs.mockResolvedValue(null);
  rpc.mockResolvedValue({ data: activeControl, error: null });
  connectedApps.mockResolvedValue([{ feature: "todays_math" }]);
});
afterEach(() => vi.unstubAllEnvs());

describe("source authorization login fallback", () => {
  it.each([
    { name: "protected identity omitted by control", role: "master", users: [] },
    { name: "missing staff control row", role: "teacher", users: [] },
    { name: "subjectless staff", role: "teacher", users: [{ ...eligibleEntry, subjects: [], eligible: false, blockReasons: ["subject_ineligible"] }] },
    { name: "another user's eligible row", role: "teacher", users: [{ ...eligibleEntry, id: id(8) }] },
  ])("redirects $name only to the configured login without issuing a code", async ({ role, users }) => {
    currentUser.mockResolvedValue({ ...user, systemRole: role });
    rpc.mockResolvedValue({ data: { ...activeControl, users }, error: null });
    const response = await GET(request("&redirect_uri=https://evil.example&targetBaseUrl=https://evil.example&next=//evil.example&token=untrusted"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${config.targetBaseUrl}/login?eywa=not-linked`);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("tm_sync_control", { p_binding_id: config.bindingId, p_user_id: user.id });
    noStore(response);
  });

  it.each([
    { name: "OFF", enabled: false }, { name: "unhealthy", healthy: false }, { name: "shadow", mode: "shadow" },
  ])("keeps $name denied for both missing and eligible rows", async (condition) => {
    for (const users of [[], [eligibleEntry]]) {
      rpc.mockResolvedValue({ data: { ...activeControl, ...condition, users }, error: null });
      const response = await GET(request());
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "account_not_eligible" });
      expect(response.headers.get("location")).toBeNull(); noStore(response);
    }
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["tm_sync_control", "tm_sync_control"]);
  });

  it.each([
    { name: "another tenant", tenantId: id(9) }, { name: "student", systemRole: "student" },
  ])("keeps a $name session denied before control lookup", async (condition) => {
    currentUser.mockResolvedValue({ ...user, ...condition });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "account_not_eligible" });
    expect(response.headers.get("location")).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });

  // 연결 앱 권한(학원 설정 → 역할·권한 '연결 앱 권한', 2026-11-05): 오늘 수학 자격이 있어도 권한이 꺼진 사람은 코드를 받지 못하고
  // 자격이 없을 때와 같은 로그인 안내로 간다(원문 403 화면 아님). 판정은 자격 확인 뒤라 꺼짐·검증 실패의 403/503은 그대로다.
  it("redirects an eligible account whose connected-app permission is off to the configured login without issuing a code", async () => {
    connectedApps.mockResolvedValue([]);
    rpc.mockResolvedValue({ data: { ...activeControl, users: [eligibleEntry] }, error: null });
    const response = await GET(request());
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${config.targetBaseUrl}/login?eywa=not-linked`);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("tm_sync_control", { p_binding_id: config.bindingId, p_user_id: user.id });
    expect(connectedApps).toHaveBeenCalledTimes(1);
    noStore(response);
  });

  it("checks the connected-app permission only after the source control has passed", async () => {
    connectedApps.mockResolvedValue([]);
    rpc.mockResolvedValue({ data: { ...activeControl, enabled: false, users: [eligibleEntry] }, error: null });
    const off = await GET(request());
    expect(off.status).toBe(403);
    expect(await off.json()).toEqual({ error: "account_not_eligible" });
    rpc.mockResolvedValue({ data: { ...activeControl, users: [] }, error: null });
    const ineligible = await GET(request());
    expect(ineligible.headers.get("location")).toBe(`${config.targetBaseUrl}/login?eywa=not-linked`);
    expect(connectedApps).not.toHaveBeenCalled();
  });

  // 강사뷰(원장 A → 직원 X) 중 대상 쪽 v2 시작 주소를 직접 열어도 출발 라우트와 같이 /home — A 명의 코드를 내지 않는다.
  it("sends a teacher-view session home without a control lookup or code", async () => {
    viewAs.mockResolvedValue({ ...user, id: id(8), access: "full" });
    rpc.mockResolvedValue({ data: { ...activeControl, users: [eligibleEntry] }, error: null });
    const response = await GET(request());
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${config.sourceBaseUrl}/home`);
    expect(rpc).not.toHaveBeenCalled(); noStore(response);
  });

  it("keeps failed atomic code issuance denied", async () => {
    rpc.mockResolvedValueOnce({ data: { ...activeControl, users: [eligibleEntry] }, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "account_not_eligible" });
    expect(response.headers.get("location")).toBeNull(); noStore(response);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][0]).toBe("tm_sync_issue_code");
  });

  it.each([
    { name: "binding", field: "bindingId", value: "bad" },
    { name: "state", field: "state", value: "bad" },
    { name: "challenge", field: "code_challenge", value: "bad" },
  ])("keeps malformed $name input denied before session lookup", async ({ field, value }) => {
    const url = new URL(request().url); url.searchParams.set(field, value);
    const response = await GET(new Request(url));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_payload" });
    expect(currentUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps source origin mismatch denied before session lookup", async () => {
    const response = await GET(request("", "https://evil.example"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "source_origin_mismatch" });
    expect(currentUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { name: "missing configuration", value: "[]", error: "sync_not_configured" },
    { name: "invalid configuration", value: "bad", error: "sync_configuration_invalid" },
  ])("keeps $name unavailable", async ({ value, error }) => {
    vi.stubEnv("EYWA_SYNC_BINDINGS_JSON", value);
    const response = await GET(request());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error });
    expect(currentUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { name: "tenant", data: { ...activeControl, tenantId: id(9) } },
    { name: "binding", data: { ...activeControl, bindingId: id(9) } },
    { name: "target branch", data: { ...activeControl, targetBranchId: id(9) } },
    { name: "malformed control", data: null },
  ])("does not fallback after $name control validation fails", async ({ data }) => {
    rpc.mockResolvedValue({ data, error: null });
    const response = await GET(request());
    expect(response.status).toBe(503); expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "sync_unavailable" });
  });

  it("does not fallback or disclose errors after a control storage failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "private database error" } });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "sync_store_unavailable" });
    expect(response.headers.get("location")).toBeNull();
  });
});
