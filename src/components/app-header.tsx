"use client";

import { usePathname } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COMMAND_PALETTE_OPEN_EVENT } from "@/components/command-palette";
import { BackgroundTabs } from "@/components/workspace/background-tabs";
import { findNavItem, findNavGroup } from "@/lib/navigation";

export function AppHeader({ brand = "EYWA" }: { brand?: string }) {
  const pathname = usePathname();
  const current = findNavItem(pathname);
  const group = findNavGroup(pathname);
  const title = current?.label ?? "eywa";
  const breadcrumb = group ? `${brand} · ${group.label}` : brand;

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

      {/* 우측 클러스터 — 배경 탭(있을 때) · 검색 · 알림. 검색은 우측, 배경 탭은 그 왼쪽. */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5">
        {/* 배경 탭 스트립 — 배경 2개 이상일 때만. 검색 왼쪽에 인라인 배치. */}
        <BackgroundTabs />

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

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="알림"
                className="border-line bg-card text-foreground hover:bg-surface-hi relative flex size-9 items-center justify-center rounded-[4px] border transition"
              />
            }
          >
            <EyIcon name="bell" size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>알림</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="text-text-dim px-2 py-6 text-center text-xs">
              새 알림이 없습니다
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
