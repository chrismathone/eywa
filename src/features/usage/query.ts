import { isUsageRole, type UsageRole } from "./labels";
import { isSubjectFilter } from "./segment";
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
  /** 강사 과목 필터(`segment.ts` — 과목 묶음 · '+' 겸업 · '-' 미지정). 고르면 권한은 강사로 고정. */
  subject: string | null;
  sort: UsageSort;
};

export const USAGE_PATH = "/super-admin/usage";
const DEFAULT: UsageQuery = { days: 30, tenantId: null, role: null, subject: null, sort: "active" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseUsageQuery(sp: Raw): UsageQuery {
  const days = Number(first(sp.days));
  const tenant = first(sp.tenant);
  const role = first(sp.role);
  const subjectRaw = first(sp.subject);
  const subject = subjectRaw && isSubjectFilter(subjectRaw) ? subjectRaw : null;
  const sort = first(sp.sort);
  return {
    days: (USAGE_PERIODS as readonly number[]).includes(days) ? (days as UsagePeriod) : DEFAULT.days,
    tenantId: tenant && UUID.test(tenant) ? tenant.toLowerCase() : null,
    // 과목을 골랐으면 강사만 본다(과목 분류는 강사에게만 있다).
    role: subject ? "teacher" : role && isUsageRole(role) ? role : null,
    subject,
    sort: sort && (USAGE_SORTS as readonly string[]).includes(sort) ? (sort as UsageSort) : DEFAULT.sort,
  };
}

/** 지금 조건에서 일부만 바꾼 주소 — 기본값은 주소에 적지 않는다. 강사가 아닌 권한으로 바꾸면 과목은 뗀다. */
export function usageHref(q: UsageQuery, patch: Partial<UsageQuery> = {}): string {
  const next = { ...q, ...patch };
  if (patch.role !== undefined && patch.role !== "teacher") next.subject = null;
  if (next.subject) next.role = "teacher";
  const sp = new URLSearchParams();
  if (next.days !== DEFAULT.days) sp.set("days", String(next.days));
  if (next.tenantId) sp.set("tenant", next.tenantId);
  if (next.role) sp.set("role", next.role);
  if (next.subject) sp.set("subject", next.subject);
  if (next.sort !== DEFAULT.sort) sp.set("sort", next.sort);
  const s = sp.toString();
  return s ? `${USAGE_PATH}?${s}` : USAGE_PATH;
}
