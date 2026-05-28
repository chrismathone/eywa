"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { NAV_GROUPS, type NavItem } from "@/lib/navigation";
import { canAccess, type SystemRole } from "@/lib/permissions";

function isItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 좁은 폭(<lg, 1024px)에서 좌측 사이드바 대신 상단에 가로 스크롤되는 메뉴 바.
 * 그룹 간에는 vertical separator로 시각적 구분.
 */
export function MobileTopNav({
  systemRole,
  className,
}: {
  systemRole: SystemRole;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      className={`bg-sidebar border-line sticky top-0 z-20 flex items-center gap-2 overflow-x-auto border-b px-3 py-2 ${className ?? ""}`}
      aria-label="메뉴"
    >
      {/* 브랜드 (좁아도 보임) */}
      <Link href="/dashboard" className="flex shrink-0 items-center gap-2 pr-1">
        <span className="bg-ink flex size-6 items-center justify-center rounded-[3px]">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="5" fill="none" stroke="#fff" strokeWidth="1.2" />
            <circle cx="8" cy="8" r="2" fill="#fff" />
          </svg>
        </span>
        <span className="text-foreground text-[14px] font-extrabold tracking-tight">EYWA</span>
      </Link>
      <span className="bg-line h-5 w-px shrink-0" aria-hidden />

      {NAV_GROUPS.map((group, gi) => {
        const visible: NavItem[] = group.items.filter((item) =>
          canAccess(systemRole, item.menuKey),
        );
        if (visible.length === 0) return null;
        return (
          <div key={group.label} className="flex shrink-0 items-center gap-1">
            {visible.map((item) => {
              const active = isItemActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[12px] font-semibold transition ${
                    active
                      ? "bg-primary text-primary-foreground shadow-primary-glow"
                      : "text-text-dim hover:text-foreground hover:bg-bg-soft"
                  }`}
                >
                  <EyIcon name={item.icon} size={13} />
                  {item.label}
                </Link>
              );
            })}
            {gi < NAV_GROUPS.length - 1 ? (
              <span className="bg-line ml-1 h-4 w-px shrink-0" aria-hidden />
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
