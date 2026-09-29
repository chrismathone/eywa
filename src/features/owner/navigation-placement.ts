import type { HubGroup } from "@/lib/menu-hub";
import { FIXED_GROUP_IDS, isFixedDestination, type MenuGroupLayoutRow, type MenuLayoutRow } from "./menu-layout";

export type PlacementEdge = "before" | "after";

/** 드래그·화살표·소속 선택 모두 이 경로로 이동한다. 원본 목적지는 복제하지 않는다. */
export function placeNavigationMenu(
  rows: MenuLayoutRow[], groups: readonly HubGroup[], href: string, groupId: string,
  placement?: { href: string; edge: PlacementEdge }, reveal = false,
): MenuLayoutRow[] {
  const source = groups.find((g) => g.items.some((d) => d.href === href));
  const target = groups.find((g) => g.id === groupId);
  if (!source || !target || target.hidden || FIXED_GROUP_IDS.has(groupId) || isFixedDestination(href)) return rows;
  if (placement?.href === href) return rows;
  const items = target.items.filter((d) => d.href !== href).map((d) => d.href);
  const anchor = placement ? items.indexOf(placement.href) : -1;
  if (placement && anchor < 0) return rows;
  items.splice(anchor < 0 ? items.length : anchor + (placement?.edge === "after" ? 1 : 0), 0, href);
  const byHref = new Map(rows.map((r) => [r.href, r]));
  const members = new Set(items);
  return [
    ...rows.filter((r) => !members.has(r.href)),
    ...items.map((itemHref, order) => ({
      ...byHref.get(itemHref), href: itemHref, groupId, order,
      ...(itemHref === href && (reveal || source.id !== groupId) ? { hidden: false } : {}),
    })),
  ];
}

export function placeNavigationGroup(
  rows: MenuGroupLayoutRow[], groups: readonly HubGroup[], groupId: string, anchorId: string, edge: PlacementEdge,
): MenuGroupLayoutRow[] {
  const editable = groups.filter((g) => !g.hidden && !FIXED_GROUP_IDS.has(g.id));
  const moving = editable.find((g) => g.id === groupId);
  if (!moving || groupId === anchorId) return rows;
  const next = editable.filter((g) => g.id !== groupId);
  const anchor = next.findIndex((g) => g.id === anchorId);
  if (anchor < 0) return rows;
  next.splice(anchor + (edge === "after" ? 1 : 0), 0, moving);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = new Set(next.map((g) => g.id));
  return [...rows.filter((r) => !ids.has(r.id)), ...next.map((g, order) => ({ ...byId.get(g.id), id: g.id, order }))];
}
