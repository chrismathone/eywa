"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { useWindowStore } from "@/components/workspace/window-store";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { useWorkspaceEnabled } from "@/components/workspace/workspace-enabled";
import { withEmbed } from "@/components/workspace/embed-context";
import { windowIdForHref } from "@/components/workspace/window-link";

/**
 * 직원목록 행 전체 클릭 → 직원 상세 창(원장 지시 2026-07-28 — "그 줄 전체 링크").
 * `<tr>`은 anchor로 감쌀 수 없어 onClick으로 WindowLink와 같은 열기 경로를 탄다.
 * - 행 안의 실제 링크/버튼(이름 링크·수정중 배지 등) 클릭은 그 요소가 처리(중첩 액션 존중).
 * - 데스크톱 워크스페이스 = 플로팅 창, 그 외(모바일·iframe 드릴인·미니셸) = 일반 네비게이션.
 * - 키보드 접근은 행 안 이름 링크(WindowLink, 같은 href)가 담당 — 행 자체는 포커스 대상 아님.
 */
export function StaffRowLink({
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
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const inFrame = useInFrame();
  const workspaceEnabled = useWorkspaceEnabled();

  function onClick(e: MouseEvent<HTMLTableRowElement>) {
    if ((e.target as HTMLElement).closest("a, button, input, label")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const resolved = windowIdForHref(href);
    if (!resolved || !isDesktop || !workspaceEnabled) {
      router.push(inFrame ? withEmbed(href) : href);
      return;
    }
    const anchor = e.detail > 0 ? { x: e.clientX, y: e.clientY } : undefined;
    useWindowStore.getState().open("route", { id: resolved.id, title, href }, anchor);
  }

  return (
    <tr onClick={onClick} className={className}>
      {children}
    </tr>
  );
}
