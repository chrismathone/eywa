"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { findNavItem } from "@/lib/navigation";
import { useWindowStore } from "./window-store";
import { useIsDesktop } from "./use-is-desktop";
import { useInFrame } from "./use-in-frame";
import { withEmbed } from "./embed-context";

/**
 * href(쿼리/해시 제외)를 창 id로 해석.
 * - 메뉴 루트(href === nav item href): id = menuKey (그 메뉴 창과 공유/토글).
 * - 상세·서브 라우트(/students/123, /staff/45/edit, /consultations/stats): id = 경로 기반 고유
 *   id("students/123" …) → 메뉴 창과 충돌하지 않음(첫 세그먼트 = menuKey라 아이콘도 부모 메뉴를 따름).
 * - 메뉴 영역 밖(외부·다운로드 등): null → 기본 네비게이션.
 */
export function windowIdForHref(href: string): { id: string; navLabel?: string } | null {
  const path = href.split("?")[0].split("#")[0];
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
}) {
  const isDesktop = useIsDesktop();
  const inFrame = useInFrame();
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    // ctrl/cmd/alt+클릭은 브라우저 기본(새 탭 등) 유지. shift는 아래에서 "새 인스턴스(듀얼)"로 전용.
    if (!isDesktop || e.metaKey || e.ctrlKey || e.altKey) return;
    const resolved = windowIdForHref(href);
    if (!resolved) return; // 메뉴 라우트가 아니면 기본 이동
    e.preventDefault();
    // 마우스 클릭(detail>0)이면 커서 위치에서 팝업, 키보드 활성(detail=0, clientX/Y 0)이면 cascade.
    const anchor = e.detail > 0 ? { x: e.clientX, y: e.clientY } : undefined;
    const params = { id: resolved.id, title: title ?? resolved.navLabel ?? "보기", href };
    const store = useWindowStore.getState();
    // shift+클릭 = 같은 화면을 새 창으로 한 벌 더(듀얼), 일반 클릭 = 기존 창 포커스/열기.
    if (e.shiftKey) store.openNewInstance("route", params, anchor);
    else store.open("route", params, anchor);
  }
  // 임베드 iframe 내부에선 onClick이 창을 안 열고 일반 네비게이션으로 떨어진다(isDesktop=false).
  // 그 드릴인이 embed=1을 잃으면 하위 페이지가 풀 셸로 떠 사이드바가 이중 노출되므로, iframe 안의
  // 링크 href엔 embed=1을 유지한다(크롬리스 embed 분기로 self-heal). 최상위/모바일은 원본 href.
  const linkHref = inFrame ? withEmbed(href) : href;
  return (
    <Link
      href={linkHref}
      className={className}
      aria-label={ariaLabel}
      onClick={onClick}
      // 네이티브 anchor 드래그(URL 고스트) 차단 — 시간표 편집에서 학생 행을 끌 때 링크 URL이
      // 딸려오던 것 방지. nav 링크는 클릭 전용이라 HTML5 drag가 필요 없다.
      draggable={false}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
    >
      {children}
    </Link>
  );
}
