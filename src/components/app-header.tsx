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
import { findNavItem, findNavGroup } from "@/lib/navigation";
import { useIsMac } from "@/lib/use-platform";

export function AppHeader() {
  const pathname = usePathname();
  const current = findNavItem(pathname);
  const group = findNavGroup(pathname);
  const title = current?.label ?? "eywa";
  const breadcrumb = group ? `EYWA · ${group.label}` : "EYWA";
  const isMac = useIsMac();

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

      {/* ⌘K 팰릿 트리거 — 주 내비. 전역 단축키와 동일한 검색을 연다 */}
      <div className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="메뉴 검색 열기"
          aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
          className="border-line bg-card text-text-dim hover:bg-bg-soft hover:text-foreground hidden w-full max-w-[420px] items-center gap-2.5 rounded-full border px-4 py-1.5 transition md:flex"
        >
          <EyIcon name="search" size={14} />
          <span className="flex-1 text-left text-[13px]">메뉴 · 학생 · 수업 어디로든 점프</span>
          <span className="bg-bg-soft text-text-faint rounded-sm px-1.5 py-px font-mono text-[10px]">
            {isMac ? "⌘K" : "Ctrl+K"}
          </span>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
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
