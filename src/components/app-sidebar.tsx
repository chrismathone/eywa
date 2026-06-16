"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserMenu } from "@/components/user-menu";
import { NAV_GROUPS, type NavItem } from "@/lib/navigation";
import { canAccess, type SystemRole } from "@/lib/permissions";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { useWindowStore, windowId } from "@/components/workspace/window-store";

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
 * 컴팩트 아이콘 레일 (52px) — 기존 232px 사이드바를 대체.
 * 아이콘만 노출, hover 시 Tooltip 라벨(우측). 그룹은 얇은 구분선으로 분리.
 * 텍스트로 메뉴를 찾고 싶으면 검색 팰릿(command-palette, 헤더 검색 클릭)을 사용.
 * UserMenu(로그아웃 포함)는 레일 하단에 고정.
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
}: {
  systemRole: SystemRole;
  email: string;
  className?: string;
}) {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
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
                const winId = windowId("route", item.menuKey);
                const isOpen = isDesktop && openIds.has(winId);
                const active = isDesktop
                  ? (hasFocus && focusedId === winId) ||
                    (!hasFocus && isItemActive(item.href, pathname))
                  : isItemActive(item.href, pathname);
                const openOnly = isOpen && !active; // 열려 있지만 비포커스 → 점
                return (
                  <RailItem
                    key={item.href}
                    item={item}
                    active={active}
                    openOnly={openOnly}
                    isDesktop={isDesktop}
                  />
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

/**
 * 레일 아이콘 1개. 데스크톱: 클릭=창 열기(cascade) / 오른쪽 드래그=드롭 지점에 창 꺼내기.
 * 드래그(>RAIL_DRAG, 수평 우세)면 뒤따르는 click을 억제하고 pointerup 지점에 창을 연다.
 * 모디파이어(새 탭 등)·모바일은 기본 Link 동작 보존. draggable=false로 네이티브 링크 드래그 차단.
 */
function RailItem({
  item,
  active,
  openOnly,
  isDesktop,
}: {
  item: NavItem;
  active: boolean;
  openOnly: boolean;
  isDesktop: boolean;
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

  return (
    <Tooltip>
      <TooltipTrigger
        render={
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
            className={`relative flex size-9 items-center justify-center rounded-[6px] transition ${
              active
                ? "bg-primary text-primary-foreground shadow-primary-glow"
                : openOnly
                  ? "bg-sidebar-accent text-foreground"
                  : "text-text-dim hover:bg-sidebar-accent hover:text-foreground"
            }`}
          />
        }
      >
        <Icon size={18} strokeWidth={1.85} />
        {openOnly ? (
          <span className="bg-primary absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full" />
        ) : null}
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
