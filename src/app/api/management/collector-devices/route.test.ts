// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn(), enabled: vi.fn(), log: vi.fn(), deployed: true }));
vi.mock("@/features/management/collector-switch", () => ({ isCollectorDeployed: () => m.deployed }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/features/management/server/access", () => ({ managementAccess: m.access, ManagementAccessError: class extends Error {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
vi.mock("@/features/management/server/collector-auth", async (importOriginal) => ({ ...await importOriginal<typeof import("@/features/management/server/collector-auth")>(), collectorEnabled: m.enabled }));
import { collectorOrigin } from "@/features/management/collector-contract";
import { GET, POST } from "./route";
let writes: Record<string, unknown>[], calls: { table: string; op: string; args: unknown[] }[];
const req = (body: unknown, origin = collectorOrigin) => new Request(`${collectorOrigin}/api/management/collector-devices`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); writes = []; calls = []; m.deployed = true;
  m.access.mockResolvedValue({ id: "owner", tenantId: "verified-tenant" }); m.enabled.mockResolvedValue(true);
  m.from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "order", "limit", "insert", "update", "upsert", "is"]) q[op] = (...args: unknown[]) => { calls.push({ table, op, args }); if (["insert", "update", "upsert"].includes(op)) writes.push(args[0] as Record<string, unknown>); return q; };
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return q;
  });
});
it("명시 확인 없이 · 요청이 정한 지점으로는 발급하지 않는다", async () => {
  for (const body of [{ action: "create", name: "PC" }, { action: "create", name: "PC", scopeConfirmed: true, tenantId: "foreign" }]) expect((await POST(req(body))).status).toBe(400);
  expect(writes).toHaveLength(0);
});
it("🔴 꺼져 있으면(기본) 연결 파일을 발급하지 않는다", async () => {
  m.enabled.mockResolvedValue(false);
  expect((await POST(req({ action: "create", name: "PC", scopeConfirmed: true }))).status).toBe(409);
  expect(writes).toHaveLength(0);
});
it("🔴 배포 스위치가 꺼져 있으면 켜기·발급을 거절하고 끄기·해제만 받는다", async () => {
  m.deployed = false;
  expect((await POST(req({ action: "enable", enabled: true }))).status).toBe(409);
  expect((await POST(req({ action: "create", name: "PC", scopeConfirmed: true }))).status).toBe(409);
  expect(writes).toHaveLength(0);
  expect((await (await GET()).json())).toMatchObject({ available: false, enabled: false });
  expect((await POST(req({ action: "enable", enabled: false }))).status).toBe(200);
});
it("켜기·끄기·발급·해제를 감사로그에 남기고 토큰 원문은 남기지 않는다", async () => {
  const r = await POST(req({ action: "create", name: "PC", scopeConfirmed: true })), j = await r.json();
  await POST(req({ action: "enable", enabled: true }));
  expect(m.log.mock.calls.map((c) => c[0].metadata.summary)).toEqual(["수집 PC 연결 파일 발급", "PC 수집기 켜기"]);
  expect(JSON.stringify(m.log.mock.calls)).not.toContain(j.token.split(".")[1]);
  expect(m.log.mock.calls.every((c) => c[0].action === "management_collector_manage")).toBe(true);
});
it("다른 출처 · 권한 없는 요청은 막는다", async () => {
  expect((await POST(req({ action: "create", name: "PC", scopeConfirmed: true }, "https://foreign"))).status).toBe(403);
  m.access.mockRejectedValue(Error("denied"));
  expect((await GET()).status).toBe(403);
  expect((await POST(req({ action: "enable", enabled: true }))).status).toBe(403);
  expect(writes).toHaveLength(0);
});
it("비밀 원문은 한 번만 첨부 파일로 · 저장은 해시와 확인된 지점만", async () => {
  const r = await POST(req({ action: "create", name: "PC", scopeConfirmed: true }));
  expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("no-store"); expect(r.headers.get("content-disposition")).toContain("attachment");
  const j = await r.json();
  expect(j.tenantId).toBe("verified-tenant"); expect(j.baseUrl).toBe(collectorOrigin); expect(j).not.toHaveProperty("protectionBypass");
  expect(j.token).toMatch(/^[a-f0-9-]{36}\.[a-f0-9]{64}$/);
  expect(writes[0]).toMatchObject({ tenant_id: "verified-tenant", created_by: "owner" });
  expect(JSON.stringify(writes)).not.toContain(j.token.split(".")[1]);
  expect(Date.parse(j.expiresAt) - Date.now()).toBeGreaterThan(89 * 86400_000);
});
it("목록은 비밀 칸을 읽지 않고 · 해제·켜기는 그 지점 줄만", async () => {
  await GET();
  const select = calls.find((c) => c.op === "select");
  expect(select?.args[0]).not.toMatch(/secret|token|hash/);
  expect(calls).toContainEqual({ table: "management_collection_devices", op: "eq", args: ["tenant_id", "verified-tenant"] });
  calls = []; writes = [];
  await POST(req({ action: "revoke", id: "bc746112-23fd-4660-ad12-919230d95bae" }));
  expect(calls).toContainEqual({ table: "management_collection_devices", op: "eq", args: ["tenant_id", "verified-tenant"] });
  expect(writes[0]).toHaveProperty("revoked_at");
  writes = [];
  expect((await POST(req({ action: "enable", enabled: false }))).status).toBe(200);
  expect(writes[0]).toMatchObject({ tenant_id: "verified-tenant", collector_enabled: false, updated_by: "owner" });
});
