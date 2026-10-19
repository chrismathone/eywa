// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { access } = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("@/features/management-analytics/server/access", () => ({ analyticsAccess: access }));
import { POST } from "./route";
import { sampleForm } from "@/features/management-analytics/test-fixtures";

const request = (origin = "https://aywa.test", tenant = "tenant-a") => new Request("https://aywa.test/api/management-analytics", {
  method: "POST", body: sampleForm(tenant), headers: { Origin: origin, "X-Aywa-Analytics": "1" },
});
describe("analytics HTTP boundary", () => {
  beforeEach(() => { access.mockReset(); access.mockResolvedValue({ ok: true, user: { tenantId: "tenant-a" } }); });
  it.each([401, 403])("blocks access with %i before reading the body", async (status) => {
    access.mockResolvedValue({ ok: false, status });
    const req = request();
    const result = await POST(req);
    expect(result.status).toBe(status); expect(req.bodyUsed).toBe(false);
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects cross-origin and missing-origin posts", async () => {
    for (const origin of ["https://evil.test", "null", ""]) {
      const req = request(origin); expect((await POST(req)).status).toBe(403); expect(req.bodyUsed).toBe(false);
    }
    const req = request(); req.headers.delete("x-aywa-analytics"); expect((await POST(req)).status).toBe(403);
  });
  it("rejects a forged tenant while allowing the authenticated tenant", async () => {
    expect((await POST(request("https://aywa.test", "tenant-b"))).status).toBe(403);
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, report: { kpis: { active: 4, netReceipts: 1050000 } } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("redacts unexpected exception details", async () => {
    access.mockRejectedValue(new Error("PRIVATE_SOURCE_SECRET"));
    const response = await POST(request()); expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("PRIVATE_SOURCE_SECRET");
  });
});
