"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { NAV_GROUPS, type NavItem } from "@/lib/navigation";
import { canAccess, type SystemRole } from "@/lib/permissions";

const ROLE_LABEL: Record<SystemRole, string> = {
  master: "원장",
  admin: "관리자",
  manager: "매니저",
  teacher: "강사",
  counselor: "상담",
  accountant: "회계",
  viewer: "참관",
};

function isItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

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
  const userInitial = displayName.charAt(0).toUpperCase();

  return (
    <aside className="bg-sidebar border-line sticky top-0 flex h-screen w-[232px] shrink-0 flex-col border-r">
      {/* brand */}
      <div className="px-[22px] pt-[22px] pb-[18px]">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <span className="bg-ink flex size-7 items-center justify-center rounded-[3px]">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="5" fill="none" stroke="#fff" strokeWidth="1.2" />
              <circle cx="8" cy="8" r="2" fill="#fff" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="text-foreground text-[17px] font-extrabold leading-none tracking-tight">
              EYWA
            </div>
            <div className="text-text-dim mt-[3px] font-mono text-[10px] tracking-wider">
              인재원 · 강남
            </div>
          </div>
        </Link>
      </div>

      {/* nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 pb-2">
        {NAV_GROUPS.map((group, gi) => {
          const visible: NavItem[] = group.items.filter((item) =>
            canAccess(systemRole, item.menuKey),
          );
          if (visible.length === 0) return null;
          return (
            <div key={group.label} className="mb-3">
              <div className="text-text-faint flex items-center justify-between px-3 pt-1.5 pb-1 font-mono text-[10px] tracking-wider uppercase">
                <span>{group.label}</span>
                <span>{String(gi + 1).padStart(2, "0")}</span>
              </div>
              <ul className="space-y-px">
                {visible.map((item) => {
                  const active = isItemActive(item.href, pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-2.5 rounded-[4px] px-3 py-2 text-[13px] transition ${
                          active
                            ? "bg-primary text-primary-foreground font-semibold shadow-primary-glow"
                            : "text-foreground hover:bg-sidebar-accent font-medium"
                        }`}
                      >
                        <span
                          className={`flex size-[26px] shrink-0 items-center justify-center rounded-md ${
                            active ? "bg-white/15 text-white" : "text-text-dim"
                          }`}
                        >
                          <EyIcon name={item.icon} size={14} />
                        </span>
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* user footer */}
      <div className="border-line bg-sidebar flex items-center gap-2.5 border-t px-4 py-3.5">
        <span
          className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-[4px] text-[13px] font-bold tracking-tight"
          aria-label={displayName}
        >
          {userInitial}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-foreground truncate text-[13px] font-bold">{displayName}</p>
          <p className="text-text-dim truncate text-[11px]">
            <span>{ROLE_LABEL[systemRole]}</span>
            <span className="mx-1 opacity-60">·</span>
            <span className="num">{email}</span>
          </p>
        </div>
      </div>
    </aside>
  );
}
