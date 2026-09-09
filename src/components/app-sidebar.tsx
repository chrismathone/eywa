"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PanelLeftClose, PanelLeftOpen } from "@/components/icons/eywa-icon-compat";
import { UserMenu } from "@/components/user-menu";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { EyIcon } from "@/components/icons/eywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { navItemByKey, navPresentation, type NavItem } from "@/lib/navigation";
import { type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import { HUB_GROUPS, SUPPORT_GROUPS, frequentFor, hubGroupsFor, type HubGroup } from "@/lib/menu-hub";
import { recordMenuVisit } from "@/features/nav/server/visit-actions";
import { useMenuHub } from "./workspace/menu-hub-store";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { TeacherViewToggle } from "@/components/view-mode-toggle";
import { OtherTeacherViewPicker } from "@/components/other-teacher-view";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { usePrefs } from "@/components/workspace/use-prefs";
import { useSidebarWidth } from "@/components/workspace/use-sidebar-resize";
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
 *  · 포커스된 창이 없음(빈 데스크톱) = 아무 메뉴도 활성 아님
 * 🔴 **열려 있는 다른 창은 표시하지 않는다**(원장 2026-09-09 *"열려있는 창 모두 표시하지말고 현재 보고 있는
 *    창만 탭에서 표시"*) — 창을 여럿 띄우면 줄이 여럿 칠해져 "지금 어디를 보고 있나"가 안 읽혔다.
 *    옛 표식(연한 채움 + 점)을 되살리지 말 것.
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
  canOtherTeacherView = false,
  frequentKeys,
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
  /** '다른 강사 뷰'(열람 전용) 자격(master·super_admin·강사뷰 접근 토글) → 하단에 강사 피커 노출. */
  canOtherTeacherView?: boolean;
  /** 자주 방문한 메뉴(많이 → 최근 순, 권한 통과분). 비면 기본값으로 떨어진다. */
  frequentKeys?: MenuKey[];
}) {
  // 호칭(직책) — 직접 입력한 job_title 우선, 없으면 시스템 역할의 한글 라벨로 폴백.
  const title = jobTitle?.trim() || ROLE_LABEL[systemRole];
  // 이름이 비면(이론상 거의 없음) 이메일 앞부분으로 폴백해 빈 줄을 방지.
  const name = displayName?.trim() || email.split("@")[0];
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const showDesktop = useShowDesktop();
  // 폭은 고정이다(원장 2026-09-07) — 접기/펴기만.
  const { expanded, width } = useSidebarWidth();
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

  const motion = animations;
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
  // 포커스된 창이 **지금 보고 있는 주소** — 하부탭 활성 판정에 쓴다.
  // 버튼형 메뉴(원장 2026-09-07 확정) — 왼쪽은 **업무군**만 세우고, 그 업무의 메뉴는 본문 버튼이 든다.
  // 🔴 목적지·권한 판정은 [`menu-hub.ts`](src/lib/menu-hub.ts) 한 곳 — 사이드바가 메뉴를 다시 적지 않는다.
  const gate = {
    systemRole,
    permMatrix,
    canTeacherView,
    isMaster: systemRole === "master",
  };
  // 자주 방문한 메뉴 — 서버가 계정 기록에서 뽑아 순서대로 내려준다(없으면 기본값).
  const frequent = frequentFor(gate, frequentKeys);
  const workGroups = hubGroupsFor(HUB_GROUPS, gate);
  const supportGroups = hubGroupsFor(SUPPORT_GROUPS, gate);
  const hubOpenId = useMenuHub((s) => s.groupId);
  const toggleHub = useMenuHub((s) => s.toggle);
  const closeHub = useMenuHub((s) => s.close);

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
            href="/menu"
            aria-label="메뉴로"
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
              className={`text-foreground overflow-hidden text-base font-bold tracking-tight whitespace-nowrap ${
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
            className="scrollbar-hide flex h-full flex-col gap-1 overflow-x-hidden overflow-y-auto py-2.5"
          >
          {/* 자주 방문한 메뉴 — 연 횟수로 자동 정렬(사람이 고르는 즐겨찾기가 아니다). */}
          {frequent.length > 0 ? (
            <NavSection label="자주 방문한 메뉴" first expanded={expanded} motion={motion}>
              {frequent.map((d) => {
                const item = navItemByKey(d.menuKey);
                return item ? (
                  <MenuRail
                    key={d.href}
                    item={item}
                    isDesktop={isDesktop}
                    expanded={expanded}
                    motion={motion}
                    onShowDesktop={showDesktop}
                    onOpen={closeHub}
                    pathname={pathname}
                    focusedId={focusedId}
                    hasFocus={hasFocus}
                    hubOpen={hubOpenId !== null}
                  />
                ) : null;
              })}
            </NavSection>
          ) : null}

          {/* 전체 업무 — 업무군을 누르면 본문에 그 업무의 메뉴 버튼이 뜬다(운영실·캘린더는 바로 열린다). */}
          <NavSection label="전체 업무" first={frequent.length === 0} expanded={expanded} motion={motion}>
            {workGroups.map((g) => (
              <GroupRail
                key={g.id}
                group={g}
                isDesktop={isDesktop}
                expanded={expanded}
                motion={motion}
                onShowDesktop={showDesktop}
                onToggleHub={toggleHub}
                onCloseHub={closeHub}
                hubOpenId={hubOpenId}
                pathname={pathname}
                focusedId={focusedId}
                hasFocus={hasFocus}
              />
            ))}
          </NavSection>

          {/* 지원 — 설정(면이 많아 허브)·도움말. */}
          {supportGroups.length > 0 ? (
            <NavSection label="지원" expanded={expanded} motion={motion}>
              {supportGroups.map((g) => (
                <GroupRail
                  key={g.id}
                  group={g}
                  isDesktop={isDesktop}
                  expanded={expanded}
                  motion={motion}
                  onShowDesktop={showDesktop}
                  onToggleHub={toggleHub}
                  onCloseHub={closeHub}
                  hubOpenId={hubOpenId}
                  pathname={pathname}
                  focusedId={focusedId}
                  hasFocus={hasFocus}
                />
              ))}
            </NavSection>
          ) : null}
          {/* 단축키 안내 — 메뉴(관리자 도구 포함) 목록 아래. 펼침 데스크톱에서만(접힘 레일엔 공간 없음). */}
          {isDesktop && expanded ? (
            <p className="text-text-faint mt-1.5 space-y-0.5 px-4 pt-2 text-xs leading-snug">
              <span className="block">
                <kbd className="border-line bg-bg-soft text-text-dim rounded border px-1 py-px font-mono text-xs">
                  Shift
                </kbd>
                +
                <kbd className="border-line bg-bg-soft text-text-dim rounded border px-1 py-px font-mono text-xs">
                  F
                </kbd>{" "}
                검색(메뉴·학생·수업 점프)
              </span>
              <span className="block">
                <kbd className="border-line bg-bg-soft text-text-dim rounded border px-1 py-px font-mono text-xs">
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

        {/* 겸직(관리자+담당반) 강사뷰 전환 + '다른 강사 뷰'(열람 전용) — user 줄 위, nav와 구분선으로 분리. */}
        {canTeacherView || canOtherTeacherView ? (
          <div className="border-line shrink-0 border-t px-1 py-1.5">
            {canTeacherView ? <TeacherViewToggle expanded={expanded} motion={motion} /> : null}
            {canOtherTeacherView ? <OtherTeacherViewPicker expanded={expanded} motion={motion} /> : null}
          </div>
        ) : null}

        {/* user — 계정/로그아웃 + 알림 벨 합체(2026-07-20 상단 헤더 제거로 벨이 여기로 이관).
            펼침: [사용자][이름·호칭][벨(우측)] 한 줄 / 접힘(52px 레일): 벨 위·사용자 아래 세로 스택.
            벨은 데스크톱에서만 마운트 — 모바일은 MobileTopNav 벨이 담당(이중 마운트=폴링·팝업 중복). */}
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
            <div className="text-foreground truncate text-xs font-bold leading-tight">{name}</div>
            <div className="text-text-dim truncate text-xs leading-tight">{title}</div>
          </div>
          {isDesktop ? (
            <div className={expanded ? "ml-auto shrink-0" : "shrink-0"}>
              <NotificationBell />
            </div>
          ) : null}
        </div>

      </aside>

    </TooltipProvider>
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
/**
 * 섹션 머리 — 펼침이면 라벨, 접힘이면 얇은 구분선(옛 그룹 헤더와 같은 모핑).
 * 첫 섹션은 구분선을 안 그린다(맨 위에 선이 뜨면 헤더와 붙어 보인다).
 */
function NavSection({
  label,
  first = false,
  expanded,
  motion,
  children,
}: {
  label: string;
  first?: boolean;
  expanded: boolean;
  motion: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-1">
      <div
        style={{ height: expanded ? 22 : first ? 6 : 13 }}
        className={`relative flex shrink-0 items-center overflow-hidden ${
          motion ? `transition-[height] duration-200 ${EASE}` : ""
        }`}
      >
        <span
          className={`text-text-faint absolute left-[17px] text-xs font-bold whitespace-nowrap ${
            expanded ? "opacity-100" : "opacity-0"
          } ${motion ? "transition-opacity duration-200" : ""}`}
        >
          {label}
        </span>
        {!first ? (
          <span
            aria-hidden="true"
            className={`bg-line absolute top-1/2 left-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 ${
              expanded ? "opacity-0" : "opacity-100"
            } ${motion ? "transition-opacity duration-200" : ""}`}
          />
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** 창 상태(포커스·열림) 판정 — 옛 렌더 안에서 하던 계산을 한 곳으로. */
function railState(
  item: NavItem,
  {
    isDesktop,
    pathname,
    focusedId,
    hasFocus,
    hubOpen = false,
  }: {
    isDesktop: boolean;
    pathname: string;
    focusedId: string | null;
    hasFocus: boolean;
    /** 메뉴 허브가 떠 있나 — 그동안은 배경 라우트(운영실) 표시를 양보한다(활성 줄이 둘이면 지금 어디인지 모호). */
    hubOpen?: boolean;
  },
) {
  const presentation = navPresentation(item);
  const winId = windowId("route", item.menuKey);
  const active = isDesktop
    ? presentation === "desktop"
      ? !hasFocus && !hubOpen && isItemActive(item.href, pathname)
      : hasFocus && focusedId === winId
    : isItemActive(item.href, pathname);
  // 🔴 열려 있는 창은 표시하지 않는다(원장 2026-09-09) — 표시는 **지금 보고 있는 창 하나**뿐이다.
  //    `openIds`는 포커스 판정(hasFocus)에만 남는다.
  return {
    active,
    atTop: isDesktop && presentation === "window" && hasFocus && focusedId === winId,
  };
}

/** 메뉴 한 줄 — 즐겨찾기·바로 여는 업무군(운영실·캘린더·도움말)이 쓴다. 제스처는 RailItem 그대로. */
function MenuRail({
  item,
  isDesktop,
  expanded,
  motion,
  onShowDesktop,
  onOpen,
  pathname,
  focusedId,
  hasFocus,
  hubOpen = false,
}: {
  item: NavItem;
  isDesktop: boolean;
  expanded: boolean;
  motion: boolean;
  onShowDesktop: () => void;
  /** 화면을 열면 떠 있던 메뉴 허브는 닫는다(작업 화면이 앞으로 온다). */
  onOpen: () => void;
  pathname: string;
  focusedId: string | null;
  hasFocus: boolean;
  hubOpen?: boolean;
}) {
  const st = railState(item, { isDesktop, pathname, focusedId, hasFocus, hubOpen });
  return (
    <div
      onClick={() => {
        onOpen();
        // '자주 방문한 메뉴'의 재료 — 기록은 뒤따를 뿐 여는 동작을 막지 않는다(실패해도 조용히).
        void recordMenuVisit(item.menuKey);
      }}
    >
      <RailItem
        item={item}
        active={st.active}
        atTop={st.atTop}
        isDesktop={isDesktop}
        expanded={expanded}
        motion={motion}
        onShowDesktop={onShowDesktop}
      />
    </div>
  );
}

/**
 * 업무군 한 줄 — `direct`면 그 화면을 바로 열고, `hub`면 **본문 메뉴 버튼**을 띄운다(토글).
 * 🔴 업무군은 권한 축이 아니다 — 자식이 하나라도 열려야 이 줄이 서고(hubGroupsFor), 접근 판정은 자식마다 한다.
 */
function GroupRail({
  group,
  isDesktop,
  expanded,
  motion,
  onShowDesktop,
  onToggleHub,
  onCloseHub,
  hubOpenId,
  pathname,
  focusedId,
  hasFocus,
}: {
  group: HubGroup;
  isDesktop: boolean;
  expanded: boolean;
  motion: boolean;
  onShowDesktop: () => void;
  onToggleHub: (id: string) => void;
  onCloseHub: () => void;
  hubOpenId: string | null;
  pathname: string;
  focusedId: string | null;
  hasFocus: boolean;
}) {
  const direct = group.kind === "direct" ? navItemByKey(group.items[0]!.menuKey) : undefined;
  if (direct) {
    return (
      <MenuRail
        item={direct}
        isDesktop={isDesktop}
        expanded={expanded}
        motion={motion}
        onShowDesktop={onShowDesktop}
        onOpen={onCloseHub}
        pathname={pathname}
        focusedId={focusedId}
        hasFocus={hasFocus}
        hubOpen={hubOpenId !== null}
      />
    );
  }
  // 허브가 떠 있거나, 이 업무군의 화면이 지금 포커스면 활성.
  const hubOpen = hubOpenId === group.id;
  const focusedHere =
    hasFocus && group.items.some((d) => windowId("route", d.menuKey) === focusedId);
  const active = hubOpen || focusedHere;
  // 🔴 **열려 있는 창을 표시하지 않는다**(원장 2026-09-09 *"열려있는 창 모두 표시하지말고 현재 보고 있는
  //    창만 탭에서 표시"*) — 창을 여럿 띄우면 줄이 여럿 칠해져 "지금 어디를 보고 있나"가 안 읽혔다.
  //    표시는 **포커스 하나**뿐이다. 점·연한 채움을 되살리지 말 것(`openIds`는 포커스 판정에만 쓴다).

  return (
    <button
      type="button"
      onClick={() => onToggleHub(group.id)}
      aria-expanded={hubOpen}
      aria-label={`${group.label} 메뉴`}
      title={expanded ? undefined : group.label}
      className={`group relative flex h-9 w-full shrink-0 items-center rounded-md text-sm ${
        active ? "text-primary-foreground" : "text-text-dim hover:text-foreground"
      }`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 rounded-md ${expanded ? "right-1 left-1" : "right-2 left-2"} ${
          active ? "bg-primary" : "group-hover:bg-bg-soft"
        } ${motion ? `transition-[left,right] duration-200 ${EASE}` : ""}`}
      />
      <span className="absolute left-[26px] flex -translate-x-1/2 items-center justify-center">
        <MenuGlyph name={group.icon} size={18} />
      </span>
      <span
        className={`relative ml-[42px] flex min-w-0 flex-1 items-center gap-1 overflow-hidden pr-2 whitespace-nowrap ${
          expanded ? "max-w-[220px] opacity-100" : "max-w-0 opacity-0"
        } ${motion ? `transition-[max-width,opacity] duration-200 ${EASE}` : ""}`}
      >
        {/* 🔴 오른쪽 꺾쇠는 없다(원장 2026-09-07 *"화살표는 필요없어"*) — 12줄 전부에 붙으니 줄마다
            같은 기호가 반복돼 이름을 읽는 데 방해가 됐다. */}
        <span className="truncate font-medium">{group.label}</span>
      </span>
    </button>
  );
}

function RailItem({
  item,
  active,
  atTop,
  isDesktop,
  expanded,
  motion,
  onShowDesktop,
}: {
  item: NavItem;
  /** 🔴 **지금 보고 있는 창 하나**만 참이다 — 열려 있는 다른 창은 표시하지 않는다(원장 2026-09-09). */
  active: boolean;
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

  const fg = active ? "text-primary-foreground" : "text-text-dim group-hover:text-foreground";

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
            : "bg-sidebar-accent opacity-0 group-hover:opacity-100"
        } ${motion ? `transition-[left,right,opacity,box-shadow] duration-200 ${EASE}` : ""}`}
      />
      <MenuGlyph
        name={item.icon}
        size={18}
        className={`relative z-10 shrink-0 ${fg} ${motion ? "transition-colors duration-200" : ""}`}
      />
      <span
        className={`relative z-10 overflow-hidden text-sm font-medium whitespace-nowrap ${fg} ${
          expanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
        } ${motion ? `transition-[max-width,opacity,color] duration-200 ${EASE}` : ""}`}
      >
        {item.label}
      </span>
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

