"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { findNavItem } from "@/lib/navigation";
import { useWindowStore } from "./window-store";
import { useIsDesktop } from "./use-is-desktop";

/**
 * 메뉴 라우트 링크. 데스크톱(최상위 프레임)에선 클릭 시 메인 프레임 전체 이동 대신 **플로팅 창**으로
 * 연다 — 윈도우 시스템과 일관 + 대시보드가 그대로 떠 있어 체감이 빠르다(이미 열린 창이면 즉시 포커스).
 * 모바일·모디파이어 클릭(새 탭 등)·임베드 iframe 내부·메뉴가 아닌 href는 기본 Link 네비게이션으로 폴백.
 * (레일/팰릿의 open("route", …)과 동일 동작을 대시보드 등 본문 링크에서 재사용.)
 */
export function WindowLink({
  href,
  className,
  title,
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!isDesktop || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const item = findNavItem(href);
    if (!item) return; // 메뉴 라우트가 아니면 기본 이동
    e.preventDefault();
    useWindowStore.getState().open("route", { id: item.menuKey, title: item.label, href });
  }
  return (
    <Link href={href} className={className} title={title} onClick={onClick}>
      {children}
    </Link>
  );
}
