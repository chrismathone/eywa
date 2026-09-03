"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { findNavItem } from "@/lib/navigation";
import { useWindowStore } from "./window-store";
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
const EXTRA_WINDOW_ROUTES: Record<string, string> = { "/me": "내 정보" };

/**
 * href(쿼리/해시 제외)를 창 id로 해석.
 * - 메뉴 루트(href === nav item href): id = menuKey (그 메뉴 창과 공유/토글).
 * - 상세·서브 라우트(/students/123, /staff/45/edit, /consultations/stats): id = 경로 기반 고유
 *   id("students/123" …) → 메뉴 창과 충돌하지 않음(첫 세그먼트 = menuKey라 아이콘도 부모 메뉴를 따름).
 * - 메뉴 영역 밖(외부·다운로드 등): null → 기본 네비게이션.
 */
export function windowIdForHref(href: string): { id: string; navLabel?: string } | null {
  const path = href.split("?")[0].split("#")[0];
  const extra = EXTRA_WINDOW_ROUTES[path];
  if (extra) return { id: path.replace(/^\//, ""), navLabel: extra };
  const item = findNavItem(path);
  if (!item) return null;
  if (item.href === path) return { id: item.menuKey, navLabel: item.label };
  return { id: path.replace(/^\//, ""), navLabel: item.label };
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
}) {
  const isDesktop = useIsDesktop();
  const inFrame = useInFrame();
  const workspaceEnabled = useWorkspaceEnabled();
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    // ctrl/cmd/alt+클릭은 브라우저 기본(새 탭 등) 유지.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    onNavigate?.(); // 이동이 확정된 뒤에만 — 새 탭으로 빠지는 경우엔 부르지 않는다.
    const resolved = windowIdForHref(href);
    if (!resolved) return; // 메뉴 라우트가 아니면 기본 이동
    // 창(iframe) 안에서 shift+클릭 = 드릴인 대신 **부모 워크스페이스에 새 플로팅 창**으로 연다.
    // iframe은 별도 문서라 window-store에 직접 접근 못 함 → 부모(workspace-canvas)에 postMessage하면
    // 그 리스너가 open("route")을 대신 호출한다(EmbedFocusSignal 브리지와 동일 방식).
    if (inFrame && e.shiftKey) {
      e.preventDefault();
      window.parent.postMessage(
        { type: "eywa-open-window", id: resolved.id, title: title ?? resolved.navLabel, href },
        window.location.origin,
      );
      return;
    }
    // 임베드 iframe 내부(일반 클릭=자연스러운 드릴인) 또는 모바일 = 기본 Link 이동으로 떨어짐.
    if (!isDesktop) return;
    // 워크스페이스 캔버스 없는 셸(강사·학생 미니멀 셸) = 창을 못 여니 기본 Link 이동(드릴인)으로.
    if (!workspaceEnabled) return;
    e.preventDefault();
    // 마우스 클릭(detail>0)이면 커서 위치에서 팝업, 키보드 활성(detail=0, clientX/Y 0)이면 cascade.
    const anchor = e.detail > 0 ? { x: e.clientX, y: e.clientY } : undefined;
    const params = { id: resolved.id, title: title ?? resolved.navLabel ?? "보기", href };
    const store = useWindowStore.getState();
    // 최상위 프레임: shift+클릭 = 같은 화면을 새 창으로 한 벌 더(듀얼), 일반 클릭 = 기존 창 포커스/열기.
    if (e.shiftKey) store.openNewInstance("route", params, anchor);
    else store.open("route", params, anchor);
  }
  // 임베드 iframe 내부에선 onClick이 창을 안 열고 일반 네비게이션으로 떨어진다(isDesktop=false).
  // 그 드릴인이 embed=1을 잃으면 하위 페이지가 풀 셸로 떠 사이드바가 이중 노출되므로, iframe 안의
  // 링크 href엔 embed=1을 유지한다(크롬리스 embed 분기로 self-heal). 최상위/모바일은 원본 href.
  const linkHref = inFrame ? withEmbed(href) : href;
  // BL4 — 데스크톱 최상위(창 열기)면 embed document, 그 외(모바일·iframe 드릴인)는 실제 이동 URL 프리워밍.
  const prefetchEmbed = isDesktop && workspaceEnabled && !inFrame;

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
