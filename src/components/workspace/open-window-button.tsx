"use client";

import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useWindowStore } from "./window-store";
import { useIsDesktop } from "./use-is-desktop";
import { useInFrame } from "./use-in-frame";
import { useWorkspaceEnabled } from "./workspace-enabled";
import { windowIdForHref } from "./window-link";
import { pageFormHref } from "@/lib/recording-resume";

/**
 * "새 X" 생성 폼을 우측 슬라이드 패널 대신 **플로팅 창**으로 여는 onClick 핸들러 훅.
 * 최상위 데스크톱: /X/new 라우트를 autoClose 창으로 연다(제출 성공 → 폼이 /X/new를 벗어나면
 * RouteWindow가 창을 닫고 배경을 새로고침 = 옛 패널의 "닫고 목록 갱신"과 동일 UX).
 * 임베드 iframe(목록이 이미 플로팅 창) 내부: iframe엔 워크스페이스 캔버스가 없어 직접 open()이 안 뜨므로
 *   **부모 workspace-canvas에 postMessage**해 새 autoClose 창을 열게 한다(WindowLink shift+클릭과 동일 브리지).
 *   이게 없으면 iframe이 isDesktop=false로 떨어져 그 창 안에서 드릴인만 되고 새 창이 안 떴다(#55/#64).
 * 모바일/태블릿(창 시스템 없음): 그냥 /X/new로 풀페이지 네비게이션.
 * 녹음 중인 작성 화면이 있으면 새 작성 화면을 연다 — 창이면 새 창(`openForm`), 창이 없으면 `form=<id>`(pageFormHref).
 *
 * 각 트리거는 기존 버튼 마크업(스타일)을 그대로 두고 onClick만 이 핸들러로 교체한다.
 */
export function useOpenFormWindow() {
  const isDesktop = useIsDesktop();
  const inFrame = useInFrame();
  const workspaceEnabled = useWorkspaceEnabled();
  const router = useRouter();

  return function openFormWindow(href: string, title: string, e?: MouseEvent<HTMLElement>) {
    const resolved = windowIdForHref(href);
    const id = resolved?.id ?? href.replace(/^\//, "");
    // 임베드 iframe 내부: 부모 워크스페이스에 새 창(autoClose)을 열도록 postMessage(우리 창만 수용됨).
    if (inFrame) {
      window.parent.postMessage(
        { type: "eywa-open-window", id, title: title ?? resolved?.navLabel, href, autoClose: true },
        window.location.origin,
      );
      return;
    }
    // 모바일/태블릿(창 시스템 없음) 또는 캔버스 없는 미니멀 셸(강사·학생): 풀페이지 네비게이션.
    if (!isDesktop || !workspaceEnabled) {
      router.push(pageFormHref(href));
      return;
    }
    // 최상위 데스크톱: 마우스 클릭(detail>0)이면 커서 위치에서 팝업, 키보드 활성이면 cascade.
    const anchor = e && e.detail > 0 ? { x: e.clientX, y: e.clientY } : undefined;
    useWindowStore.getState().openForm("route", { id, title, href, autoClose: true }, anchor);
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
