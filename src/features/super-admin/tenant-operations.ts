import type { TenantRow } from "./server/queries";

export type TenantFilters = {
  q: string;
  plan: "all" | "free" | "paid";
  activity: "all" | "students" | "empty" | "billed" | "unbilled";
  sort: "recent" | "students" | "billing" | "name";
};

export function parseTenantFilters(params: Record<string, string | string[] | undefined>): TenantFilters {
  const one = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const plan = one("plan");
  const activity = one("activity");
  const sort = one("sort");
  return {
    q: one("q").trim().slice(0, 100),
    plan: plan === "free" || plan === "paid" ? plan : "all",
    activity: activity === "students" || activity === "empty" || activity === "billed" || activity === "unbilled" ? activity : "all",
    sort: sort === "students" || sort === "billing" || sort === "name" ? sort : "recent",
  };
}

export function selectTenants(rows: TenantRow[], filters: TenantFilters): TenantRow[] {
  const q = filters.q.toLocaleLowerCase("ko-KR");
  const selected = rows.filter((row) => {
    if (q && !`${row.name} ${row.slug}`.toLocaleLowerCase("ko-KR").includes(q)) return false;
    if (filters.plan === "free" && row.plan !== "free") return false;
    if (filters.plan === "paid" && row.plan === "free") return false;
    if (filters.activity === "students" && row.studentCount === 0) return false;
    if (filters.activity === "empty" && row.studentCount > 0) return false;
    if (filters.activity === "billed" && row.monthInvoiceCount === 0) return false;
    if (filters.activity === "unbilled" && row.monthInvoiceCount > 0) return false;
    return true;
  });

  return selected.sort((a, b) => {
    const difference = filters.sort === "students" ? b.studentCount - a.studentCount
      : filters.sort === "billing" ? b.monthBilling - a.monthBilling
      : filters.sort === "name" ? a.name.localeCompare(b.name, "ko-KR")
      : b.createdAt.localeCompare(a.createdAt);
    return difference || a.id.localeCompare(b.id);
  });
}

export function tenantPage(rows: TenantRow[], requestedPage: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Number.isSafeInteger(requestedPage) ? Math.min(Math.max(1, requestedPage), totalPages) : 1;
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), page, totalPages, total: rows.length };
}
