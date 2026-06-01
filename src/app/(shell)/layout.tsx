import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { MobileTopNav } from "@/components/mobile-top-nav";
import { UserMenu } from "@/components/user-menu";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // 강사·학생: 사이드바·네비 없는 단일 화면 셸 — 미니멀 헤더(브랜드 + 로그아웃) + 풀폭 본문.
  // 강사=원스크린, 학생=내 학습 현황. (원장 등 나머지는 아래 12메뉴 풀 셸 그대로.)
  if (user.systemRole === "teacher" || user.systemRole === "student") {
    return (
      <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden">
        <header className="bg-background border-line sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b px-5 lg:px-7">
          <div className="flex items-center gap-2.5">
            <span className="bg-ink flex size-7 items-center justify-center rounded-[3px]">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5" fill="none" stroke="#fff" strokeWidth="1.2" />
                <circle cx="8" cy="8" r="2" fill="#fff" />
              </svg>
            </span>
            <div className="leading-none">
              <div className="text-foreground text-[17px] font-extrabold tracking-tight">EYWA</div>
              <div className="text-text-dim mt-[3px] font-mono text-[10px] tracking-wider">
                인재원 · 강남
              </div>
            </div>
          </div>
          <UserMenu email={user.email} />
        </header>
        <main className="flex-1 overflow-auto px-4 py-5 lg:px-7 lg:py-6 [scrollbar-gutter:stable]">{children}</main>
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden lg:flex-row">
      {/* lg≥: 좌측 사이드바 232px (고정) / lg<: 숨김 */}
      <AppSidebar
        systemRole={user.systemRole}
        displayName={user.displayName}
        email={user.email}
        className="hidden lg:flex"
      />

      {/* lg<: 상단 horizontal nav / lg≥: 숨김 */}
      <MobileTopNav systemRole={user.systemRole} className="lg:hidden" />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader email={user.email} />
        <main className="flex-1 overflow-auto px-4 py-5 lg:px-7 lg:py-6 [scrollbar-gutter:stable]">{children}</main>
      </div>

      {/* ⌘K 메뉴 점프 팰릿 — 포털 렌더라 위치 무관, 인증 영역 전역에서 동작 */}
      <CommandPalette systemRole={user.systemRole} />
    </div>
  );
}
