"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserMenu } from "@/components/user-menu";
import { NAV_GROUPS } from "@/lib/navigation";
import { canAccess, type SystemRole } from "@/lib/permissions";

function isItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 컴팩트 아이콘 레일 (52px) — 기존 232px 사이드바를 대체.
 * 아이콘만 노출, hover 시 Tooltip 라벨(우측). 그룹은 얇은 구분선으로 분리.
 * 텍스트로 메뉴를 찾고 싶으면 검색 팰릿(command-palette, 헤더 검색 클릭)을 사용.
 * UserMenu(로그아웃 포함)는 레일 하단에 고정.
 */
export function AppSidebar({
  systemRole,
  email,
  className,
}: {
  systemRole: SystemRole;
  email: string;
  className?: string;
}) {
  const pathname = usePathname();

  // 접근 가능한 항목만 남기고 빈 그룹 제거 (그룹 구분선 위치 계산용)
  const groups = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((item) => canAccess(systemRole, item.menuKey)),
  })).filter((g) => g.items.length > 0);

  return (
    <TooltipProvider delay={200}>
      <aside
        className={`bg-sidebar border-line sticky top-0 flex h-screen w-[52px] shrink-0 flex-col border-r ${className ?? ""}`}
      >
        {/* brand */}
        <div className="border-line flex h-12 shrink-0 items-center justify-center border-b">
          <Link
            href="/dashboard"
            aria-label="EYWA 대시보드"
            className="flex items-center justify-center"
          >
            <span className="bg-ink flex size-7 items-center justify-center rounded-[3px]">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5" fill="none" stroke="#fff" strokeWidth="1.2" />
                <circle cx="8" cy="8" r="2" fill="#fff" />
              </svg>
            </span>
          </Link>
        </div>

        {/* nav — 아이콘 레일 */}
        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2.5">
          {groups.map((group, gi) => (
            <div key={group.label} className="flex w-full flex-col items-center gap-1">
              {gi > 0 ? <div className="bg-line my-1.5 h-px w-6" aria-hidden="true" /> : null}
              {group.items.map((item) => {
                const active = isItemActive(item.href, pathname);
                const Icon = item.icon;
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger
                      render={
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          aria-label={item.label}
                          className={`flex size-9 items-center justify-center rounded-[6px] transition ${
                            active
                              ? "bg-primary text-primary-foreground shadow-primary-glow"
                              : "text-text-dim hover:bg-sidebar-accent hover:text-foreground"
                          }`}
                        />
                      }
                    >
                      <Icon size={18} strokeWidth={1.85} />
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </nav>

        {/* user — 계정/로그아웃 */}
        <div className="border-line flex h-14 shrink-0 items-center justify-center border-t">
          <UserMenu email={email} />
        </div>
      </aside>
    </TooltipProvider>
  );
}
