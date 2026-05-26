"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NAV_GROUPS, type NavItem } from "@/lib/navigation";
import { canAccess, type SystemRole } from "@/lib/permissions";

function isItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const ROLE_LABEL: Record<SystemRole, string> = {
  master: "원장",
  admin: "관리자",
  manager: "매니저",
  teacher: "강사",
  counselor: "상담",
  accountant: "회계",
  viewer: "참관",
};

export function AppSidebar({
  systemRole,
  displayName,
  email,
}: {
  systemRole: SystemRole;
  displayName: string;
  email: string;
}) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-sm font-bold">
            e
          </span>
          <span className="group-data-[collapsible=icon]:hidden">eywa</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group, idx) => {
          const visible: NavItem[] = group.items.filter((item) =>
            canAccess(systemRole, item.menuKey),
          );
          if (visible.length === 0) return null;
          return (
            <SidebarGroup key={group.label ?? `solo-${idx}`}>
              {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {visible.map((item) => {
                    const Icon = item.icon;
                    const active = isItemActive(item.href, pathname);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          render={<Link href={item.href} />}
                          isActive={active}
                          tooltip={item.label}
                        >
                          <Icon className="size-4" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="border-t px-3 py-3 group-data-[collapsible=icon]:px-2">
        <div className="flex items-center gap-2.5">
          <span className="bg-sidebar-accent text-sidebar-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <p className="text-sidebar-foreground truncate text-sm font-medium">{displayName}</p>
            <p className="text-sidebar-foreground/60 truncate text-[11px]">
              <span>{ROLE_LABEL[systemRole]}</span>
              <span className="mx-1 opacity-50">·</span>
              <span className="num">{email}</span>
            </p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
