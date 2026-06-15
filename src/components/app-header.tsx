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
    <header className="bg-background border-line sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b px-7">
      <div className="min-w-0">
        <div className="text-text-dim font-mono text-[11px] tracking-[1px] uppercase">
          {breadcrumb}
        </div>
        <h1 className="text-foreground mt-0.5 truncate text-[19px] leading-none font-extrabold tracking-tight">
          {title}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {/* ⌘K 팰릿 트리거 — 전역 단축키와 동일한 검색을 연다 */}
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="메뉴 검색 열기"
          aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
          className="border-line bg-card text-text-dim hover:bg-bg-soft hover:text-foreground hidden min-w-[280px] items-center gap-2.5 rounded-full border px-3.5 py-2 transition md:flex"
        >
          <EyIcon name="search" size={13} />
          <span className="flex-1 text-left text-xs">검색</span>
          <span className="bg-bg-soft text-text-faint rounded-sm px-1.5 py-px font-mono text-[10px]">
            {isMac ? "⌘K" : "Ctrl+K"}
          </span>
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
