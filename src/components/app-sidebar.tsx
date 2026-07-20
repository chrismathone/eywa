"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ExternalLink, PanelLeftClose, PanelLeftOpen } from "@/components/icons/eywa-icon-compat";
import { UserMenu } from "@/components/user-menu";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { EyIcon } from "@/components/icons/eywa-icons";
import {
  NAV_GROUPS,
  SUBTABS_BY_MENU,
  EXTERNAL_NAV,
  navPresentation,
  type NavItem,
  type ExternalNavItem,
  type SubTab as SubTabItem,
} from "@/lib/navigation";
import { canAccess, type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { TeacherViewToggle } from "@/components/view-mode-toggle";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { usePrefs } from "@/components/workspace/use-prefs";
import { useSidebarResize } from "@/components/workspace/use-sidebar-resize";
import { useWindowStore, windowId } from "@/components/workspace/window-store";
import { useShowDesktop } from "@/components/workspace/use-show-desktop";
import { withEmbed } from "@/components/workspace/embed-context";
import { iframeRegistry } from "@/components/workspace/route-window";
import {
  cancelScheduledPrefetch,
  scheduleEmbedPrefetch,
} from "@/components/workspace/prefetch-embed";

// 펼침/접힘 모핑 이징 — 창 스냅과 동일 톤. 모션 OFF면 적용 안 함.
const EASE = "ease-[cubic-bezier(0.22,0.61,0.36,1)]";

const RAIL_DRAG = 16; // 레일 아이콘을 오른쪽(캔버스)으로 이만큼 끌면 그 자리에 창 꺼내기

function isItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 메뉴 창을 열고(이미 열렸으면 복원) 드롭 지점(스테이지 로컬, 타이틀바가 커서 아래)으로 배치. */
function openWindowAtPoint(item: NavItem, clientX: number, clientY: number) {
  if (navPresentation(item) !== "window") return;
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
 * 활성 표시(데스크톱): 메뉴 클릭이 라우트 이동이 아니라 플로팅 창을 열므로 active는 윈도우 스토어로 구동한다 —
 *  · 포커스된 창의 메뉴 = 풀 하이라이트
 *  · 열려 있지만 비포커스 = 점(dot)
 *  · 포커스된 창이 없음(빈 데스크톱) = 아무 메뉴도 활성 아님
 * 모바일(라우트 이동)에서는 기존 pathname 기준을 유지.
 *
 * 데스크톱 제스처: 클릭=창 열기(cascade 위치) / 오른쪽으로 드래그=드롭 지점에 창 꺼내기.
 */
export function AppSidebar({
  systemRole,
  email,
  displayName,
  jobTitle,
  className,
  logoText = "EYWA",
  logoSrc,
  permMatrix,
  canTeacherView = false,
}: {
  systemRole: SystemRole;
  email: string;
  displayName: string;
  jobTitle?: string | null;
  className?: string;
  logoText?: string;
  logoSrc?: string | null;
  permMatrix?: AccessMatrix;
  /** 겸직(관리자 계열 + 담당 반 보유) → 하단에 '강사뷰로 전환' 노출. */
  canTeacherView?: boolean;
}) {
  // 호칭(직책) — 직접 입력한 job_title 우선, 없으면 시스템 역할의 한글 라벨로 폴백.
  const title = jobTitle?.trim() || ROLE_LABEL[systemRole];
  // 이름이 비면(이론상 거의 없음) 이메일 앞부분으로 폴백해 빈 줄을 방지.
  const name = displayName?.trim() || email.split("@")[0];
  const pathname = usePathname();
  const currentTab = useSearchParams().get("tab"); // 활성 하부탭 표시용(배경 프레임 기준)
  const isDesktop = useIsDesktop();
  const showDesktop = useShowDesktop();
  const { expanded, width, dragging, handleProps } = useSidebarResize();
  const animations = usePrefs((s) => s.animations);
  const toggleSidebar = usePrefs((s) => s.toggleSidebar); // 브랜드 줄 접기/펼치기 버튼(드래그·더블클릭과 동일 상태)

  // nav 스크롤 페이드 — 작은 창에서 메뉴가 넘칠 때 스크롤바 대신 상/하단 페이드로 "더 있음" 표시
  // (nav는 scrollbar-hide로 스크롤바 숨김·스크롤 유지). 패턴은 DragScrollArea edges와 동일.
  const navRef = useRef<HTMLElement>(null);
  const [navEdges, setNavEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => {
      const maxY = el.scrollHeight - el.clientHeight;
      setNavEdges({ top: el.scrollTop > 1, bottom: el.scrollTop < maxY - 1 });
    };
    update();
    // 접힘↔펼침은 콘텐츠 높이(그룹 슬롯 등)만 바뀌어 RO(박스 관찰)가 못 잡음 → 전환 트랜지션(200ms) 후 재계산.
    const settle = setTimeout(update, 250);
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      clearTimeout(settle);
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [expanded]);
  // 하부탭 플라이아웃(WordPress식) — 비활성 메뉴 hover 시 우측에 면 목록을 fixed 포털로 띄운다.
  // 인라인 노출은 hover마다 왼쪽 메뉴 전체를 리플로우해 산만 → **왼쪽 메뉴 고정** + 우측 팝업.
  // 활성(클릭·네비된) 메뉴만 왼쪽 인라인 하부탭 유지. nav가 overflow-clip이라 인라인 left-full은
  // 잘리므로 body 포털 + position:fixed(측정 좌표)로 클리핑 회피(HoverCard 패턴).
  const [flyout, setFlyout] = useState<
    { menuKey: MenuKey; label: string; subs: SubTabItem[]; top: number; left: number } | null
  >(null);
  const flyoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelFlyoutClose = () => {
    if (flyoutTimer.current) {
      clearTimeout(flyoutTimer.current);
      flyoutTimer.current = null;
    }
  };
  const openFlyout = (item: NavItem, subs: SubTabItem[], el: HTMLElement) => {
    cancelFlyoutClose();
    const r = el.getBoundingClientRect();
    setFlyout({ menuKey: item.menuKey, label: item.label, subs, top: r.top, left: r.right + 4 });
  };
  // 아이템 → 플라이아웃 이동 사이의 짧은 유예(둘 다 벗어나면 닫힘). 붙어 있어 이동은 연속이나 안전판.
  const scheduleFlyoutClose = () => {
    cancelFlyoutClose();
    flyoutTimer.current = setTimeout(() => setFlyout(null), 140);
  };
  useEffect(() => () => cancelFlyoutClose(), []);

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
      {/* z-[45] = 플로팅 창 캔버스(fixed z-40)보다 위, 커맨드 팰릿(z-50)보다 아래. 이유: 창이 경계선에
          딱 붙어 있으면(스냅/드래그) 창의 좌측 리사이즈 핸들이 사이드바 너비조절 핸들을 덮어 "경계선을
          끌면 창만 리사이즈"됐다 → 사이드바를 캔버스 위로 올려 **경계선 드래그=사이드바 너비조절**이
          되게 한다(사이드바 폭이 바뀌면 캔버스 left=rail도 따라가 창들이 함께 reflow). 창은 x≥0로
          클램프(use-pointer-drag)돼 사이드바 영역으로 안 들어오므로, 올려도 창을 가리지 않는다. */}
      <aside
        style={{ width }}
        className={`bg-sidebar border-line sticky top-0 z-[45] flex h-screen shrink-0 flex-col border-r ${
          motion ? `transition-[width] duration-200 ${EASE}` : ""
        } relative ${className ?? ""}`}
      >
        {/* brand — 펼침: 로고+워드마크 + 우측 접기 버튼 / 접힘: 펼치기 버튼만(로고는 크로스페이드로 사라짐).
            버튼은 absolute right-3 하나로 두 상태 모두 정합 — 접힘 52px에서 right 12px = 중앙 26px(레일 아이콘 축),
            펼침에선 우측 가장자리(Claude 패턴). 하단 배치는 계정 줄과 겹쳐 실패했던 이력(#57) — 상단 고정. */}
        <div className="border-line relative flex h-12 shrink-0 items-center overflow-hidden border-b pr-3 pl-3">
          <Link
            href="/dashboard"
            aria-label="EYWA 운영실"
            onClick={(e) => {
              if (!isDesktop || e.metaKey || e.ctrlKey || e.altKey) return;
              e.preventDefault();
              showDesktop();
            }}
            tabIndex={expanded ? undefined : -1}
            className={`flex min-w-0 flex-1 items-center gap-2.5 pr-9 ${
              expanded ? "opacity-100" : "pointer-events-none opacity-0"
            } ${motion ? "transition-opacity duration-200" : ""}`}
          >
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- 학원 로고(GCS/외부 이미지), next/image 최적화 불필요
              <img src={logoSrc} alt={logoText} className="size-7 shrink-0 rounded-[5px] object-contain" />
            ) : (
              <span className="bg-primary shadow-primary-glow flex size-7 shrink-0 items-center justify-center rounded-[5px]">
                <EyIcon name="building" size={16} strokeWidth={1.8} className="text-white" />
              </span>
            )}
            <span
              className={`text-foreground overflow-hidden text-[15px] font-bold tracking-tight whitespace-nowrap ${
                expanded ? "max-w-[120px] opacity-100" : "max-w-0 opacity-0"
              } ${motion ? `transition-[max-width,opacity] duration-200 ${EASE}` : ""}`}
            >
              {logoText}
            </span>
          </Link>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={expanded ? "사이드바 접기" : "사이드바 펼치기"}
            title={expanded ? "사이드바 접기" : "사이드바 펼치기"}
            aria-expanded={expanded}
            className="bg-sidebar text-text-dim hover:bg-bg-soft hover:text-foreground absolute top-1/2 right-3 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm transition-colors"
          >
            {expanded ? (
              <PanelLeftClose className="size-4" strokeWidth={1.8} />
            ) : (
              <PanelLeftOpen className="size-4" strokeWidth={1.8} />
            )}
          </button>
        </div>

        {/* nav — 아이콘 레일(접힘) / 아이콘+라벨(펼침). 항목은 항상 풀폭, 내부 패딩으로 아이콘 고정.
            작은 창에서 넘치면 스크롤바 없이 스크롤(scrollbar-hide) + 상/하단 페이드가 "더 있음" 힌트
            (페이드는 스크롤되지 않는 래퍼에 절대배치 — DragScrollArea와 동일 2겹 구조). */}
        <div className="relative min-h-0 flex-1">
          <nav
            ref={navRef}
            onScroll={() => setFlyout(null)}
            className="scrollbar-hide flex h-full flex-col gap-1 overflow-x-hidden overflow-y-auto py-2.5"
          >
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
                  className={`text-text-faint absolute left-[17px] text-[11px] font-bold whitespace-nowrap ${
                    expanded ? "opacity-100" : "opacity-0"
                  } ${motion ? "transition-opacity duration-200" : ""}`}
                >
                  {group.label}
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
                const presentation = navPresentation(item);
                const winId = windowId("route", item.menuKey);
                const isOpen = isDesktop && presentation === "window" && openIds.has(winId);
                const active = isDesktop
                  ? presentation === "desktop"
                    ? !hasFocus && isItemActive(item.href, pathname)
                    : hasFocus && focusedId === winId
                  : isItemActive(item.href, pathname);
                const openOnly = isOpen && !active; // 열려 있지만 비포커스 → 점
                // 이미 최상단(포커스)인 창 — 이 메뉴를 다시 누르면 "첫 화면"으로 리셋(아래 handleNav).
                const atTop =
                  isDesktop && presentation === "window" && hasFocus && focusedId === winId;
                const subs = SUBTABS_BY_MENU[item.menuKey];
                // 비활성 메뉴 + 하부탭 有 → hover 시 우측 플라이아웃(왼쪽 메뉴는 고정, 리플로우 없음).
                const flyoutable = isDesktop && expanded && !!subs && !active;
                return (
                  <div
                    key={item.href}
                    className="group/menu"
                    onMouseEnter={
                      flyoutable
                        ? (e) => openFlyout(item, subs!, e.currentTarget)
                        : undefined
                    }
                    onMouseLeave={flyoutable ? scheduleFlyoutClose : undefined}
                  >
                    <RailItem
                      item={item}
                      active={active}
                      openOnly={openOnly}
                      atTop={atTop}
                      isDesktop={isDesktop}
                      expanded={expanded}
                      motion={motion}
                      onShowDesktop={showDesktop}
                    />
                    {/* 하부탭(면) — 활성(클릭·네비된) 메뉴만 왼쪽에 인라인 노출. 비활성은 hover 우측 플라이아웃(위 참조). */}
                    {isDesktop && expanded && subs && active ? (
                      <ul className="mt-0.5 mb-1 space-y-px">
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
              {/* 외부 링크 탭(EXTERNAL_NAV) — 섹션별 외부 앱을 새 탭으로. 창·권한·subtab 없음. 현재 항목 0. */}
              {EXTERNAL_NAV.filter((x) => x.group === group.label).map((x) => (
                <ExternalRailItem key={x.href} item={x} expanded={expanded} motion={motion} />
              ))}
            </div>
          ))}

          {/* 단축키 안내 — 메뉴(관리자 도구 포함) 목록 아래. 펼침 데스크톱에서만(접힘 레일엔 공간 없음). */}
          {isDesktop && expanded ? (
            <p className="text-text-faint mt-1.5 space-y-0.5 px-4 pt-2 text-[10px] leading-snug">
              <span className="block">
                <kbd className="border-line bg-bg-soft text-text-dim rounded border px-1 py-px font-mono text-[9px]">
                  Shift
                </kbd>
                +
                <kbd className="border-line bg-bg-soft text-text-dim rounded border px-1 py-px font-mono text-[9px]">
                  F
                </kbd>{" "}
                검색(메뉴·학생·수업 점프)
              </span>
              <span className="block">
                <kbd className="border-line bg-bg-soft text-text-dim rounded border px-1 py-px font-mono text-[9px]">
                  Shift
                </kbd>
                +클릭 = 같은 화면을 새 창으로 하나 더
              </span>
            </p>
          ) : null}
          </nav>
          {/* 상/하단 스크롤 페이드 — 해당 방향으로 더 스크롤할 수 있을 때만 표시(내용이 배경으로 녹아듦) */}
          <span
            aria-hidden
            className={`from-sidebar pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b to-transparent transition-opacity duration-200 ${
              navEdges.top ? "opacity-100" : "opacity-0"
            }`}
          />
          <span
            aria-hidden
            className={`from-sidebar pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t to-transparent transition-opacity duration-200 ${
              navEdges.bottom ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>

        {/* 겸직(관리자+담당반) 강사뷰 전환 — user 줄 위, nav와 구분선으로 분리. 레일 톤. */}
        {canTeacherView ? (
          <div className="border-line shrink-0 border-t px-1 py-1.5">
            <TeacherViewToggle expanded={expanded} motion={motion} />
          </div>
        ) : null}

        {/* user — 계정/로그아웃 + 알림 벨 합체(2026-07-20 상단 헤더 제거로 벨이 여기로 이관).
            펼침: [사용자][이름·호칭][벨(우측)] 한 줄 / 접힘(52px 레일): 벨 위·사용자 아래 세로 스택.
            벨은 데스크톱에서만 마운트 — 모바일은 AppHeader 벨이 담당(이중 마운트=폴링·팝업 중복). */}
        <div
          className={`border-line shrink-0 overflow-hidden border-t ${
            expanded
              ? "flex h-14 items-center gap-2.5 pr-2 pl-2"
              : "flex flex-col-reverse items-center gap-0.5 py-1.5"
          }`}
        >
          <UserMenu email={email} displayName={name} jobTitle={title} />
          <div
            className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap ${
              expanded ? "max-w-[150px] opacity-100" : "hidden max-w-0 opacity-0"
            } ${motion ? `transition-[max-width,opacity] duration-200 ${EASE}` : ""}`}
          >
            <div className="text-foreground truncate text-[12px] font-bold leading-tight">{name}</div>
            <div className="text-text-dim truncate text-[11px] leading-tight">{title}</div>
          </div>
          {isDesktop ? (
            <div className={expanded ? "ml-auto shrink-0" : "shrink-0"}>
              <NotificationBell />
            </div>
          ) : null}
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

      {/* 하부탭 플라이아웃 — 비활성 메뉴 hover 시 우측 팝업(body 포털 + fixed = nav overflow 클리핑 회피).
          z-[46] = 사이드바(45) 위·커맨드 팰릿(50) 아래. 아이템↔팝업 이동 유예로 안 사라짐. */}
      {isDesktop && expanded && flyout
        ? createPortal(
            <div
              onMouseEnter={cancelFlyoutClose}
              onMouseLeave={scheduleFlyoutClose}
              onClick={() => setFlyout(null)}
              style={{ top: flyout.top, left: flyout.left }}
              className="bg-card border-line shadow-card fixed z-[46] min-w-[152px] rounded-lg border p-1"
            >
              <p className="text-text-faint px-2.5 pt-1 pb-1.5 text-[11px] font-bold">
                {flyout.label}
              </p>
              <ul className="space-y-px">
                {flyout.subs.map((sub) => (
                  <li key={sub.href}>
                    <SubTab
                      menuKey={flyout.menuKey}
                      label={sub.label}
                      href={sub.href}
                      active={isSubActive(sub.href, pathname, currentTab)}
                      inFlyout
                    />
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
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

/** 하부탭(면) 링크 — 클릭 시 부모 menuKey 창에서 그 면으로 이동(open이 href 갱신 → iframe 네비).
 *  inFlyout=우측 플라이아웃 팝업 안(아이콘 들여쓰기 pl-9 대신 균등 px-2.5). */
function SubTab({
  menuKey,
  label,
  href,
  active,
  inFlyout,
}: {
  menuKey: string;
  label: string;
  href: string;
  active: boolean;
  inFlyout?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        const store = useWindowStore.getState();
        // shift+클릭 = 그 면을 새 창으로(듀얼), 일반 클릭 = 부모 메뉴 창에서 면 전환.
        if (e.shiftKey) store.openNewInstance("route", { id: menuKey, title: label, href });
        else store.open("route", { id: menuKey, title: label, href });
      }}
      className={`block truncate rounded text-[11px] transition ${
        inFlyout ? "px-2.5 py-1" : "py-0.5 pr-2 pl-9"
      } focus-visible:ring-primary/50 focus-visible:ring-inset focus-visible:ring-2 focus-visible:outline-none ${
        active ? "text-primary font-medium" : "text-text-dim hover:text-foreground hover:bg-bg-soft"
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
  atTop,
  isDesktop,
  expanded,
  motion,
  onShowDesktop,
}: {
  item: NavItem;
  active: boolean;
  openOnly: boolean;
  /** 이 메뉴 창이 이미 최상단(포커스)임 — 다시 누르면 "첫 화면"(메뉴 루트)으로 리셋. */
  atTop: boolean;
  isDesktop: boolean;
  expanded: boolean;
  motion: boolean;
  onShowDesktop: () => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  function handleNav(e: React.MouseEvent) {
    // ctrl/cmd/alt+클릭은 브라우저 기본(새 탭 등) 유지. shift는 아래에서 "새 인스턴스(듀얼)"로 전용.
    if (!isDesktop || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    if (dragged.current) {
      dragged.current = false; // 드래그로 이미 열었으면 클릭 무시
      return;
    }
    if (navPresentation(item) === "desktop") {
      onShowDesktop();
      return;
    }
    const params = { id: item.menuKey, title: item.label, href: item.href };
    const store = useWindowStore.getState();
    // shift+클릭 = 같은 메뉴를 새 창으로 한 벌 더(듀얼).
    if (e.shiftKey) {
      store.openNewInstance("route", params);
      return;
    }
    // 이미 최상단(포커스)인 창을 다시 누르면 그 창을 "첫 화면"(메뉴 루트)으로 되돌린다 —
    // 상세 드릴인·하부탭 전환에서 한 번에 처음으로(뒤로 버튼과 동일하게 그 창 iframe만 replace).
    // 이미 루트면 homeNav가 null → 무동작. (닫았다 여는 번거로움 제거.)
    if (atTop) {
      const winId = windowId("route", item.menuKey);
      const target = store.homeNav(winId);
      if (target) iframeRegistry.get(winId)?.contentWindow?.location.replace(withEmbed(target));
      return;
    }
    // 일반 클릭 = 기존 창 포커스/열기(비포커스면 최상단으로, 없으면 새로 열기).
    store.open("route", params);
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
      // BL4 — hover 시 창 iframe용 ?embed=1 document 프리워밍(디바운스·메뉴 allowlist는 헬퍼).
      onMouseEnter={() =>
        scheduleEmbedPrefetch(item.href, {
          embed: isDesktop && navPresentation(item) === "window",
        })
      }
      onMouseLeave={() => cancelScheduledPrefetch()}
      onPointerDown={(e) => {
        if (!isDesktop || navPresentation(item) !== "window" || e.button !== 0) return;
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
      className="group focus-visible:ring-primary/55 relative flex h-9 w-full items-center gap-2.5 pl-[17px] focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
    >
      {/* 모핑 하이라이트 — left/right 8↔4(접힘 사각형↔펼침 행). 라벨/아이콘 뒤(z-0). */}
      <span
        aria-hidden="true"
        style={{ left: expanded ? 4 : 8, right: expanded ? 4 : 8 }}
        className={`pointer-events-none absolute inset-y-0 z-0 rounded-[9px] ${
          active
            ? "bg-primary shadow-primary-glow opacity-100"
            : openOnly
              ? "bg-sidebar-accent opacity-100"
              : "bg-sidebar-accent opacity-0 group-hover:opacity-100"
        } ${motion ? `transition-[left,right,opacity,box-shadow] duration-200 ${EASE}` : ""}`}
      />
      <EyIcon
        name={item.icon}
        size={18}
        strokeWidth={1.8}
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

/**
 * 외부 링크 레일 항목 — RailItem의 시각(아이콘+라벨+접힘/펼침 모핑·hover 하이라이트·접힘 Tooltip)을
 * 따르되, 내부 창/권한/드래그 로직 없이 **새 브라우저 탭**으로 여는 순수 앵커(cross-origin 별도 앱).
 * 펼침 시 라벨 옆 작은 ↗ 아이콘으로 "새 탭으로 열림"을 표시.
 */
function ExternalRailItem({
  item,
  expanded,
  motion,
}: {
  item: ExternalNavItem;
  expanded: boolean;
  motion: boolean;
}) {
  const Icon = item.icon;
  const link = (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${item.label} (새 탭으로 열림)`}
      className="group focus-visible:ring-primary/55 relative flex h-9 w-full items-center gap-2.5 pl-[17px] focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        style={{ left: expanded ? 4 : 8, right: expanded ? 4 : 8 }}
        className={`bg-sidebar-accent pointer-events-none absolute inset-y-0 z-0 rounded-[9px] opacity-0 group-hover:opacity-100 ${
          motion ? `transition-[left,right,opacity] duration-200 ${EASE}` : ""
        }`}
      />
      <Icon
        size={18}
        strokeWidth={1.8}
        className={`text-text-dim group-hover:text-foreground relative z-10 shrink-0 ${
          motion ? "transition-colors duration-200" : ""
        }`}
      />
      <span
        className={`text-text-dim group-hover:text-foreground relative z-10 inline-flex items-center gap-1 overflow-hidden text-[13px] font-medium whitespace-nowrap ${
          expanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
        } ${motion ? `transition-[max-width,opacity,color] duration-200 ${EASE}` : ""}`}
      >
        <span className="truncate">{item.label}</span>
        <ExternalLink size={11} strokeWidth={1.8} className="text-text-faint shrink-0" aria-hidden="true" />
      </span>
    </a>
  );

  if (expanded) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
