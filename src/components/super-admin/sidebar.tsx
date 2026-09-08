"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";

type NavItem = { href: string; label: string; icon: EywaIconName };

const NAV: NavItem[] = [
  { href: "/super-admin", label: "대시보드", icon: "layoutGrid" },
  { href: "/super-admin/tenants", label: "학원 목록", icon: "building" },
  { href: "/super-admin/audit", label: "감사 로그", icon: "history" },
];

export function SuperAdminSidebar({
  email,
  displayName,
}: {
  email: string;
  displayName: string;
}) {
  const activeHref = usePathname() ?? "/super-admin";
  return (
    <aside className="bg-ink flex w-[232px] shrink-0 flex-col text-white">
      {/* Brand */}
      <div className="border-b border-white/10 px-5 py-5">
        <Link href="/super-admin" className="inline-flex items-center gap-2">
          <span className="bg-gold flex size-7 items-center justify-center rounded-[5px]">
            <EyIcon name="building" size={14} strokeWidth={1.8} className="text-ink" />
          </span>
          <span className="text-base font-bold tracking-tight">EYWA</span>
        </Link>
        <p className="text-gold/90 mt-1 font-mono text-xs tracking-[1.2px] uppercase">
          Super Admin
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4">
        <p className="text-white/40 px-2 py-1 font-mono text-xs tracking-[1.2px] uppercase">
          01 · SaaS 운영
        </p>
        <ul className="mt-1 space-y-0.5">
          {NAV.map((item) => {
            const isActive =
              activeHref === item.href ||
              (item.href !== "/super-admin" && activeHref.startsWith(`${item.href}/`));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-bold transition ${
                    isActive
                      ? "bg-gold text-ink shadow-[0_0_24px_-6px_rgba(184,137,58,0.6)]"
                      : "text-white/75 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <EyIcon name={item.icon} size={14} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer — user */}
      <div className="border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="bg-gold text-ink flex size-7 shrink-0 items-center justify-center rounded-[5px] text-xs font-bold">
            {displayName.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold">{displayName}</p>
            <p className="truncate font-mono text-xs text-white/55">{email}</p>
          </div>
        </div>
        <Link
          href="/dashboard"
          className="text-white/60 hover:text-gold mt-3 inline-flex items-center gap-1 font-mono text-xs tracking-wider uppercase"
        >
          <EyIcon name="arrowLeft" size={12} />
          Academy로 돌아가기
        </Link>
      </div>
    </aside>
  );
}
