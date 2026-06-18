"use client";

import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useWindowStore } from "./window-store";
import { useIsDesktop } from "./use-is-desktop";
import { windowIdForHref } from "./window-link";

/**
 * "새 X" 생성 폼을 우측 슬라이드 패널 대신 **플로팅 창**으로 여는 onClick 핸들러 훅.
 * 데스크톱: /X/new 라우트를 autoClose 창으로 연다(제출 성공 → 폼이 /X/new를 벗어나면
 * RouteWindow가 창을 닫고 배경을 새로고침 = 옛 패널의 "닫고 목록 갱신"과 동일 UX).
 * 모바일/태블릿(창 시스템 없음): 그냥 /X/new로 풀페이지 네비게이션.
 *
 * 각 트리거는 기존 버튼 마크업(스타일)을 그대로 두고 onClick만 이 핸들러로 교체한다.
 */
export function useOpenFormWindow() {
  const isDesktop = useIsDesktop();
  const router = useRouter();

  return function openFormWindow(href: string, title: string, e?: MouseEvent<HTMLElement>) {
    if (!isDesktop) {
      router.push(href);
      return;
    }
    const resolved = windowIdForHref(href);
    const id = resolved?.id ?? href.replace(/^\//, "");
    // 마우스 클릭(detail>0)이면 커서 위치에서 팝업, 키보드 활성이면 cascade.
    const anchor = e && e.detail > 0 ? { x: e.clientX, y: e.clientY } : undefined;
    useWindowStore.getState().open("route", { id, title, href, autoClose: true }, anchor);
  };
}

/** ui/Button 기반 트리거용 간편 래퍼(커스텀 버튼은 useOpenFormWindow를 직접 쓴다). */
export function OpenWindowButton({
  href,
  title,
  className,
  children,
}: {
  href: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const open = useOpenFormWindow();
  return (
    <Button className={className} onClick={(e) => open(href, title, e)}>
      {children}
    </Button>
  );
}
