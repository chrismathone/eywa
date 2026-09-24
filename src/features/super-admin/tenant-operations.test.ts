import { describe, expect, it } from "vitest";
import { parseTenantFilters, selectTenants, tenantPage } from "./tenant-operations";
import type { TenantRow } from "./server/queries";

const rows: TenantRow[] = [
  { id: "a", slug: "gangnam", name: "강남학원", plan: "free", createdAt: "2026-01-01", userCount: 2, studentCount: 0, classCount: 0, monthBilling: 0, monthInvoiceCount: 0 },
  { id: "b", slug: "north", name: "북부학원", plan: "pro", createdAt: "2026-03-01", userCount: 5, studentCount: 10, classCount: 3, monthBilling: 0, monthInvoiceCount: 1 },
  { id: "c", slug: "south", name: "남부학원", plan: "pro", createdAt: "2026-02-01", userCount: 3, studentCount: 4, classCount: 1, monthBilling: 50000, monthInvoiceCount: 2 },
];

describe("super-admin tenant comparison", () => {
  it("searches name and slug and combines plan and activity filters", () => {
    const filters = parseTenantFilters({ q: " 북부 ", plan: "paid", activity: "billed" });
    expect(selectTenants(rows, filters).map((row) => row.id)).toEqual(["b"]);
    expect(selectTenants(rows, parseTenantFilters({ q: "gang", activity: "empty" })).map((row) => row.id)).toEqual(["a"]);
    expect(selectTenants(rows, parseTenantFilters({ activity: "unbilled" })).map((row) => row.id)).toEqual(["a"]);
  });

  it("sorts across all tenants before pagination and clamps stale pages", () => {
    const sorted = selectTenants(rows, parseTenantFilters({ sort: "students" }));
    expect(sorted.map((row) => row.id)).toEqual(["b", "c", "a"]);
    expect(tenantPage(sorted, 2, 2).rows.map((row) => row.id)).toEqual(["a"]);
    expect(tenantPage(sorted, 99, 2).page).toBe(2);
  });

  it("플랜 필터는 배지와 같은 판정 — 데모 지점은 '유료 계약'에 섞이지 않는다", () => {
    const withDemo: TenantRow[] = [
      ...rows,
      { id: "d", slug: "demo", name: "데모학원", plan: "demo", createdAt: "2026-01-02", userCount: 1, studentCount: 1, classCount: 0, monthBilling: 0, monthInvoiceCount: 0 },
    ];
    expect(selectTenants(withDemo, parseTenantFilters({ plan: "paid" })).map((row) => row.id).sort()).toEqual(["b", "c"]);
    expect(selectTenants(withDemo, parseTenantFilters({ plan: "free" })).map((row) => row.id).sort()).toEqual(["a", "d"]);
  });

  it("ignores unsupported filter values", () => {
    expect(parseTenantFilters({ plan: "secret", sort: "bad", activity: "bad" })).toMatchObject({
      plan: "all", sort: "recent", activity: "all",
    });
  });
});
