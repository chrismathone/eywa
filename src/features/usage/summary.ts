/**
 * 이용 분석 **집계 모양 잡기** — DB 함수(0292a `page_usage_summary`)가 준 묶음 행을 화면 모델로(순수 함수, Vitest).
 *
 * 🔑 합계·사용자 수는 **SQL이 이미 묶어서** 준다 — 여기서 행을 다시 더하지 않는다(사용자 수는 묶음끼리 더할 수 없다:
 *    한 사람이 두 메뉴를 쓰면 메뉴별 합이 2명이 된다). 여기는 고르고·정렬하고·비중을 매기는 일만 한다.
 */

export type UsageAgg = { visits: number; openSec: number; activeSec: number; users: number };
export type UsageSort = "active" | "visits" | "open";

export type RawUsageRow = {
  set: string;
  tenantId: string | null;
  role: string | null;
  menuKey: string | null;
  routeKey: string | null;
} & UsageAgg;

export type MenuUsage = UsageAgg & { menuKey: string; share: number };
export type RouteUsage = UsageAgg & { menuKey: string; routeKey: string; share: number };
export type GroupUsage = UsageAgg & { key: string; share: number; topMenus: MenuUsage[] };

export type UsageSummary = {
  total: UsageAgg;
  menus: MenuUsage[];
  routes: RouteUsage[];
  roles: GroupUsage[];
  tenants: GroupUsage[];
  /** 기간 안에 한 번도 안 열린 메뉴(유지보수 우선순위를 낮출 후보). */
  unusedMenus: string[];
};

const ZERO: UsageAgg = { visits: 0, openSec: 0, activeSec: 0, users: 0 };

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** RPC 결과(jsonb 배열) → 행. 모양이 다른 원소는 버린다. */
export function parseUsageRows(raw: unknown): RawUsageRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const set = str(o.set);
    if (!set) return [];
    return [
      {
        set,
        tenantId: str(o.tenant_id),
        role: str(o.role),
        menuKey: str(o.menu_key),
        routeKey: str(o.route_key),
        visits: num(o.visits),
        openSec: num(o.open_seconds),
        activeSec: num(o.active_seconds),
        users: num(o.users),
      },
    ];
  });
}

const METRIC: Record<UsageSort, (a: UsageAgg) => number> = {
  active: (a) => a.activeSec,
  visits: (a) => a.visits,
  open: (a) => a.openSec,
};

/** 고른 기준 → 활동 → 화면 → 방문 순. 끝까지 같으면 키로 갈라 순서가 흔들리지 않게. */
function byMetric<T extends UsageAgg>(sort: UsageSort, key: (x: T) => string) {
  return (a: T, b: T) =>
    METRIC[sort](b) - METRIC[sort](a) ||
    b.activeSec - a.activeSec ||
    b.openSec - a.openSec ||
    b.visits - a.visits ||
    key(a).localeCompare(key(b));
}

const agg = (r: RawUsageRow): UsageAgg => ({ visits: r.visits, openSec: r.openSec, activeSec: r.activeSec, users: r.users });
const shareOf = (sort: UsageSort, part: UsageAgg, whole: UsageAgg) =>
  METRIC[sort](whole) > 0 ? METRIC[sort](part) / METRIC[sort](whole) : 0;

export function shapeUsage(
  rows: readonly RawUsageRow[],
  allMenus: readonly string[],
  sort: UsageSort = "active",
  topN = 5,
): UsageSummary {
  const pick = (set: string) => rows.filter((r) => r.set === set);
  const total = pick("total")[0] ? agg(pick("total")[0]!) : ZERO;

  const menus: MenuUsage[] = pick("menu")
    .filter((r) => r.menuKey)
    .map((r) => ({ ...agg(r), menuKey: r.menuKey!, share: shareOf(sort, r, total) }))
    .sort(byMetric(sort, (m) => m.menuKey));

  const routes: RouteUsage[] = pick("route")
    .filter((r) => r.menuKey && r.routeKey)
    .map((r) => ({ ...agg(r), menuKey: r.menuKey!, routeKey: r.routeKey!, share: shareOf(sort, r, total) }))
    .sort(byMetric(sort, (x) => x.routeKey));

  const groups = (set: string, subSet: string, keyOf: (r: RawUsageRow) => string | null): GroupUsage[] =>
    pick(set)
      .filter((r) => keyOf(r))
      .map((r) => {
        const key = keyOf(r)!;
        const top = pick(subSet)
          .filter((m) => keyOf(m) === key && m.menuKey)
          .map((m) => ({ ...agg(m), menuKey: m.menuKey!, share: shareOf(sort, m, r) }))
          .sort(byMetric(sort, (m) => m.menuKey))
          .slice(0, topN);
        return { ...agg(r), key, share: shareOf(sort, r, total), topMenus: top };
      })
      .sort(byMetric(sort, (g) => g.key));

  const used = new Set(menus.filter((m) => m.visits > 0 || m.openSec > 0).map((m) => m.menuKey));
  return {
    total,
    menus,
    routes,
    roles: groups("role", "role_menu", (r) => r.role),
    tenants: groups("tenant", "tenant_menu", (r) => r.tenantId),
    unusedMenus: allMenus.filter((k) => !used.has(k)),
  };
}
