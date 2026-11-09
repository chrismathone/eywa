"use client";

import { windowIdForHref } from "@/components/workspace/window-link";

import { useNavigationSettings } from "@/features/owner/navigation-context";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PanelLeftClose, PanelLeftOpen } from "@/components/icons/aywa-icon-compat";
import { UserMenu } from "@/components/user-menu";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { AssistantNavButton } from "@/features/assistant/components/assistant-nav-button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { findNavItem, navItemByKey, navPresentation, type NavItem } from "@/lib/navigation";
import { type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import {
  HUB_GROUPS,
  SUPPORT_GROUPS,
  frequentFor,
  hubGroupOfPath,
  hubDestinationForPath,
  hubGroupsFor,
  hubSearchEntries,
  type HubGroup,
} from "@/lib/menu-hub";
import { SidebarSearchBox, SidebarSearchShowButton } from "@/components/sidebar-menu-search";
import { SidebarMenuMap } from "@/components/sidebar-menu-map";
import { saveMenuSearchHidden } from "@/features/nav/server/visit-actions";
import type { MenuLayout } from "@/features/owner/menu-layout";
import type { ConnectedApp } from "@/features/connected-apps/apps";
import { ConnectedAppRail } from "@/components/connected-app-rail";
import { recordMenuVisit } from "@/features/nav/server/visit-actions";
import { useMenuHub } from "./workspace/menu-hub-store";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { TeacherViewSwitcher } from "@/components/other-teacher-view";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { useWindowMode } from "@/components/workspace/use-window-mode";
import { useKeepaliveMode } from "@/components/workspace/shell-mode";
import { usePrefs } from "@/components/workspace/use-prefs";
import { useSidebarWidth } from "@/components/workspace/use-sidebar-resize";
import { useWindowStore, windowId } from "@/components/workspace/window-store";
import { useShowDesktop } from "@/components/workspace/use-show-desktop";
import { useShellHome } from "@/components/workspace/shell-home";
import { openMenuWindow } from "@/components/workspace/open-menu-window";
import {
  cancelScheduledPrefetch,
  scheduleEmbedPrefetch,
} from "@/components/workspace/prefetch-embed";

// 펼침/접힘 모핑 이징 — 창 스냅과 동일 톤. 모션 OFF면 적용 안 함.
/**
 * 사이드바 줄의 **라벨 시작 x** — 두 종류의 줄이 같은 자리에서 글자를 시작해야 한다.
 *
 * 계기(원장 2026-09-10): *"탭 글씨 줄맞춤 안되어있네. 이런 기본적인것"*. 업무군 줄(`GroupRail`)은
 * 아이콘을 절대배치하고 라벨 왼쪽 여백을 42px로 줬는데, 바로 여는 줄(`RailItem` — 운영실·회의록·
 * 자주 방문한 메뉴)은 흐름 배치라 `pl-[17px]`(17) + 아이콘(18) + `gap-2.5`(10) = **45px**였다.
 * 3px 차이라 한 줄만 있을 땐 안 보였는데, 회의록을 왼쪽 탭으로 빼면서 업무군 줄 **사이에** 서자 드러났다.
 * 🔴 값을 두 곳에 적지 말 것 — 한쪽만 고치면 다시 어긋난다(가드가 17+18+10=45를 잠근다).
 */
const RAIL_LABEL_ML = "ml-[45px]";

const EASE = "ease-[cubic-bezier(0.22,0.61,0.36,1)]";

const RAIL_DRAG = 16; // 레일 아이콘을 오른쪽(캔버스)으로 이만큼 끌면 그 자리에 창 꺼내기

/**
 * 펼침 사이드바에서 묶음 머리글이 차지하는 띠 높이(px) — 접기 애니메이션(`transition-[height]`)이
 * 숫자를 요구해서 고정값이다.
 *
 * 🔴 **글자 높이에서 도출한 값이다** — `text-xs`(타입 스케일 v5에서 14px) × `--text-xs--line-height`(1.45)
 *    ≈ 20.3px. 머리글은 `bottom-0`으로 아래에 붙으므로 남는 위쪽이 곧 구분선과의 간격이다:
 *    · 첫 묶음(선 없음) 24 − 20.3 ≈ **3.7px** 위 여백
 *    · 그 외 34 − 20.3 ≈ **13.7px**(맨 위 1px이 구분선, 나머지가 선↔글자 간격)
 * ⚠️ 글자 크기·줄높이 토큰이 또 오르면 **이 두 값도 함께 재어 올릴 것** — 안 그러면 `overflow-hidden`이
 *    머리글 위를 자르거나 구분선이 글자를 가로지른다(시간표 `NAME_ROOM_H`·`PERIOD_H`가 v5에서 겪은 결함과
 *    같은 계열이다: 고정 높이가 글자 상승을 안 따라옴).
 */
const SECTION_HEAD_H = 34;
const SECTION_HEAD_H_FIRST = 24;

function isItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 메뉴 창을 열고(이미 열렸으면 복원) 드롭 지점(스테이지 로컬, 타이틀바가 커서 아래)으로 배치. */
function openWindowAtPoint(item: NavItem, clientX: number, clientY: number) {
  if (navPresentation(item) !== "window") return;
  const st = useWindowStore.getState();
  st.open("route", { id: item.menuKey, title: hubDestinationForPath(item.href)?.label ?? item.label, href: item.href });
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
 * 메뉴 이름으로 찾기 = 브랜드 줄 아래 메뉴 검색칸(sidebar-menu-search, 2026-10-19). 학생·수업까지는 검색 팰릿(Shift+F).
 * UserMenu(로그아웃 포함)는 하단에 고정.
 *
 * 활성 표시(데스크톱): 메뉴 클릭이 라우트 이동이 아니라 플로팅 창을 열므로 active는 윈도우 스토어로 구동한다 —
 *  · 포커스된 창이 **지금 보여 주는 주소**의 메뉴 줄·업무군 = 풀 하이라이트(창 id가 아니라 주소 — 알림·링크로 연
 *    상세 창도, 창 안에서 옮겨 간 화면도 같은 규칙으로 읽힌다)
 *  · 메뉴 판(허브)이 떠 있음 = 그 판의 업무군만(판이 캔버스를 덮어 창은 안 보인다)
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
  isSuperAdmin,
  email,
  displayName,
  jobTitle,
  className,
  logoText = "에이와",
  logoSrc,
  permMatrix,
  canTeacherView = false,
  canOtherTeacherView = false,
  frequentKeys,
  menuSearchHidden = false,
  menuLayout,
  isGenericTenant = false,
  canViewVendors = false,
  connectedApps = [],
  canUseAssistant = false,
}: {
  systemRole: SystemRole;
  /** 학원 비서 버튼(원장·슈퍼관리자 · 강사뷰·지점 보기 아님 · 지점 AI 켜짐 — 서버 판정). 오버레이는 레이아웃의 AssistantLauncher. */
  canUseAssistant?: boolean;
  /** 총괄(super_admin) — master 전용 목적지를 함께 연다. */
  isSuperAdmin?: boolean;
  email: string;
  displayName: string;
  jobTitle?: string | null;
  className?: string;
  logoText?: string;
  logoSrc?: string | null;
  permMatrix?: AccessMatrix;
  /** 겸직(관리자 계열 + 담당 반 보유) → 하단 '강사뷰 전환' 맨 위에 '나'. */
  canTeacherView?: boolean;
  /** '다른 강사 뷰'(열람 전용) 자격(master·super_admin·강사뷰 접근 토글) → 하단 '강사뷰 전환'에 다른 강사 목록. */
  canOtherTeacherView?: boolean;
  /** 자주 방문한 메뉴(많이 → 최근 순, 권한 통과분). 비면 기본값으로 떨어진다. */
  frequentKeys?: MenuKey[];
  /** '메뉴 검색' 칸을 숨겼나 — 계정 설정(`users.ui_prefs.nav.searchHidden`, 원장 2026-10-19). */
  menuSearchHidden?: boolean;
  /**
   * 학원 설정 '왼쪽 탭'(보기 설정 — 권한 아님). 비면 지금과 똑같이 동작한다.
   * ⚠️ 감춘 메뉴는 '자주 방문한 메뉴' 줄에서도 빠진다 — 안 그러면 "감췄는데 맨 위에 그대로"가 된다.
   */
  menuLayout?: MenuLayout;
  /** 새 학원(일반판) — 설정 '기능' 면 노출(설정 화면 탭과 같은 판정). 모르면 false(침산처럼). */
  isGenericTenant?: boolean;
  /** 업체리스트 지정자 — 학원운영 판의 '업체리스트' 입구(menu-hub `vendorsOnly`). */
  canViewVendors?: boolean;
  /** 이 지점에 켜진 연결 앱(슈퍼관리자 스위치, 기본 꺼짐) — 비면 '연결 앱' 구역이 안 선다. */
  connectedApps?: readonly ConnectedApp[];
}) {
  // 호칭(직책) — 직접 입력한 job_title 우선, 없으면 시스템 역할의 한글 라벨로 폴백.
  const { groups: groupLayout } = useNavigationSettings();
  const title = jobTitle?.trim() || ROLE_LABEL[systemRole];
  // 이름이 비면(이론상 거의 없음) 이메일 앞부분으로 폴백해 빈 줄을 방지.
  const name = displayName?.trim() || email.split("@")[0];
  const pathname = usePathname();
  // 🔴 두 값이 다르다 — `isDesktop`은 **모양**(사이드바에 벨을 달까 · 단축키 안내), `windows`는 **동작**(메뉴를 창으로 여나).
  //    지점 설정으로 창 모드를 끈 PC는 isDesktop=true · windows=false다(사이드바는 그대로, 메뉴는 본문 이동).
  const isDesktop = useIsDesktop();
  const windows = useWindowMode();
  // 단일 화면(이전 화면 유지)엔 '같은 화면을 새 창으로 하나 더'(복제)가 없다 — 그 단축키 안내를 세우지 않는다(원장 2026-10-01).
  const keepalive = useKeepaliveMode();
  const showDesktop = useShowDesktop();
  // 로고가 가는 첫 화면 — 권한을 본 홈(`/dashboard` | `/menu`). `/dashboard`를 직접 적지 말 것(gotchas #137).
  const home = useShellHome();
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
  const hasFocus = windows && !!focusedId && openIds.has(focusedId);
  // 포커스된 창이 **지금 보여 주는 주소**(창 안 이동을 따라가는 nav 스택 맨 위, 아직 보고가 없으면 창의 첫 주소) —
  // '지금 보는 곳' 표시의 단일 입력. 🔴 창 id로 비교하지 않는다(2026-09-11 전수검사): 알림·링크로 연 상세 창
  // (`route:students/abc`)은 메뉴 id가 아니라 켜지는 줄이 없었고, 창 안에서 다른 화면으로 옮겨 가도 옛 줄이 켜져 있었다.
  const focusedPath = useWindowStore((s) => {
    const id = s.focusedId;
    if (!id) return null;
    const w = s.windows[id];
    // 학생 요약 창(검색 팰릿의 원생 결과 — peek)은 주소가 없다. 보여 주는 것이 곧 그 원생이라 원생 상세 주소로 읽는다.
    if (w?.kind === "student") return `/students/${w.params.id}`;
    const stack = s.nav[id];
    return stack?.[stack.length - 1] ?? w?.params.href ?? null;
  });
  // 버튼형 메뉴(원장 2026-09-07 확정) — 왼쪽은 **업무군**만 세우고, 그 업무의 메뉴는 본문 버튼이 든다.
  // 🔴 목적지·권한 판정은 [`menu-hub.ts`](src/lib/menu-hub.ts) 한 곳 — 사이드바가 메뉴를 다시 적지 않는다.
  const gate = {
    systemRole,
    permMatrix,
    canTeacherView,
    // 🔴 총괄(super_admin)도 통과 — 총괄은 역할이 아니라 별도 표라 users.system_role이 'admin'인
    //    사람이 실제로 있다(결정 로그 2026-08-13 *"super_admin은 … 어떤 제한 명단·게이트도 자동 통과"*).
    isMaster: systemRole === "master" || isSuperAdmin,
    menuLayout,
    groupLayout,
    isGenericTenant,
    canViewVendors,
  };
  // 자주 방문한 메뉴 — 서버가 계정 기록에서 뽑아 순서대로 내려준다(없으면 기본값).
  const frequent = frequentFor(gate, frequentKeys);
  const allGroups = hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], gate);
  const supportIds = new Set(["support", "owner", ...(groupLayout.some((g) => g.id === "help" && g.order !== undefined) ? [] : ["help"])]);
  const workGroups = allGroups.filter((g) => !supportIds.has(g.id));
  const supportGroups = allGroups.filter((g) => supportIds.has(g.id));
  // 메뉴 검색(원장 2026-10-19) — 목록은 검색 팰릿과 같은 함수. 검색 중엔 업무군 목록 자리에 결과가 선다.
  const searchEntries = useMemo(
    () => hubSearchEntries(gate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gate는 매 렌더 새 객체라 그 재료로 묶는다
    [systemRole, permMatrix, canTeacherView, isSuperAdmin, menuLayout, groupLayout, isGenericTenant, canViewVendors],
  );
  // 칸 숨김 — 누르는 순간 화면을 바꾸고 계정에 저장한다(결과는 기다리지 않는다, 실패해도 이 화면은 그대로).
  const [searchHidden, setSearchHidden] = useState(menuSearchHidden);
  const toggleSearchHidden = (hidden: boolean) => {
    setSearchHidden(hidden);
    void saveMenuSearchHidden(hidden).catch(() => {});
  };
  const showSearchAction = expanded && searchHidden ? <SidebarSearchShowButton onShow={() => toggleSearchHidden(false)} /> : undefined;
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
        // data-usage-chrome — 이용 분석이 사이드바 입력을 **배경 화면의 활동**으로 세지 않는다(메뉴를 여는 손이지
        // 배경을 쓰는 손이 아니다, features/usage/session.ts).
        data-usage-chrome=""
        // data-maximize-hide — '화면 최대화' 중엔 숨는다(globals.css `[data-page-maximize="on"]`, 원장 2026-10-01).
        data-maximize-hide=""
        // data-shell-sidebar — 이전 화면 유지 방식의 화면(iframe)이 이 폭을 재서 왼쪽 안쪽 여백으로 쓴다(keepalive-frame-bridge.tsx).
        data-shell-sidebar=""
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
            href={home}
            aria-label={home === "/dashboard" ? "대시보드로" : "첫 화면으로"}
            onClick={(e) => {
              if (!windows || e.metaKey || e.ctrlKey || e.altKey) return;
              e.preventDefault();
              // 🔴 배경에 깔린 업무군 판을 **먼저 걷는다** — 안 걷으면 '메뉴로'를 눌러도 그 판이 그대로 덮고 있어
              //    아무 일도 안 일어난 것처럼 보인다(허브가 배경 층으로 남을 수 있게 된 뒤의 함정).
              closeHub();
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
            {/* 🔴 학원명과 '관리자뷰'는 **두 줄로 쌓는다**(원장 2026-09-15, 캡처와 함께 *"관리자뷰 저것도 강사뷰처럼
                보이게. 글자가 짤려"*) — 한 줄로 나란히 두던 종전엔 둘이 같은 155px을 나눠 가져 학원명이
                `INJ…`로 잘렸다(로고 28 + 간격 10×2 + '관리자뷰' 60 ⇒ 학원명 자리 47px).
                쌓으면 두 줄이 **각자** 남는 폭을 통째로 쓴다 — 117px(216 − 테두리 1 − 좌우 여백 24 − 접기 버튼 자리 36
                − 로고 28 − 간격 10)이라 `INJAEWON`(20px 굵게 ≈ 100px)이 다 들어간다. 사이드바 폭은 216 고정이라
                (`use-sidebar-resize.ts`) 이 계산이 흔들리지 않는다.
                구조·치수는 강사 미니셸 머리(`(shell)/layout.tsx`)와 **같은 클래스**다 — 둘은 짝이라
                한쪽만 바꾸면 겸직이 뷰를 오갈 때 머리 모양이 달라진다(한쪽을 고치면 저쪽도).
                📏 🔴 **여유가 1px밖에 없다.** 머리는 `h-12`(48)에 `border-b` 1px이라 콘텐츠 47이고, 두 줄 줄상자는
                   `text-lg`(globals.css `--text-lg: 20px`) × 1.25 + 3 + `text-base`(18) = **46**이다. 이 줄은
                   `overflow-hidden`이라 넘치면 **소리 없이 잘린다** — 글자를 한 단계라도 올리려면 `h-12`부터 봐야 한다.
                   ⚠️ Tailwind 기본 스케일(lg=18·base=16)로 세면 41.5가 나오는데 이 앱은 그 값이 아니다
                      (v5 타입 스케일 한 단계 승격). 짝인 `layout.tsx`가 같은 계산을 적어 뒀다.
                ⚠️ 높이를 정하는 건 **자식**의 `leading-tight`/`leading-none`이다 — 부모의 `leading-none`은
                   자식 `text-*`가 제 줄높이를 다시 정하므로 상속되지 않는다(지워도 46 그대로). */}
            <div
              className={`min-w-0 overflow-hidden leading-none ${
                expanded ? "max-w-[130px] opacity-100" : "max-w-0 opacity-0"
              } ${motion ? `transition-[max-width,opacity] duration-200 ${EASE}` : ""}`}
            >
              <div className="text-foreground truncate text-lg leading-tight font-bold tracking-tight">
                {logoText}
              </div>
            {/* 🔴 '관리자뷰' — 지금 보고 있는 것이 **관리자뷰**임을 상단에서 바로 읽히게 한다(원장 2026-09-14:
                *"관리자 라고 추가해줘 큼직하게. 관리자뷰라는걸 한눈에 알 수 있게"* → 같은 날 표기를 **'관리자뷰'**로 확정).
                강사 미니셸 헤더의 '강사뷰'(`(shell)/layout.tsx`)와 **짝이다** — 겸직이 두 뷰를 오갈 때 지금 어느 쪽인지
                헷갈리지 않게 하는 것이 목적이라, 한쪽만 고치면 반쪽이 된다. '뷰'까지 붙인 이유도 같다 — '관리자'만 두면
                역할 이름 '관리자(admin)'로 읽혀 매니저·회계가 "나는 관리자가 아닌데"가 된다.
                ⚠️ 접힘(52px 레일)에선 부모 `<Link>`가 통째로 `opacity-0`이라 로고·워드마크와 함께 사라진다 —
                   레일 폭이 아이콘 하나라 글자가 설 자리가 없다(별도 분기를 만들지 말 것).
                🔴 **한 줄로 되돌리지 말 것**(2026-09-15) — 나란히 두면 이 라벨과 학원명이 같은 폭을 다퉈 학원명이
                   `INJ…`로 잘린다. 둘째 줄이라 폭 상한이 필요 없고, 길면 제 줄에서 말줄임된다.
                ⚠️ 이 사이드바는 상담·회계·셔틀/자리 아르바이트(viewer)에게도 뜬다 — 여기 '관리자뷰'는 **역할 이름이 아니라
                   풀셸이라는 화면 이름**이다(원장 지시 원문이 "관리자뷰라는걸 한눈에"). 폰 풀셸엔 사이드바가 없어
                   이 표시도 없다. */}
              <div className="text-primary mt-[3px] truncate text-base leading-none font-bold">
                관리자뷰
              </div>
            </div>
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
        {searchHidden ? null : (
          <SidebarSearchBox entries={searchEntries} expanded={expanded} onHide={() => toggleSearchHidden(true)} />
        )}

        <div className="relative min-h-0 flex-1">
          <nav
            ref={navRef}
            className="scrollbar-hide flex h-full flex-col gap-1 overflow-x-hidden overflow-y-auto py-2.5"
          >
          {/* 자주 방문한 메뉴 — 연 횟수로 자동 정렬(사람이 고르는 즐겨찾기가 아니다). */}
          {frequent.length > 0 ? (
            <NavSection label="자주 방문한 메뉴" first expanded={expanded} motion={motion} action={showSearchAction}>
              {frequent.map((d) => {
                const item = navItemByKey(d.menuKey);
                return item ? (
                  <MenuRail
                    key={d.href}
                    item={{ ...item, ...d }}
                    isDesktop={windows}
                    expanded={expanded}
                    motion={motion}
                    onShowDesktop={showDesktop}
                    onOpen={closeHub}
                    pathname={pathname}
                    focusedPath={focusedPath}
                    hasFocus={hasFocus}
                    hubOpen={hubOpenId !== null}
                  />
                ) : null;
              })}
            </NavSection>
          ) : null}

          {/* 전체 업무 — 업무군을 누르면 본문에 그 업무의 메뉴 버튼이 뜬다(운영실·캘린더는 바로 열린다). */}
          <NavSection
            label="전체 업무"
            first={frequent.length === 0}
            expanded={expanded}
            motion={motion}
            action={frequent.length === 0 ? showSearchAction : undefined}
          >
            {workGroups.map((g) => (
              <GroupRail
                key={g.id}
                group={g}
                allGroups={allGroups}
                isDesktop={windows}
                expanded={expanded}
                motion={motion}
                onShowDesktop={showDesktop}
                onToggleHub={toggleHub}
                onCloseHub={closeHub}
                hubOpenId={hubOpenId}
                pathname={pathname}
                focusedPath={focusedPath}
                hasFocus={hasFocus}
              />
            ))}
          </NavSection>

          {/* 연결 앱 — aywa 밖의 우리 앱 바로가기(새 탭). 켠 지점에만 선다(원장 2026-09-26). */}
          {connectedApps.length > 0 ? (
            <NavSection label="연결 앱" expanded={expanded} motion={motion}>
              {connectedApps.map((a) => (
                <ConnectedAppRail key={a.feature} app={a} expanded={expanded} motion={motion} />
              ))}
            </NavSection>
          ) : null}

          {/* 지원 — 고객센터·설정(면이 많아 허브)·도움말. */}
          {supportGroups.length > 0 ? (
            <NavSection label="지원" expanded={expanded} motion={motion}>
              {supportGroups.map((g) => (
                <GroupRail
                  key={g.id}
                  group={g}
                allGroups={allGroups}
                  isDesktop={windows}
                  expanded={expanded}
                  motion={motion}
                  onShowDesktop={showDesktop}
                  onToggleHub={toggleHub}
                  onCloseHub={closeHub}
                  hubOpenId={hubOpenId}
                  pathname={pathname}
                  focusedPath={focusedPath}
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
              {windows && !keepalive ? (
                <span className="block">
                  <kbd className="border-line bg-bg-soft text-text-dim rounded border px-1 py-px font-mono text-xs">
                    Shift
                  </kbd>
                  +클릭 = 같은 화면을 새 창으로 하나 더
                </span>
              ) : null}
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

        {/* '강사뷰 전환' 한 줄(원장 2026-09-29) — 맨 위 '나'(겸직·쓰기 가능) + 다른 강사(열람 전용). user 줄 위, nav와 구분선으로 분리. */}
        {canTeacherView || canOtherTeacherView ? (
          <div className="border-line shrink-0 border-t px-1 py-1.5">
            <TeacherViewSwitcher
              expanded={expanded}
              motion={motion}
              selfName={name}
              canSelf={canTeacherView}
              canOthers={canOtherTeacherView}
            />
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
            <div className={expanded ? "ml-auto flex shrink-0 items-center gap-0.5" : "flex shrink-0 flex-col items-center gap-0.5"}>
              {canUseAssistant ? <AssistantNavButton /> : null}
              <NotificationBell />
            </div>
          ) : null}
        </div>

        {/* 메뉴 지도 — 검색칸을 누르면 사이드바 오른쪽에 펼쳐진다(aside 안의 절대 배치라 z-45를 그대로 탄다). */}
        {!searchHidden && expanded ? <SidebarMenuMap entries={searchEntries} /> : null}
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
  action,
  children,
}: {
  label: string;
  first?: boolean;
  expanded: boolean;
  motion: boolean;
  /** 머리 줄 오른쪽 끝의 작은 버튼(숨긴 '메뉴 검색'을 다시 펴는 돋보기) — 새 줄을 만들지 않고 머리 줄에 얹는다. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-1">
      <div
        style={{ height: expanded ? (first ? SECTION_HEAD_H_FIRST : SECTION_HEAD_H) : first ? 6 : 13 }}
        className={`relative flex shrink-0 overflow-hidden ${
          motion ? `transition-[height] duration-200 ${EASE}` : ""
        }`}
      >
        {/* 펼침 묶음 구분선 — 묶음 **위**에 가로선을 긋는다(원장 2026-09-09 *"자주 방문한 메뉴, 전체 업무,
            지원 3개의 카테고리를 좀 강조해야겠어. 구분선을 지어주든가."*). 첫 묶음엔 없다 — 바로 위 브랜드
            줄이 이미 `border-b`를 긋고 있어 선이 두 겹이 된다.
            🔴 색은 `--line`(앱의 구조선 단일 소스) — 사이드바 오른쪽 경계·브랜드 줄과 같은 농도라 따로 논다는
            느낌 없이 얹힌다. hex를 적지 말 것. */}
        {!first ? (
          <span
            aria-hidden="true"
            className={`bg-line absolute top-0 right-3 left-3 h-px ${
              expanded ? "opacity-100" : "opacity-0"
            } ${motion ? "transition-opacity duration-200" : ""}`}
          />
        ) : null}
        {/* 머리글은 **아래로 붙인다**(`bottom-0`) — 자기 메뉴 줄에 가깝고 구분선에서 멀어야 "이 선 아래가
            한 묶음"으로 읽힌다(가운데 정렬이면 선에 더 붙어 위 묶음의 꼬리처럼 보인다).
            🔴 크기는 `text-xs`(14px) 그대로 — 메뉴 이름이 `text-sm`(16px)이라 키우면 위계가 뒤집힌다.
            색도 이미 한계다(09-08부터 `--text-faint`·`--foreground`가 같은 `#121212`) → 강조는 **굵기·자간·
            구분선·여백**으로 낸다. 토큰만 의도에 맞게 `text-foreground`로 바꿔 둔다(3단 회색이 되살아나도
            머리글은 진하게 남는다). */}
        <span
          className={`text-foreground absolute bottom-0 left-[17px] text-xs font-bold tracking-wide whitespace-nowrap ${
            expanded ? "opacity-100" : "opacity-0"
          } ${motion ? "transition-opacity duration-200" : ""}`}
        >
          {label}
        </span>
        {action && expanded ? <span className="absolute right-2 bottom-0">{action}</span> : null}
        {/* 접힘(아이콘 레일) — 라벨이 안 보이니 짧은 가운데 선만으로 묶음을 가른다(기존 그대로). */}
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
    focusedPath,
    hasFocus,
    hubOpen = false,
  }: {
    isDesktop: boolean;
    pathname: string;
    /** 포커스 창이 지금 보여 주는 주소(없으면 null) — 창 id가 아니라 이 주소가 어느 메뉴인지로 판정한다. */
    focusedPath: string | null;
    hasFocus: boolean;
    /**
     * 메뉴 허브가 떠 있나 — 그동안은 배경 라우트(운영실)도, 창 줄도 표시를 양보한다(허브가 캔버스를 불투명하게
     * 덮어 그 화면들은 지금 안 보인다 — 켜 두면 허브의 업무군과 두 곳이 동시에 칠해진다).
     */
    hubOpen?: boolean;
  },
) {
  const presentation = navPresentation(item);
  const active = isDesktop
    ? presentation === "desktop"
      ? !hasFocus && !hubOpen && isItemActive(item.href, pathname)
      : hasFocus && !hubOpen && !!focusedPath && (navItemByKey(item.menuKey)?.href === item.href
        ? findNavItem(focusedPath)?.menuKey === item.menuKey
        // 시안: 권한만 빌린 줄(조직·OKR · 스키마·지식그래프)은 메뉴 키가 같아도 서로 다른 화면 — 주소로 가른다.
        : focusedPath.split("?")[0] === item.href || focusedPath.startsWith(`${item.href}/`))
    : isItemActive(item.href, pathname);
  // 🔴 열려 있는 창은 표시하지 않는다(원장 2026-09-09) — 표시는 **지금 보고 있는 창 하나**뿐이다.
  //    `openIds`는 포커스 판정(hasFocus)에만 남는다.
  return { active };
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
  focusedPath,
  hasFocus,
  hubOpen = false,
}: {
  item: NavItem;
  isDesktop: boolean;
  expanded: boolean;
  motion: boolean;
  onShowDesktop: () => void;
  /** 화면을 열면 떠 있던 메뉴 허브는 **배경으로 내린다**(작업 화면이 앞으로 온다 — 배경은 안 바뀐다). */
  onOpen: () => void;
  pathname: string;
  focusedPath: string | null;
  hasFocus: boolean;
  hubOpen?: boolean;
}) {
  const st = railState(item, { isDesktop, pathname, focusedPath, hasFocus, hubOpen });
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
  allGroups,
  isDesktop,
  expanded,
  motion,
  onShowDesktop,
  onToggleHub,
  onCloseHub,
  hubOpenId,
  pathname,
  focusedPath,
  hasFocus,
}: {
  group: HubGroup;
  allGroups: HubGroup[];
  isDesktop: boolean;
  expanded: boolean;
  motion: boolean;
  onShowDesktop: () => void;
  onToggleHub: (id: string) => void;
  /** 화면을 열었을 때 — 허브를 **배경으로 내린다**(닫지 않는다). */
  onCloseHub: () => void;
  hubOpenId: string | null;
  pathname: string;
  focusedPath: string | null;
  hasFocus: boolean;
}) {
  const search = useSearchParams();
  const currentHref = `${pathname}?${search.toString()}`;
  const base = group.kind === "direct" ? navItemByKey(group.items[0]!.menuKey) : undefined;
  // 시안: 권한만 빌린 줄(예: 대시보드 권한의 '조직·OKR')은 그 메뉴의 '바탕 화면' 표시 방식을 물려받지 않는다 — 물려받으면 눌러도 대시보드만 보인다.
  const borrowed = base && group.items[0]!.href !== base.href;
  const direct = base ? { ...base, ...group.items[0]!, label: group.label, icon: group.icon, ...(borrowed ? { presentation: undefined } : {}) } : undefined;
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
        focusedPath={focusedPath}
        hasFocus={hasFocus}
        hubOpen={hubOpenId !== null}
      />
    );
  }
  // 허브가 떠 있으면 그 허브의 업무군, 아니면 포커스 창이 **지금 보여 주는 주소**가 속한 업무군이 활성.
  // 🔴 허브가 떠 있는 동안엔 창 쪽 표시를 끈다 — 허브가 캔버스를 불투명하게 덮어 그 창은 안 보인다
  //    (켜 두면 두 업무군이 동시에 칠해졌다, 2026-09-11 전수검사). 판정은 `hubGroupOfPath` 한 곳.
  const hubOpen = hubOpenId === group.id;
  // 창 모드가 꺼진 지점(`isDesktop`=창 모드)은 포커스 창이 없다 — 본문 주소가 곧 "지금 보는 곳"이다(폰과 같은 판정).
  const focusedHere = isDesktop
    ? hasFocus && hubOpenId === null && !!focusedPath && hubGroupOfPath(focusedPath, allGroups)?.id === group.id
    : hubOpenId === null && hubGroupOfPath(currentHref, allGroups)?.id === group.id;
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
        className={`relative ${RAIL_LABEL_ML} flex min-w-0 flex-1 items-center gap-1 overflow-hidden pr-2 whitespace-nowrap ${
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
  isDesktop,
  expanded,
  motion,
  onShowDesktop,
}: {
  item: NavItem;
  /** 🔴 **지금 보고 있는 창 하나**만 참이다 — 열려 있는 다른 창은 표시하지 않는다(원장 2026-09-09). */
  active: boolean;
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
    // 창 id는 주소에서(메뉴 판·창 링크와 같은 규칙) — 권한만 빌린 줄이 그 메뉴의 창(예: 대시보드)을 가리키지 않게.
    const params = { id: windowIdForHref(item.href)?.id ?? item.menuKey, title: hubDestinationForPath(item.href)?.label ?? item.label, href: item.href };
    // shift+클릭 = 같은 메뉴를 새 창으로 한 벌 더(듀얼).
    if (e.shiftKey) {
      useWindowStore.getState().openNewInstance("route", params);
      return;
    }
    // 🔴 포커스/리셋 판정은 **메뉴 판과 같은 함수**를 쓴다 — 갈리면 같은 메뉴가 사이드바에서 누를 때와
    //    메뉴 판에서 누를 때 다르게 동작한다(원장 2026-09-10 제보의 원인이 그 갈림이었다).
    openMenuWindow(params);
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
        {item.menuKey === "help" && expanded ? (
          <span className="ml-1 text-xs font-normal opacity-70">F1</span>
        ) : null}
      </span>
    </Link>
  );

  // 펼침 모드: 라벨이 이미 보이므로 Tooltip 생략. 접힘 모드: 우측 Tooltip 라벨.
  if (expanded) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">
        {item.menuKey === "help" ? `${item.label} · F1 = 이 화면 도움말` : item.label}
      </TooltipContent>
    </Tooltip>
  );
}

