"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { subscribeRecordSaved } from "@/lib/realtime/record-channel";
import { configuredHubGroups, HUB_GROUPS, SUPPORT_GROUPS, hubDestinationForPath, type HubGroup } from "@/lib/menu-hub";
import { applyMenuPresentation, type MenuLayout, type MenuGroupLayout } from "./menu-layout";
import type { Win } from "@/components/workspace/window-store";

const ADMIN_SOURCE = [...HUB_GROUPS, ...SUPPORT_GROUPS];
type NavigationContextValue = { menus: MenuLayout; groups: MenuGroupLayout; source: readonly HubGroup[]; tenantId?: string };
const EMPTY: NavigationContextValue = { menus: [], groups: [], source: ADMIN_SOURCE };
const NavigationContext = createContext<NavigationContextValue>(EMPTY);

export function NavigationProvider({ menus, groups = EMPTY.groups, source = ADMIN_SOURCE, tenantId, children }: Omit<NavigationContextValue, "groups" | "source"> & { groups?: MenuGroupLayout; source?: readonly HubGroup[]; children: ReactNode }) {
  const router = useRouter();
  const value = useMemo(() => ({ menus, groups, source, tenantId }), [menus, groups, source, tenantId]);
  // iframe 액션의 캐시 무효화는 부모 문서를 다시 렌더하지 않는다. 저장 확정 신호만 받고 서버값을 다시 읽는다.
  useEffect(() => tenantId ? subscribeRecordSaved((message) => {
    if (message.scope === `navigation:${tenantId}`) router.refresh();
  }) : undefined, [tenantId, router]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigationSettings() { return useContext(NavigationContext); }

export function useMenuPresentation() {
  const { menus, source } = useNavigationSettings();
  const destinations = useMemo(() => source.flatMap((g) => g.items), [source]);
  return (href: string) => {
    const original = hubDestinationForPath(href, destinations);
    return original ? applyMenuPresentation(original, menus) : undefined;
  };
}

/** 모든 창 표시 지점에서 현재 URL을 기준으로 같은 이름·아이콘을 쓴다. 상세 레코드 제목은 보존한다. */
export function useWindowPresentation() {
  const { menus, groups, source } = useNavigationSettings();
  const destinations = useMemo(() => configuredHubGroups(source, menus, groups, true).flatMap((g) => g.items), [menus, groups, source]);
  return (win: Win, href?: string, liveTitle?: string) => {
    if (win.kind !== "route") return { title: liveTitle ?? win.params.title, icon: undefined };
    const path = href ?? win.params.href ?? "";
    const dest = hubDestinationForPath(path, destinations);
    if (!dest) return { title: liveTitle ?? win.params.title, icon: undefined };
    const exact = path.split(/[?#]/)[0] === dest.href.split(/[?#]/)[0];
    const renamed = menus.some((r) => r.href === dest.href && r.label);
    return { title: exact && renamed ? dest.label : liveTitle ?? win.params.title, icon: dest.icon };
  };
}
