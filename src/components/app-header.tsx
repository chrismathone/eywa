"use client";

import { usePathname } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { COMMAND_PALETTE_OPEN_EVENT } from "@/components/command-palette";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { findNavItem, findNavGroup, navPresentation } from "@/lib/navigation";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { useWindowStore } from "@/components/workspace/window-store";

export function AppHeader({ brand = "EYWA" }: { brand?: string }) {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  // 데스크톱은 메뉴=창이라 pathname이 항상 /dashboard에 머문다 → 헤더는 포커스된 창을 따른다.
  // 창이 하나도 포커스돼 있지 않으면 main 데스크톱 작업면(오늘)을 표기한다.
  // 모바일(라우트 이동)에선 기존 pathname 기준을 유지.
  const focused = useWindowStore((s) => (s.focusedId ? s.windows[s.focusedId] : null));
  const focusedLiveTitle = useWindowStore((s) => (s.focusedId ? s.live[s.focusedId]?.title : undefined));
  const hasFocus = isDesktop && !!focused && !focused.minimized;

  let title: string;
  let breadcrumb: string;
  if (isDesktop) {
    if (hasFocus && focused) {
      const item = findNavItem(focused.params.href ?? "");
      const group = findNavGroup(focused.params.href ?? "");
      title = focusedLiveTitle?.trim() || focused.params.title || item?.label || "eywa";
      breadcrumb = group ? `${brand} · ${group.label}` : brand;
    } else {
      const current = findNavItem(pathname);
      const group = findNavGroup(pathname);
      title = current && navPresentation(current) === "desktop" ? current.label : "홈";
      breadcrumb = group ? `${brand} · ${group.label}` : brand;
    }
  } else {
    const current = findNavItem(pathname);
    const group = findNavGroup(pathname);
    title = current?.label ?? "eywa";
    breadcrumb = group ? `${brand} · ${group.label}` : brand;
  }

  function openCommandPalette() {
    window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
  }

  return (
    <header className="bg-background border-line sticky top-0 z-30 flex h-12 shrink-0 items-center gap-4 border-b px-4 lg:px-6">
      <div className="min-w-0 shrink-0">
        <div className="text-text-dim font-mono text-[10px] leading-none tracking-[1px] uppercase">
          {breadcrumb}
        </div>
        <h1 className="text-foreground mt-1 truncate text-[16px] leading-none font-extrabold tracking-tight">
          {title}
        </h1>
      </div>

      {/* 우측 클러스터 — 검색 · 알림. */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5">
        {/* 검색 팰릿 트리거 — 클릭으로 메뉴·검색 팰릿을 연다 */}
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="메뉴 검색 열기"
          className="border-line bg-card text-text-dim hover:bg-bg-soft hover:text-foreground hidden w-[320px] shrink items-center gap-2.5 rounded-full border px-4 py-1.5 transition md:flex"
        >
          <EyIcon name="search" size={14} />
          <span className="flex-1 truncate text-left text-[13px]">메뉴 · 학생 · 수업 어디로든 점프</span>
        </button>

        <NotificationBell />
      </div>
    </header>
  );
}
