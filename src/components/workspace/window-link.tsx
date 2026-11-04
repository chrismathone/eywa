"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { findNavItem, navPresentation, SUBTABS_BY_MENU } from "@/lib/navigation";
import { MENU_LABEL, type MenuKey } from "@/lib/permissions";
import { useWindowStore } from "./window-store";
import { openLinkWindow } from "./open-menu-window";
import { useMenuHub } from "./menu-hub-store";
import { useIsDesktop } from "./use-is-desktop";
import { useInFrame } from "./use-in-frame";
import { useWorkspaceEnabled } from "./workspace-enabled";
import { withEmbed } from "./embed-context";
import { cancelScheduledPrefetch, scheduleEmbedPrefetch } from "./prefetch-embed";

/**
 * 12메뉴(NAV_GROUPS) 밖이지만 **창으로 열어야 하는** 라우트.
 * 메뉴에 넣으면 사이드바·팰릿 목록까지 오염되지만, 창으로 안 열면 최상위 프레임이 이동해
 * **배경이 창에 가려 아무 일도 안 일어난 것처럼 보인다**([[#86]] — 원장 제보 2026-07-29:
 * "요청만 하고 받질 못함" = /me가 200인데 화면은 '열린 창이 없어요' 그대로).
 */
const EXTRA_WINDOW_ROUTES: Record<string, string> = {
  "/me": "내 정보",
  // 출석 키오스크 설정(원장 전용) — 사이드바에 없고 **도움말 링크가 유일한 입구**다. 창으로 못 열면 그 링크가
  // 도움말 창을 통째로 키오스크 설정으로 바꾼다(2026-09-11 전수검사). id는 딥링크가 쓰던 경로 id 그대로.
  "/kiosk-settings": MENU_LABEL.kiosk_settings,
};

const routePath = (href: string): string => href.split("?")[0].split("#")[0];

/**
 * 하부탭(`SUBTABS_BY_MENU`) 면의 창 — 메뉴 판·검색 팰릿이 여는 **그 창**과 글자까지 같은 id.
 * - 경로로 갈리는 면(`/attendance/live`·`/attendance/quick`·`/shuttle/today` …) = **부모 메뉴 창**.
 *   화면 안 면 탭이 이미 부모 창 안에서 바꿔 보여 주는 설계라 그쪽에 맞춘다(원장 결정 2026-09-11) — 입구마다
 *   창 id가 갈리면 같은 화면이 두 벌 뜨고, 이미 떠 있는 창을 서로 못 알아본다.
 * - `menuKey`를 단 독립 메뉴(`/mcs`) = 그 메뉴 창 — NAV_GROUPS에 없어 `findNavItem`으론 못 찾는다.
 * 쿼리로 가르는 면(`/billing?tab=…`·`/owner?tab=…`)은 경로가 메뉴 루트와 같아 루트 판정이 먼저 잡는다(부모 창 그대로).
 */
function subTabWindow(path: string): { id: string; navLabel: string } | null {
  for (const [parent, tabs] of Object.entries(SUBTABS_BY_MENU)) {
    for (const t of tabs ?? []) {
      if (routePath(t.href) !== path) continue;
      return t.menuKey ? { id: t.menuKey, navLabel: MENU_LABEL[t.menuKey] } : { id: parent, navLabel: t.label };
    }
  }
  return null;
}

/** 독립 메뉴 하부탭(`/mcs`)의 하위 경로(`/mcs/<반>/…`)가 속한 메뉴 — 메뉴 루트의 상세와 같은 규약(경로 id)으로 연다. */
function subTabMenuUnder(path: string): MenuKey | null {
  for (const tabs of Object.values(SUBTABS_BY_MENU)) {
    for (const t of tabs ?? []) {
      if (t.menuKey && path.startsWith(`${routePath(t.href)}/`)) return t.menuKey;
    }
  }
  return null;
}

/**
 * href(쿼리/해시 제외)를 창 id로 해석 — **창 id 규칙의 단일 소스**. 메뉴 판·검색 팰릿·창 링크·알림 벨·딥링크가
 * 전부 이 함수를 지난다(갈리면 같은 화면이 입구마다 다른 창이 된다 — 가드 `window-identity.test.tsx`).
 * - 메뉴 루트(href === nav item href): id = menuKey (그 메뉴 창과 공유/토글).
 * - 하부탭 면: 경로로 갈리는 면 = **부모 메뉴 창 id**, 독립 메뉴(`/mcs`) = 그 menuKey(`subTabWindow`).
 * - 상세·서브 라우트(/students/123, /staff/45/edit, /consultations/stats): id = 경로 기반 고유
 *   id("students/123" …) → 메뉴 창과 충돌하지 않음(첫 세그먼트 = menuKey라 아이콘도 부모 메뉴를 따름).
 * - 메뉴 영역 밖(외부·다운로드 등): null → 기본 네비게이션.
 * - 🔴 `presentation:"desktop"`(운영실 `/dashboard`)도 null — main 자체가 작업면이라 **창이 아니다**. 창으로 열면 배경과
 *   창에 같은 화면이 겹치고 스토어가 그 창을 레거시로 보고 지운다(`isLegacyDashboardWindow`, deep-link-window와 같은 규약).
 *   게다가 `withEmbed`는 `?`로만 쪼개서 `/dashboard#daily-briefing`이 `…#daily-briefing?embed=1`이 되어 창 안에 풀 셸이 떴다
 *   (알림 "브리핑 준비됐습니다"의 착지 링크 — 적대적 리뷰 2026-09-03). 호출부(WindowLink·알림 벨)는 null이면 기본 이동으로 떨어진다.
 */
export function windowIdForHref(href: string): { id: string; navLabel?: string } | null {
  const path = routePath(href);
  const extra = EXTRA_WINDOW_ROUTES[path];
  if (extra) return { id: path.replace(/^\//, ""), navLabel: extra };
  // 도움말 하위(`/help/posts/…` · `/help/icons` · 옛 `/help/<slug>` 북마크)는 **도움말 창 하나**.
  if (path === "/help" || path.startsWith("/help/")) {
    return { id: "help", navLabel: MENU_LABEL.help };
  }
  const item = findNavItem(path);
  if (item && item.href === path) {
    if (navPresentation(item) === "desktop") return null;
    return { id: item.menuKey, navLabel: item.label };
  }
  const face = subTabWindow(path);
  if (face) return face;
  if (item) return { id: path.replace(/^\//, ""), navLabel: item.label };
  const menu = subTabMenuUnder(path);
  return menu ? { id: path.replace(/^\//, ""), navLabel: MENU_LABEL[menu] } : null;
}

/**
 * 메뉴/상세 라우트 링크 — 데스크톱 **최상위 프레임**에선 클릭 시 메인 프레임 전체 이동 대신 **플로팅
 * 창**으로 연다(윈도우 시스템 일관 + 배경 유지). 레일/팰릿의 open("route", …)과 동일 경로.
 * 폴백(기본 Link 이동):
 *  - 모바일·모디파이어 클릭(새 탭 등)
 *  - 임베드 iframe **내부**(useIsDesktop=false) → 그 창 안에서 이동 = 자연스러운 드릴인
 *  - 메뉴 영역 밖 href(외부·/api 등)
 * 상세 링크엔 title(엔티티명)을 넘겨 창 제목으로 쓴다(없으면 메뉴 라벨).
 */
export function WindowLink({
  href,
  title,
  className,
  children,
  ariaLabel,
  onMouseEnter,
  onMouseLeave,
  onMouseMove,
  onNavigate,
  openOn = "click",
  frameTarget = "self",
}: {
  href: string;
  title?: string;
  className?: string;
  children?: ReactNode;
  ariaLabel?: string;
  // hover 정보 툴팁 등에서 트리거에 핸들러를 주입할 수 있게 forward(시간표 hover). 선택.
  onMouseEnter?: (e: MouseEvent<HTMLAnchorElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLAnchorElement>) => void;
  onMouseMove?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /**
   * 클릭이 실제로 이동/창열기로 이어질 때 함께 할 일(예: 공지 팝업 닫기).
   * 모디파이어 클릭(새 탭)에선 호출하지 않는다 — 화면은 그대로 있어야 한다.
   */
  onNavigate?: () => void;
  /**
   * 무엇으로 여는가 — 기본은 클릭. `doubleClick`은 **한 번 클릭으로는 아무 일도 안 일어나고** 더블클릭에만 연다
   * (원장 2026-09-04, 시간표: 셀을 끌려다 클릭이 되어 창이 열리는 것을 막는다). 모디파이어 클릭(새 탭)은 두 모드 다
   * 브라우저 기본을 지킨다. 🔴 더블클릭 모드에선 창을 못 여는 경로(모바일·iframe 안·워크스페이스 없음)에서
   * **직접 이동**한다 — 단일 클릭을 삼켰으니 기본 네비게이션이 남아 있지 않다.
   */
  openOn?: "click" | "doubleClick";
  /**
   * 창(iframe) 안에서 눌렀을 때 어디로 여는가. 기본 `self` = 그 창 안에서 이동(드릴인 — 목록 → 상세).
   * `window` = **부모 작업면에 그 화면의 창**을 연다(창 안 shift+클릭과 같은 `eywa-open-window` 신호) —
   * 다른 메뉴로 가는 문(도움말의 메뉴 안내 등)이 쓴다. 드릴인이면 보던 창이 통째로 그 화면으로 바뀐다
   * (2026-09-11 전수검사: 도움말 창이 학원 설정으로 바뀌었다).
   * ⚠️ 창이 될 수 없는 주소(운영실 = 배경 · 메뉴 밖)는 여기서도 드릴인으로 떨어진다 — 그런 주소는 호출부가 가린다.
   */
  frameTarget?: "self" | "window";
}) {
  const isDesktop = useIsDesktop();
  const inFrame = useInFrame();
  const workspaceEnabled = useWorkspaceEnabled();
  /** 실제로 열기. 창으로 열었으면 true, 기본 네비게이션에 맡겨야 하면 false. */
  function activate(e: MouseEvent<HTMLAnchorElement>): boolean {
    // ctrl/cmd/alt+클릭은 브라우저 기본(새 탭 등) 유지.
    if (e.metaKey || e.ctrlKey || e.altKey) return true;
    onNavigate?.(); // 이동이 확정된 뒤에만 — 새 탭으로 빠지는 경우엔 부르지 않는다.
    const resolved = windowIdForHref(href);
    if (!resolved && href.split(/[?#]/)[0] === "/dashboard" && isDesktop && workspaceEnabled && !inFrame) {
      useMenuHub.getState().close();
      useWindowStore.getState().showDesktop();
    }
    if (!resolved) return false; // 메뉴 라우트가 아니면 기본 이동
    // 창(iframe) 안에서 shift+클릭(또는 `frameTarget="window"`) = 드릴인 대신 **부모 워크스페이스에 플로팅 창**으로 연다.
    // iframe은 별도 문서라 window-store에 직접 접근 못 함 → 부모(workspace-canvas)에 postMessage하면
    // 그 리스너가 open("route")을 대신 호출한다(EmbedFocusSignal 브리지와 동일 방식).
    if (inFrame && (e.shiftKey || frameTarget === "window")) {
      e.preventDefault();
      window.parent.postMessage(
        {
          type: "eywa-open-window",
          id: resolved.id,
          title: title ?? resolved.navLabel,
          href,
          // Shift+클릭 = 최상위와 같은 뜻(같은 화면을 새 창으로 한 벌 더) — 받는 쪽(workspace-canvas)이 openNewInstance로 연다.
          newInstance: e.shiftKey,
        },
        window.location.origin,
      );
      return true;
    }
    // 임베드 iframe 내부(일반 클릭=자연스러운 드릴인) 또는 모바일 = 기본 Link 이동으로 떨어짐.
    if (!isDesktop) return false;
    // 워크스페이스 캔버스 없는 셸(강사·학생 미니멀 셸) = 창을 못 여니 기본 Link 이동(드릴인)으로.
    if (!workspaceEnabled) return false;
    e.preventDefault();
    // 마우스 클릭(detail>0)이면 커서 위치에서 팝업, 키보드 활성(detail=0, clientX/Y 0)이면 cascade.
    const anchor = e.detail > 0 ? { x: e.clientX, y: e.clientY } : undefined;
    const params = { id: resolved.id, title: title ?? resolved.navLabel ?? "보기", href };
    // 최상위 프레임: shift+클릭 = 같은 화면을 새 창으로 한 벌 더(듀얼), 일반 클릭 = 그 주소로 연다(창이 다른 곳에 가 있어도).
    if (e.shiftKey) useWindowStore.getState().openNewInstance("route", params, anchor);
    else openLinkWindow(params, anchor);
    return true;
  }
  const dblMode = openOn === "doubleClick";
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!dblMode) {
      activate(e);
      return;
    }
    // 더블클릭 모드 — 모디파이어(새 탭)만 기본을 지키고, 맨 클릭은 아무 일도 하지 않는다.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // 🔴 **키보드 활성(Enter)은 한 번에 연다** — 키보드엔 더블클릭이 없다(`dblclick`은 포인터 전용).
    //    detail===0이 곧 "마우스가 아니다"라는 신호다(마우스 클릭은 1 이상). 이걸 빼면 링크가 보조기기에서 죽는다.
    if (e.detail === 0) {
      activate(e);
      return;
    }
    e.preventDefault();
  }
  function onDoubleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!dblMode) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (activate(e)) return;
    // 창을 못 여는 경로(모바일·iframe 드릴인·워크스페이스 없음) — 단일 클릭을 삼켰으니 여기서 직접 이동한다.
    // 🔴 `useRouter()`를 쓰지 않는다 — 이 부품은 라우터 없는 트리(테스트·격리 렌더)에서도 그려지는데
    //    훅은 조건부로 못 부르고 없으면 **throw**한다(실측: 무관한 화면 테스트 3벌이 통째로 깨졌다).
    //    앱 관례대로 `window.location.assign`([[#102]] 뷰 전환과 같은 경로).
    e.preventDefault();
    window.location.assign(linkHref);
  }
  // 임베드 iframe 내부에선 onClick이 창을 안 열고 일반 네비게이션으로 떨어진다(isDesktop=false).
  // 그 드릴인이 embed=1을 잃으면 하위 페이지가 풀 셸로 떠 사이드바가 이중 노출되므로, iframe 안의
  // 링크 href엔 embed=1을 유지한다(크롬리스 embed 분기로 self-heal). 최상위/모바일은 원본 href.
  // ⚠️ `frameTarget="window"`로 창을 여는 링크는 창 안에서도 기본 이동이 없다 — 남는 건 Ctrl+클릭(새 탭 = 최상위
  //    문서)뿐이라 원래 주소를 싣는다(embed가 붙으면 새 탭에 셸 없는 반쪽 화면이 뜬다).
  const opensWindowFromFrame = frameTarget === "window" && windowIdForHref(href) !== null;
  const linkHref = inFrame && !opensWindowFromFrame ? withEmbed(href) : href;
  // BL4 — 예열은 **실제로 쓰일 문서**로 한다. 창 안에서는 창 열기 신호든 드릴인이든(위 `linkHref`가 withEmbed)
  // 전부 embed 문서로 끝나고, 데스크톱 최상위는 창(embed 문서)을 연다. 모바일·작업면 없음만 원래 주소.
  // 창 안에서 전체 셸 문서를 예열하면 아무도 안 쓰는 문서에 셸 렌더를 치른다(2026-09-11 리뷰 · 2026-09-12 재리뷰).
  const prefetchEmbed = inFrame || (isDesktop && workspaceEnabled);

  return (
    <Link
      href={linkHref}
      // 🔴 뷰포트 프리페치를 끈다(Next 16 App Router 기본값 `auto`는 링크가 화면에 들어오면 프리페치).
      //    시간표·명단 격자는 상세 링크를 수백 개 그려서, 창을 여는 순간 그 수만큼 RSC 요청이 한꺼번에
      //    나가고 각 요청이 셸 레이아웃(인증·설정·권한)을 처음부터 다시 돌린다 — 정작 사람은 하나를 누른다.
      //    데스크톱 최상위에선 클릭이 **iframe 창**을 여는데 부모 라우터 캐시는 iframe과 공유되지 않아
      //    그 프리페치는 애초에 **효과 0**이다(prefetch-embed.ts 실측 주석).
      // ⚠️ 자주 여는 메뉴 루트의 예열은 그대로다 — 아래 onMouseEnter의 document 프리워밍(BL4)이 맡는다.
      //    상세 링크는 예열을 잃지만, 대부분의 상세 라우트엔 loading.tsx가 있어 클릭 즉시 뼈대가 뜬다.
      prefetch={false}
      className={className}
      aria-label={ariaLabel}
      onClick={onClick}
      onDoubleClick={dblMode ? onDoubleClick : undefined}
      // 네이티브 anchor 드래그(URL 고스트) 차단 — 시간표 편집에서 학생 행을 끌 때 링크 URL이
      // 딸려오던 것 방지. nav 링크는 클릭 전용이라 HTML5 drag가 필요 없다.
      draggable={false}
      onMouseEnter={(e) => {
        scheduleEmbedPrefetch(href, { embed: prefetchEmbed });
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        cancelScheduledPrefetch();
        onMouseLeave?.(e);
      }}
      onMouseMove={onMouseMove}
    >
      {children}
    </Link>
  );
}
