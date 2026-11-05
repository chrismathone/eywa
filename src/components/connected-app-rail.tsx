"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EyIcon, MENU_ICON } from "@/components/icons/aywa-icons";
import type { ConnectedApp } from "@/features/connected-apps/apps";

const EASE = "ease-[cubic-bezier(0.22,0.61,0.36,1)]";

/**
 * 사이드바 '연결 앱' 줄 — aywa 밖의 앱으로 가는 **보통 링크**(새 탭). 원장 2026-09-26 *"그냥 하이퍼링크처럼 바로가기"*.
 *
 * 🔴 메뉴 줄(`RailItem`)과 모양·치수는 같지만 **창·허브·방문 기록을 타지 않는다** — 창(iframe)에 넣으면 그 앱의
 *    로그인이 안 되고([`apps.ts`](@/features/connected-apps/apps.ts)), 방문 기록은 aywa 메뉴 키 축이다.
 * 끝의 바깥 화살표가 "aywa 밖으로 나간다"를 말한다.
 */
export function ConnectedAppRail({
  app,
  expanded,
  motion,
}: {
  app: ConnectedApp;
  expanded: boolean;
  motion: boolean;
}) {
  const link = (
    <a
      href={app.launchPath}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${app.label} (새 탭)`}
      className="group focus-visible:ring-primary/55 relative flex h-9 w-full items-center gap-2.5 pl-[17px] focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        style={{ left: expanded ? 4 : 8, right: expanded ? 4 : 8 }}
        className={`bg-sidebar-accent pointer-events-none absolute inset-y-0 z-0 rounded-[9px] opacity-0 group-hover:opacity-100 ${
          motion ? `transition-[left,right,opacity] duration-200 ${EASE}` : ""
        }`}
      />
      {/* 아이콘 원본 = 앱 권한 키의 MENU_ICON 한 곳(2026-11-05) — 새 연결 앱마다 제 그림을 갖는다(폰·강사 메뉴도 같다). */}
      <EyIcon
        name={MENU_ICON[app.permission]}
        size={18}
        strokeWidth={1.8}
        className="text-text-dim group-hover:text-foreground relative z-10 shrink-0"
      />
      <span
        className={`text-text-dim group-hover:text-foreground relative z-10 flex items-center gap-1 overflow-hidden text-sm font-medium whitespace-nowrap ${
          expanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
        } ${motion ? `transition-[max-width,opacity,color] duration-200 ${EASE}` : ""}`}
      >
        {app.label}
        <EyIcon name="externalLink" size={13} strokeWidth={1.8} className="shrink-0 opacity-70" />
      </span>
    </a>
  );

  if (expanded) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{app.label} · 새 탭으로 열기</TooltipContent>
    </Tooltip>
  );
}
