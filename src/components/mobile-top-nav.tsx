"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/user-menu";
import { EyIcon } from "@/components/icons/eywa-icons";
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

  // 표준 모바일 햄버거 패턴 — 기본 접힘(배너 한 줄만), 탭하면 그리드 펼침, 메뉴 선택하면 자동 닫힘.
  // 14개 메뉴 그리드가 매 화면 상단 4줄을 차지하던 것 해소(2026-07-02 사용자 제보). transient state라
  // SSR=닫힘·클라=닫힘으로 hydration 일치(영속 불필요 — 목적지는 breadcrumb·본문이 이미 보여줌).
  const [open, setOpen] = useState(false);

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
        <div className="flex items-center gap-1">
          {/* 햄버거 토글 — 기본 접힘, 탭하면 메뉴 그리드 펼침(선택 시 자동 닫힘). */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={open}
            className="text-text-dim hover:text-foreground hover:bg-bg-soft flex size-7 items-center justify-center rounded-sm transition"
          >
            <EyIcon name={open ? "close" : "menu"} size={16} strokeWidth={2} />
          </button>
          <UserMenu email={email} />
        </div>
      </div>

      {/* 메뉴 grid (모든 cell 균등 너비) — 햄버거로 펼쳤을 때만. 선택하면 닫혀 본문 공간 확보. */}
      {open ? (
      <ul
        className="grid gap-1 px-2 py-1.5"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))" }}
      >
        {items.map((item) => {
          const active = isItemActive(item.href, pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex h-8 w-full items-center justify-center gap-1.5 rounded-sm px-2 text-[12px] font-semibold transition ${
                  active
                    ? "bg-primary text-primary-foreground shadow-primary-glow"
                    : "text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                <EyIcon name={item.icon} size={14} strokeWidth={1.8} />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      ) : null}
    </nav>
  );
}
