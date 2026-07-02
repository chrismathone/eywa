"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/user-menu";
import { NAV_GROUPS, type NavItem } from "@/lib/navigation";
import { canAccess, type AccessMatrix, type SystemRole } from "@/lib/permissions";

function isItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 좁은 폭(<lg, 1024px)에서 좌측 사이드바 대신 상단에 펼쳐지는 메뉴 바.
 * 상단: EYWA 브랜드 banner / 하단: 메뉴 grid (auto-fit으로 균등 분할, 그룹 구분선 없음).
 */
export function MobileTopNav({
  systemRole,
  email,
  className,
  brand = "EYWA",
  logoSrc,
  permMatrix,
}: {
  systemRole: SystemRole;
  email: string;
  className?: string;
  brand?: string;
  logoSrc?: string | null;
  permMatrix?: AccessMatrix;
}) {
  const pathname = usePathname();
  const items: NavItem[] = NAV_GROUPS.flatMap((g) => g.items).filter(
    (item) => !item.hidden && canAccess(systemRole, item.menuKey, permMatrix),
  );

  return (
    <nav
      className={`bg-sidebar border-line sticky top-0 z-20 border-b print:hidden ${className ?? ""}`}
      aria-label="메뉴"
    >
      {/* 브랜드 banner + 계정 메뉴 */}
      <div className="border-line/60 flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <Link href="/dashboard" className="flex items-center gap-2">
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- 학원 로고(GCS/외부 이미지), next/image 최적화 불필요
            <img src={logoSrc} alt={brand} className="size-5 shrink-0 rounded-[3px] object-contain" />
          ) : (
            <span className="bg-ink flex size-5 items-center justify-center rounded-[3px]">
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5" fill="none" stroke="#fff" strokeWidth="1.2" />
                <circle cx="8" cy="8" r="2" fill="#fff" />
              </svg>
            </span>
          )}
          <span className="text-foreground text-[13px] font-extrabold tracking-tight">{brand}</span>
        </Link>
        <UserMenu email={email} />
      </div>

      {/* 메뉴 grid (모든 cell 균등 너비) */}
      <ul
        className="grid gap-1 px-2 py-1.5"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))" }}
      >
        {items.map((item) => {
          const active = isItemActive(item.href, pathname);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-8 w-full items-center justify-center gap-1.5 rounded-sm px-2 text-[12px] font-semibold transition ${
                  active
                    ? "bg-primary text-primary-foreground shadow-primary-glow"
                    : "text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                <Icon size={14} strokeWidth={1.85} />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
