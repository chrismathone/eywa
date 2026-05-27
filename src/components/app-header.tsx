"use client";

import { usePathname } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { UserMenu } from "@/components/user-menu";
import { findNavItem, findNavGroup } from "@/lib/navigation";

export function AppHeader({ email }: { email: string }) {
  const pathname = usePathname();
  const current = findNavItem(pathname);
  const group = findNavGroup(pathname);
  const title = current?.label ?? "eywa";
  const breadcrumb = group ? `EYWA · ${group.label}` : "EYWA";

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
        {/* search (시안 사양 — 정적, 추후 ⌘K palette로 확장) */}
        <div className="border-line bg-card text-text-dim hidden min-w-[280px] items-center gap-2.5 rounded-full border px-3.5 py-2 md:flex">
          <EyIcon name="search" size={13} />
          <span className="flex-1 text-xs">검색</span>
          <span className="bg-bg-soft text-text-faint rounded-sm px-1.5 py-px font-mono text-[10px]">
            ⌘K
          </span>
        </div>
        <button
          type="button"
          className="border-line bg-card text-foreground hover:bg-surface-hi relative flex size-9 items-center justify-center rounded-[4px] border transition"
          aria-label="알림"
        >
          <EyIcon name="bell" size={15} />
          <span className="bg-rose border-card absolute top-[7px] right-[7px] size-[7px] rounded-full border-2" />
        </button>
        <UserMenu email={email} />
      </div>
    </header>
  );
}
