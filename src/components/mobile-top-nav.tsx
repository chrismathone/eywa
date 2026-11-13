"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { UserMenu } from "@/components/user-menu";
import { EyIcon, MENU_ICON } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { AssistantNavButton } from "@/features/assistant/components/assistant-nav-button";
import { findNavItem } from "@/lib/navigation";
import { HUB_GROUPS, SUPPORT_GROUPS, hubGroupsFor, hubDestinationForPath } from "@/lib/menu-hub";
import { useNavigationSettings, useMenuPresentation } from "@/features/owner/navigation-context";
import { type MenuLayout } from "@/features/owner/menu-layout";
import type { ConnectedApp } from "@/features/connected-apps/apps";
import { type AccessMatrix, type SystemRole } from "@/lib/permissions";
import { groupStatsEntry } from "@/lib/auth/stats-first-rule";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { useShellHome } from "@/components/workspace/shell-home";

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
 * ⚠️ 벨은 **`useIsDesktop()`으로 조건 마운트**한다 — 이 바는 데스크톱에서 CSS(`desk:hidden`)로
 *    숨을 뿐 **마운트는 된다**. 사이드바 벨과 이중 마운트되면 폴링·OS 알림 팝업이 중복 발화한다.
 */
export function MobileTopNav({
  systemRole,
  email,
  className,
  brand = "에이와",
  logoSrc,
  permMatrix,
  menuLayout,
  canTeacherView = false,
  isSuperAdmin = false,
  isGenericTenant = false,
  canViewVendors = false,
  connectedApps = [],
  canUseAssistant = false,
}: {
  systemRole: SystemRole;
  email: string;
  /** 학원 비서 버튼(서버 판정 — AppSidebar와 같은 값). */
  canUseAssistant?: boolean;
  className?: string;
  brand?: string;
  logoSrc?: string | null;
  permMatrix?: AccessMatrix;
  /**
   * 학원 설정 '왼쪽 탭'(보기 설정) — 🔴 **폰엔 사이드바가 없어 이 줄이 메뉴다.** 여기까지 안 보면
   *    원장이 감춘 메뉴가 PC에선 사라지고 폰에선 그대로 서서, 같은 설정이 기기마다 다른 말을 한다.
   * 데스크톱과 같은 그룹·면(`?tab=`) 목적지를 그려 이동·숨김·개명을 함께 반영한다.
   */
  menuLayout?: MenuLayout;
  canTeacherView?: boolean;
  isSuperAdmin?: boolean;
  isGenericTenant?: boolean;
  /** 업체리스트 지정자 — 학원운영 판의 '업체리스트' 입구(menu-hub `vendorsOnly`). */
  canViewVendors?: boolean;
  /** 켜진 연결 앱(오늘 수학 등) — 폰엔 사이드바가 없어 메뉴 격자 끝에 바깥 링크로 둔다(새 탭). */
  connectedApps?: readonly ConnectedApp[];
}) {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const home = useShellHome();
  const { groups: groupLayout } = useNavigationSettings();
  const presentation = useMenuPresentation();
  const search = useSearchParams();
  const currentHref = `${pathname}?${search.toString()}`;
  const groups = hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], {
    systemRole, permMatrix, menuLayout, groupLayout, canTeacherView,
    isMaster: systemRole === "master" || isSuperAdmin, isGenericTenant, canViewVendors,
  });
  const currentDest = hubDestinationForPath(currentHref, groups.flatMap((g) => g.items));
  const currentGroup = currentDest && groups.find(group => group.items.includes(currentDest));
  const currentStats = currentGroup && groupStatsEntry(currentGroup, systemRole);
  const currentLabel = currentStats?.href === pathname
    ? currentStats.label
    : presentation(currentHref)?.label ?? findNavItem(pathname)?.label ?? null;

  const [open, setOpen] = useState(false);

  return (
    <nav
      className={`bg-sidebar border-line sticky top-0 z-20 shrink-0 border-b print:hidden ${className ?? ""}`}
      aria-label="메뉴"
    >
      {/* 단일 바 — 브랜드 · 현재 메뉴명 … 알림 · 햄버거 · 계정 (옛 AppHeader 흡수) */}
      <div className="border-line/60 flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {/* 첫 화면 = 권한을 본 홈(`/dashboard` | `/menu`) — `/dashboard`를 직접 적지 말 것(gotchas #137). */}
          <Link href={home} className="flex shrink-0 items-center gap-2">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- 학원 로고(GCS/외부 이미지), next/image 최적화 불필요
              <img src={logoSrc} alt={brand} className="size-5 shrink-0 rounded-[3px] object-contain" />
            ) : (
              <span className="bg-ink flex size-5 items-center justify-center rounded-[3px]">
                <EyIcon name="building" size={12} strokeWidth={1.8} className="text-white" />
              </span>
            )}
            <span className="text-foreground text-sm font-bold tracking-tight">{brand}</span>
          </Link>
          {currentLabel ? (
            <>
              <span className="bg-line h-3 w-px shrink-0" aria-hidden />
              {/* 이 줄이 이 화면의 제목이다 — 본문 PageHeader는 compact-chrome으로 접힌다(중복 금지). */}
              <h1 className="text-foreground min-w-0 truncate text-sm font-bold tracking-tight">
                {currentLabel}
              </h1>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1 [&_button]:min-h-11 [&_button]:min-w-11">
          {/* 데스크톱에선 사이드바 하단이 벨을 갖는다 — 여기(숨겨진 바)까지 마운트하면 폴링·팝업 중복. */}
          {!isDesktop && canUseAssistant ? <AssistantNavButton /> : null}
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
      {/* 셀 하한 96→140px (2026-09-08 v5 글자 기준 실측): 라벨이 text-xs 12→14px로 오르며 96px 셀의 라벨 예산
          60px(= 96 − px-2 16 − 글리프 14 − gap 6)에 '선생님 원스크린'(≈102px)·'데이터베이스'(≈84px)가 잘렸다.
          140px이면 375·412px 폰 모두 2열(라벨 예산 141~160px ≥ 102px) — 대가는 격자가 5행→7행으로 길어지는 것뿐. */}
      {open ? (
      <div className="max-h-[70dvh] space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
        {groups.map((group) => {
          const statsEntry = groupStatsEntry(group, systemRole);
          return <section key={group.id} aria-label={group.label}>
            <h2 className="text-text-dim mb-1 flex items-center gap-2 text-xs font-bold"><MenuGlyph name={group.icon} size={16} />{group.label}</h2>
            <ul className="grid grid-cols-2 gap-1">
              {group.items.map((item) => {
                const stats = statsEntry?.href === `${item.href}/stats` ? statsEntry : undefined;
                return <li key={item.href}><Link href={stats?.href ?? item.href} onClick={() => setOpen(false)} aria-current={currentDest?.href === item.href ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium ${currentDest?.href === item.href ? "bg-primary text-primary-foreground" : "hover:bg-bg-soft"}`}>
                  <MenuGlyph name={item.icon} size={18} /><span className="min-w-0 break-words">{stats?.label ?? item.label}</span>
                </Link></li>;
              })}
            </ul>
          </section>;
        })}
        <ul className="grid grid-cols-2 gap-1">
        {connectedApps.map((a) => (
          <li key={a.feature}>
            <a
              href={a.launchPath}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="text-text-dim hover:text-foreground hover:bg-bg-soft flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold transition"
            >
              <EyIcon name={MENU_ICON[a.permission]} size={14} strokeWidth={1.8} />
              <span className="truncate">{a.label}</span>
              <EyIcon name="externalLink" size={12} strokeWidth={1.8} className="shrink-0 opacity-70" />
            </a>
          </li>
        ))}
        </ul>
      </div>
      ) : null}
    </nav>
  );
}
