import { isUsageRole, type UsageRole } from "./labels";
import type { UsageSort } from "./summary";

/**
 * 이용 분석 화면의 **주소 = 조회 조건** — 기간·지점·권한·정렬(순수 함수, Vitest).
 * 모르는 값은 기본값으로 떨어진다(잘못된 주소가 DB 오류로 번지지 않게 — 지점 id는 uuid 모양만 통과).
 */

export const USAGE_PERIODS = [7, 30, 90] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];
export const USAGE_SORTS = ["active", "visits", "open"] as const satisfies readonly UsageSort[];

export type UsageQuery = {
  days: UsagePeriod;
  tenantId: string | null;
  role: UsageRole | null;
  sort: UsageSort;
};

export const USAGE_PATH = "/super-admin/usage";
const DEFAULT: UsageQuery = { days: 30, tenantId: null, role: null, sort: "active" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseUsageQuery(sp: Raw): UsageQuery {
  const days = Number(first(sp.days));
  const tenant = first(sp.tenant);
  const role = first(sp.role);
  const sort = first(sp.sort);
  return {
    days: (USAGE_PERIODS as readonly number[]).includes(days) ? (days as UsagePeriod) : DEFAULT.days,
    tenantId: tenant && UUID.test(tenant) ? tenant.toLowerCase() : null,
    role: role && isUsageRole(role) ? role : null,
    sort: sort && (USAGE_SORTS as readonly string[]).includes(sort) ? (sort as UsageSort) : DEFAULT.sort,
  };
}

/** 지금 조건에서 일부만 바꾼 주소 — 기본값은 주소에 적지 않는다. */
export function usageHref(q: UsageQuery, patch: Partial<UsageQuery> = {}): string {
  const next = { ...q, ...patch };
  const sp = new URLSearchParams();
  if (next.days !== DEFAULT.days) sp.set("days", String(next.days));
  if (next.tenantId) sp.set("tenant", next.tenantId);
  if (next.role) sp.set("role", next.role);
  if (next.sort !== DEFAULT.sort) sp.set("sort", next.sort);
  const s = sp.toString();
  return s ? `${USAGE_PATH}?${s}` : USAGE_PATH;
}
