"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserMenu } from "@/components/user-menu";
import { EyIcon } from "@/components/icons/eywa-icons";
import { NAV_GROUPS, SUBTABS_BY_MENU, type NavItem } from "@/lib/navigation";
import { canAccess, type AccessMatrix, type SystemRole } from "@/lib/permissions";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { usePrefs } from "@/components/workspace/use-prefs";
import { useSidebarResize } from "@/components/workspace/use-sidebar-resize";
import { useWindowStore, windowId } from "@/components/workspace/window-store";

// 펼침/접힘 모핑 이징 — 창 스냅과 동일 톤. 모션 OFF면 적용 안 함.
const EASE = "ease-[cubic-bezier(0.22,0.61,0.36,1)]";

const RAIL_DRAG = 16; // 레일 아이콘을 오른쪽(캔버스)으로 이만큼 끌면 그 자리에 창 꺼내기

function isItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 메뉴 창을 열고(이미 열렸으면 복원) 드롭 지점(스테이지 로컬, 타이틀바가 커서 아래)으로 배치. */
function openWindowAtPoint(item: NavItem, clientX: number, clientY: number) {
  const st = useWindowStore.getState();
  st.open("route", { id: item.menuKey, title: item.label, href: item.href });
  const winId = windowId("route", item.menuKey);
  const s2 = useWindowStore.getState();
  const win = s2.windows[winId];
  if (!win) return;
  const sx = clientX - s2.origin.left;
  const sy = clientY - s2.origin.top;
  s2.setRect(winId, { x: sx - win.rect.w / 2, y: sy - 18, w: win.rect.w, h: win.rect.h });
}

/**
 * 사이드바 — 오른쪽 경계선을 드래그해 너비를 조절(use-sidebar-resize).
 * 접힘(52px 아이콘 레일): 아이콘만, hover 시 Tooltip 라벨(우측), 그룹은 얇은 구분선.
 * 펼침(150~360px 아이콘+라벨): 그룹 헤더(번호+이름) 노출 — 아이콘만으로 판단 어려울 때.
 * 충분히 줄이면 접힘으로 스냅, 늘이면 펼침. 더블클릭=빠른 토글, ←/→ 키=조절.
 * 너비/펼침 여부는 usePrefs(localStorage "eywa-prefs")에 영속.
 * 텍스트로 메뉴를 찾고 싶으면 검색 팰릿(command-palette, 헤더 검색 클릭)을 사용.
 * UserMenu(로그아웃 포함)는 하단에 고정.
 *
 * 활성 표시(데스크톱): 메뉴 클릭이 라우트 이동이 아니라 플로팅 창을 열므로 usePathname은
 * 항상 /dashboard에 머문다. 그래서 active는 윈도우 스토어로 구동한다 —
 *  · 포커스된 창의 메뉴 = 풀 하이라이트
 *  · 열려 있지만 비포커스 = 점(dot)
 *  · 포커스된 창이 없음 = 바탕(배경) 라우트가 활성 (기본 대시보드, 배경 교체 시 그 라우트)
 * 모바일(라우트 이동)에서는 기존 pathname 기준을 유지.
 *
 * 데스크톱 제스처: 클릭=창 열기(cascade 위치) / 오른쪽으로 드래그=드롭 지점에 창 꺼내기.
 */
export function AppSidebar({
  systemRole,
  email,
  className,
  logoText = "EYWA",
  permMatrix,
}: {
  systemRole: SystemRole;
  email: string;
  className?: string;
  logoText?: string;
  permMatrix?: AccessMatrix;
}) {
  const pathname = usePathname();
  const currentTab = useSearchParams().get("tab"); // 활성 하부탭 표시용(배경 프레임 기준)
  const isDesktop = useIsDesktop();
  const { expanded, width, dragging, handleProps } = useSidebarResize();
  const animations = usePrefs((s) => s.animations);
  // 모션: 설정 ON & 드래그 중이 아닐 때만 슬라이드(드래그는 1:1 추종이라 트랜지션 off).
  const motion = animations && !dragging;
  const focusedId = useWindowStore((s) => s.focusedId);
  // 열린(비최소화) 창 id 집합을 primitive 문자열로 구독 → 드래그/리사이즈 시엔 리렌더 안 함.
  const openKey = useWindowStore((s) =>
    Object.entries(s.windows)
      .filter(([, w]) => !w.minimized)
      .map(([id]) => id)
      .sort()
      .join("|"),
  );
  const openIds = new Set(openKey ? openKey.split("|") : []);
  const hasFocus = isDesktop && !!focusedId && openIds.has(focusedId);

  // 접근 가능한 항목만 남기고 빈 그룹 제거 (그룹 구분선 위치 계산용)
  const groups = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((item) => !item.hidden && canAccess(systemRole, item.menuKey, permMatrix)),
  })).filter((g) => g.items.length > 0);

  return (
    <TooltipProvider delay={200}>
      <aside
        style={{ width }}
        className={`bg-sidebar border-line sticky top-0 flex h-screen shrink-0 flex-col border-r ${
          motion ? `transition-[width] duration-200 ${EASE}` : ""
        } relative ${className ?? ""}`}
      >
        {/* brand — 로고는 접힘 레일 중앙(left 26px) 고정, 워드마크만 페이드 */}
        <div className="border-line flex h-12 shrink-0 items-center overflow-hidden border-b pl-3">
          <Link href="/dashboard" aria-label="EYWA 대시보드" className="flex items-center gap-2.5">
            <span className="bg-primary shadow-primary-glow flex size-7 shrink-0 items-center justify-center rounded-[5px]">
              <EyIcon name="sprout" size={16} strokeWidth={1.9} className="text-white" />
            </span>
            <span
              className={`text-foreground overflow-hidden text-[15px] font-extrabold tracking-tight whitespace-nowrap ${
                expanded ? "max-w-[120px] opacity-100" : "max-w-0 opacity-0"
              } ${motion ? `transition-[max-width,opacity] duration-200 ${EASE}` : ""}`}
            >
              {logoText}
            </span>
          </Link>
        </div>

        {/* nav — 아이콘 레일(접힘) / 아이콘+라벨(펼침). 항목은 항상 풀폭, 내부 패딩으로 아이콘 고정. */}
        <nav className="flex flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto py-2.5">
          {groups.map((group, gi) => (
            <div key={group.label} className="flex w-full flex-col gap-1">
              {/* 그룹 구분 — 슬롯 높이가 펼침(22)↔접힘(헤더 0줄: gi>0은 구분선 13, 첫 그룹 6)으로
                  트랜지션해 "패널이 열리듯" 자연스럽게. 헤더 텍스트↔구분선은 opacity 크로스페이드. */}
              <div
                style={{ height: expanded ? 22 : gi > 0 ? 13 : 6 }}
                className={`relative flex shrink-0 items-center overflow-hidden ${
                  motion ? `transition-[height] duration-200 ${EASE}` : ""
                }`}
              >
                <span
                  className={`text-text-faint absolute left-[17px] font-mono text-[10px] font-bold tracking-wider whitespace-nowrap uppercase ${
                    expanded ? "opacity-100" : "opacity-0"
                  } ${motion ? "transition-opacity duration-200" : ""}`}
                >
                  {String(gi + 1).padStart(2, "0")} {group.label}
                </span>
                {gi > 0 ? (
                  <span
                    aria-hidden="true"
                    className={`bg-line absolute top-1/2 left-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 ${
                      expanded ? "opacity-0" : "opacity-100"
                    } ${motion ? "transition-opacity duration-200" : ""}`}
                  />
                ) : null}
              </div>
              {group.items.map((item) => {
                const winId = windowId("route", item.menuKey);
                const isOpen = isDesktop && openIds.has(winId);
                const active = isDesktop
                  ? (hasFocus && focusedId === winId) ||
                    (!hasFocus && isItemActive(item.href, pathname))
                  : isItemActive(item.href, pathname);
                const openOnly = isOpen && !active; // 열려 있지만 비포커스 → 점
                const subs = SUBTABS_BY_MENU[item.menuKey];
                return (
                  <div key={item.href} className="group/menu">
                    <RailItem
                      item={item}
                      active={active}
                      openOnly={openOnly}
                      isDesktop={isDesktop}
                      expanded={expanded}
                      motion={motion}
                    />
                    {/* 하부탭(면) — 펼친 사이드바에서, 활성 메뉴는 항상 / 그 외엔 마우스오버 시 노출(들여쓰기) */}
                    {isDesktop && expanded && subs ? (
                      <ul className={`mt-0.5 mb-1 space-y-px ${active ? "" : "hidden group-hover/menu:block"}`}>
                        {subs.map((sub) => (
                          <li key={sub.href}>
                            <SubTab
                              menuKey={item.menuKey}
                              label={sub.label}
                              href={sub.href}
                              active={isSubActive(sub.href, pathname, currentTab)}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        {/* user — 계정/로그아웃. 아이콘은 접힘 중앙 고정, 이메일만 페이드 */}
        <div className="border-line flex h-14 shrink-0 items-center gap-2.5 overflow-hidden border-t pl-2">
          <UserMenu email={email} />
          <div
            className={`overflow-hidden whitespace-nowrap ${
              expanded ? "max-w-[150px] opacity-100" : "max-w-0 opacity-0"
            } ${motion ? `transition-[max-width,opacity] duration-200 ${EASE}` : ""}`}
          >
            <div className="text-foreground truncate text-[12px] font-semibold">{email}</div>
          </div>
        </div>

        {/* 너비 조절 핸들 — 오른쪽 경계선. 끌어서 조절/접기, 더블클릭=토글, ←/→ 키 지원. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`사이드바 너비 조절 (더블클릭하면 ${expanded ? "접기" : "펼치기"})`}
          tabIndex={0}
          {...handleProps}
          className="group absolute top-0 right-0 z-20 flex h-full w-2 translate-x-1/2 cursor-col-resize touch-none items-center justify-center focus:outline-none"
        >
          <span
            className={`h-9 w-[3px] rounded-full transition ${
              dragging
                ? "bg-primary"
                : "bg-line opacity-0 group-hover:opacity-100 group-focus-visible:bg-primary group-focus-visible:opacity-100"
            }`}
          />
        </div>
      </aside>
    </TooltipProvider>
  );
}

// 하부탭 활성 판정 — 배경 프레임의 pathname + ?tab과 비교(창 안 면은 미하이라이트, best-effort).
function isSubActive(href: string, pathname: string, currentTab: string | null): boolean {
  const [path, query] = href.split("?");
  if (path !== pathname) return false;
  const tab = query ? new URLSearchParams(query).get("tab") : null;
  return (tab ?? null) === (currentTab ?? null);
}

/** 하부탭(면) 링크 — 클릭 시 부모 menuKey 창에서 그 면으로 이동(open이 href 갱신 → iframe 네비). */
function SubTab({
  menuKey,
  label,
  href,
  active,
}: {
  menuKey: string;
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        useWindowStore.getState().open("route", { id: menuKey, title: label, href });
      }}
      className={`block truncate rounded py-0.5 pr-2 pl-9 text-[11px] transition ${
        active ? "text-primary font-medium" : "text-text-faint hover:text-foreground hover:bg-bg-soft"
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * 레일 아이콘 1개. 데스크톱: 클릭=창 열기(cascade) / 오른쪽 드래그=드롭 지점에 창 꺼내기.
 * 드래그(>RAIL_DRAG, 수평 우세)면 뒤따르는 click을 억제하고 pointerup 지점에 창을 연다.
 * 모디파이어(새 탭 등)·모바일은 기본 Link 동작 보존. draggable=false로 네이티브 링크 드래그 차단.
 *
 * 접힘/펼침 모핑(motion=ON): 아이콘은 left 26px(접힘 레일 중앙)에 고정해 안 튀고,
 *  · 활성/hover 하이라이트(절대배치 bg)는 left/right를 8↔4로 트랜지션 → 사각형↔행 모핑
 *  · 라벨은 max-width+opacity 페이드(접힘 시 0폭, 레일이 클립). Tooltip은 접힘일 때만.
 */
function RailItem({
  item,
  active,
  openOnly,
  isDesktop,
  expanded,
  motion,
}: {
  item: NavItem;
  active: boolean;
  openOnly: boolean;
  isDesktop: boolean;
  expanded: boolean;
  motion: boolean;
}) {
  const Icon = item.icon;
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  function handleNav(e: React.MouseEvent) {
    if (!isDesktop || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (dragged.current) {
      dragged.current = false; // 드래그로 이미 열었으면 클릭 무시
      return;
    }
    useWindowStore
      .getState()
      .open("route", { id: item.menuKey, title: item.label, href: item.href });
  }

  const fg = active
    ? "text-primary-foreground"
    : openOnly
      ? "text-foreground"
      : "text-text-dim group-hover:text-foreground";

  const link = (
    <Link
      href={item.href}
      draggable={false}
      onClick={handleNav}
      onPointerDown={(e) => {
        if (!isDesktop || e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY };
        dragged.current = false;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || dragged.current) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        // 오른쪽(캔버스)으로 충분히 끌면 드래그로 판정(수평 우세). 실제 열기는 pointerup에서.
        if (dx > RAIL_DRAG && Math.abs(dx) >= Math.abs(dy)) {
          dragged.current = true;
        }
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        const s = start.current;
        start.current = null;
        if (dragged.current && s) openWindowAtPoint(item, e.clientX, e.clientY);
      }}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      className="group relative flex h-9 w-full items-center gap-2.5 pl-[17px] focus:outline-none"
    >
      {/* 모핑 하이라이트 — left/right 8↔4(접힘 사각형↔펼침 행). 라벨/아이콘 뒤(z-0). */}
      <span
        aria-hidden="true"
        style={{ left: expanded ? 4 : 8, right: expanded ? 4 : 8 }}
        className={`pointer-events-none absolute inset-y-0 z-0 rounded-[6px] ${
          active
            ? "bg-primary shadow-primary-glow opacity-100"
            : openOnly
              ? "bg-sidebar-accent opacity-100"
              : "bg-sidebar-accent opacity-0 group-hover:opacity-100"
        } ${motion ? `transition-[left,right,opacity,box-shadow] duration-200 ${EASE}` : ""}`}
      />
      <Icon
        size={18}
        strokeWidth={1.85}
        className={`relative z-10 shrink-0 ${fg} ${motion ? "transition-colors duration-200" : ""}`}
      />
      <span
        className={`relative z-10 overflow-hidden text-[13px] font-medium whitespace-nowrap ${fg} ${
          expanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
        } ${motion ? `transition-[max-width,opacity,color] duration-200 ${EASE}` : ""}`}
      >
        {item.label}
      </span>
      {openOnly ? (
        <span
          className={`bg-primary z-10 size-1.5 shrink-0 rounded-full ${
            expanded
              ? "relative ml-auto mr-1"
              : "absolute bottom-1 left-1/2 -translate-x-1/2"
          }`}
        />
      ) : null}
    </Link>
  );

  // 펼침 모드: 라벨이 이미 보이므로 Tooltip 생략. 접힘 모드: 우측 Tooltip 라벨.
  if (expanded) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
