"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/user-menu";
import { EyIcon } from "@/components/icons/eywa-icons";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { NAV_GROUPS, findNavItem, type NavItem } from "@/lib/navigation";
import { canAccess, type AccessMatrix, type SystemRole } from "@/lib/permissions";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";

function isItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 좁은 폭·터치(= 데스크톱이 아닌 모든 화면)에서 좌측 사이드바 대신 쓰는 **단일 상단 바**.
 * 한 줄: 로고 · 브랜드 · 현재 메뉴명 … 알림 · 햄버거 · 계정 / 펼치면 그 아래 메뉴 그리드.
 *
 * 🔴 왜 한 줄인가(원장 2026-07-30 "모바일뷰에서 시간표가 상단 헤더 때문에 거의 보이지 않음"):
 * 예전엔 이 바(46px) **위아래로 AppHeader(48px)가 따로** 있었고, 둘이 같은 것을 두 번 보여줬다 —
 * 브랜드("인재원")·그룹("수업 운영")·메뉴명("시간표")이 각각 2회. 실측 390×844에서 상단 크롬이
 * **318px = 화면의 43%**를 먹어 정작 시간표 격자는 367px만 남았다. AppHeader를 이 바에 흡수해
 * 제목 1회 + 벨을 여기로 모았다(창=타이틀바가 제목인 것과 같은 규칙, `compact-chrome` 변형).
 *
 * ⚠️ 벨은 **`useIsDesktop()`으로 조건 마운트**한다 — 이 바는 데스크톱에서 CSS(`lg:pointer-fine:hidden`)로
 *    숨을 뿐 **마운트는 된다**. 사이드바 벨과 이중 마운트되면 폴링·OS 알림 팝업이 중복 발화한다.
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
  const isDesktop = useIsDesktop();
  const items: NavItem[] = NAV_GROUPS.flatMap((g) => g.items).filter(
    (item) => !item.hidden && canAccess(systemRole, item.menuKey, permMatrix),
  );
  // 현재 메뉴명 — 옛 AppHeader의 h1을 여기로. 모르는 경로(상세 페이지 등)는 브랜드만 두고 생략한다
  // (지어내지 않는다 — 본문 PageHeader가 맥락을 이미 준다).
  const currentLabel = findNavItem(pathname)?.label ?? null;

  // 표준 모바일 햄버거 패턴 — 기본 접힘(배너 한 줄만), 탭하면 그리드 펼침, 메뉴 선택하면 자동 닫힘.
  // 14개 메뉴 그리드가 매 화면 상단 4줄을 차지하던 것 해소(2026-07-02 사용자 제보). transient state라
  // SSR=닫힘·클라=닫힘으로 hydration 일치(영속 불필요 — 목적지는 breadcrumb·본문이 이미 보여줌).
  const [open, setOpen] = useState(false);

  return (
    <nav
      className={`bg-sidebar border-line sticky top-0 z-20 border-b print:hidden ${className ?? ""}`}
      aria-label="메뉴"
    >
      {/* 단일 바 — 브랜드 · 현재 메뉴명 … 알림 · 햄버거 · 계정 (옛 AppHeader 흡수) */}
      <div className="border-line/60 flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- 학원 로고(GCS/외부 이미지), next/image 최적화 불필요
              <img src={logoSrc} alt={brand} className="size-5 shrink-0 rounded-[3px] object-contain" />
            ) : (
              <span className="bg-ink flex size-5 items-center justify-center rounded-[3px]">
                <EyIcon name="building" size={12} strokeWidth={1.8} className="text-white" />
              </span>
            )}
            <span className="text-foreground text-[13px] font-bold tracking-tight">{brand}</span>
          </Link>
          {currentLabel ? (
            <>
              <span className="bg-line h-3 w-px shrink-0" aria-hidden />
              {/* 이 줄이 이 화면의 제목이다 — 본문 PageHeader는 compact-chrome으로 접힌다(중복 금지). */}
              <h1 className="text-foreground min-w-0 truncate text-[14px] font-bold tracking-tight">
                {currentLabel}
              </h1>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* 데스크톱에선 사이드바 하단이 벨을 갖는다 — 여기(숨겨진 바)까지 마운트하면 폴링·팝업 중복. */}
          {!isDesktop ? <NotificationBell /> : null}
          {/* 햄버거 토글 — 기본 접힘, 탭하면 메뉴 그리드 펼침(선택 시 자동 닫힘). */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={open}
            className="text-text-dim hover:text-foreground hover:bg-bg-soft flex size-7 items-center justify-center rounded-md transition"
          >
            <EyIcon name={open ? "close" : "menu"} size={16} strokeWidth={1.8} />
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
                className={`flex h-8 w-full items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] font-bold transition ${
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
