"use client";

import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useWindowStore } from "./window-store";
import { useIsDesktop } from "./use-is-desktop";
import { useWorkspaceEnabled } from "./workspace-enabled";

/**
 * 인쇄 문서(인수인계서·회의록·교재요청서 등)를 **플로팅 창**으로 여는 핸들러 훅.
 * useOpenFormWindow와 같은 패턴이되 (1) autoClose 없음(인쇄 창은 사용자가 닫을 때까지 유지)
 * (2) **명시 id `print/<type>/<recordId>`** — windowIdForHref가 만드는 `enrollment/123/print`는
 *     ROUTE_WINDOW_SIZE longest-prefix가 못 잡아 DEFAULT(480×560, A4 아님)로 떨어지므로, `print/<type>`
 *     prefix로 매칭되게 직접 id를 준다(window-geometry.ts ROUTE_WINDOW_SIZE에 `print/<type>` A4 등록).
 * 데스크톱=플로팅 창 / 모바일·태블릿(창 시스템 없음)=풀페이지 네비. (target="_blank" 새 탭 미사용.)
 */
export function usePrintWindow() {
  const isDesktop = useIsDesktop();
  const workspaceEnabled = useWorkspaceEnabled();
  const router = useRouter();

  return function openPrint(
    opts: { id: string; href: string; title: string },
    e?: MouseEvent<HTMLElement>,
  ) {
    // 창 시스템이 없는 셸(모바일·태블릿 + 강사/학생 미니멀 셸=WorkspaceCanvas 미마운트)에서는
    // 플로팅 창을 열어도 렌더할 캔버스가 없어 무반응 → 전체 페이지로 이동(WindowLink 드릴인과 동일).
    if (!isDesktop || !workspaceEnabled) {
      router.push(opts.href);
      return;
    }
    // 마우스 클릭(detail>0)이면 커서 위치 팝업, 키보드 활성이면 cascade.
    const anchor = e && e.detail > 0 ? { x: e.clientX, y: e.clientY } : undefined;
    useWindowStore
      .getState()
      .open("route", { id: opts.id, title: opts.title, href: opts.href }, anchor);
  };
}

/** ui/Button 기반 인쇄 트리거 sugar(아이콘 등 커스텀 트리거는 usePrintWindow를 직접 쓴다). */
export function PrintWindowButton({
  id,
  href,
  title,
  variant = "outline",
  className,
  children,
}: {
  id: string;
  href: string;
  title: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  className?: string;
  children: ReactNode;
}) {
  const openPrint = usePrintWindow();
  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={(e) => openPrint({ id, href, title }, e)}
    >
      {children}
    </Button>
  );
}
