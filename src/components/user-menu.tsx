"use client";

import { LogOut, Sparkles, User } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePrefs } from "@/components/workspace/use-prefs";
import { signOut } from "@/app/(auth)/login/actions";

export function UserMenu({
  email,
  displayName,
  jobTitle,
}: {
  email: string;
  displayName?: string;
  jobTitle?: string;
}) {
  const animations = usePrefs((s) => s.animations);
  const setAnimations = usePrefs((s) => s.setAnimations);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="사용자 메뉴" className="rounded-md" />
        }
      >
        {/* 아바타·사진 없음 — 사용자 아이콘만. */}
        <User className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <User className="size-4 shrink-0" />
          {displayName ? (
            <span className="min-w-0 truncate text-sm font-normal">
              {displayName}
              {jobTitle ? <span className="text-text-dim"> · {jobTitle}</span> : null}
              <span className="text-text-faint block truncate text-[11px]">{email}</span>
            </span>
          ) : (
            <span className="truncate text-sm font-normal">{email}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={animations}
          onCheckedChange={(checked) => setAnimations(Boolean(checked))}
          closeOnClick={false}
        >
          <Sparkles className="size-4" />
          창 애니메이션
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem render={<button type="submit" className="w-full cursor-pointer" />}>
            <LogOut className="size-4" />
            로그아웃
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
