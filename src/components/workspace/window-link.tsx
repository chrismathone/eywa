"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { findNavItem } from "@/lib/navigation";
import { useWindowStore } from "./window-store";
import { useIsDesktop } from "./use-is-desktop";

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
}: {
  href: string;
  title?: string;
  className?: string;
  children?: ReactNode;
  ariaLabel?: string;
}) {
  const isDesktop = useIsDesktop();
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!isDesktop || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const resolved = windowIdForHref(href);
    if (!resolved) return; // 메뉴 라우트가 아니면 기본 이동
    e.preventDefault();
    useWindowStore
      .getState()
      .open("route", { id: resolved.id, title: title ?? resolved.navLabel ?? "보기", href });
  }
  return (
    <Link href={href} className={className} aria-label={ariaLabel} onClick={onClick}>
      {children}
    </Link>
  );
}
