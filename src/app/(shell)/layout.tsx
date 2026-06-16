import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { MobileTopNav } from "@/components/mobile-top-nav";
import { UserMenu } from "@/components/user-menu";
import { getCurrentUser } from "@/lib/auth/current-user";
import { WorkspaceCanvas } from "@/components/workspace/workspace-canvas";
import { EmbedProvider } from "@/components/workspace/embed-context";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Stage Manager 임베드(?embed=1 → proxy가 x-embed 주입): 사이드바·헤더·캔버스·팰릿 전부
  // 생략하고 본문만(크롬리스). 창 안엔 캔버스가 없으니 무한중첩 불가. RLS는 페이지가 자체 게이트.
  const embed = (await headers()).get("x-embed") === "1";
  if (embed) {
    return (
      <EmbedProvider embed>
        <main className="bg-background text-foreground h-screen overflow-auto px-3 py-4 lg:px-6 lg:py-5 [scrollbar-gutter:stable]">
          {children}
        </main>
      </EmbedProvider>
    );
  }

  // 강사·학생: 사이드바·네비 없는 단일 화면 셸 — 미니멀 헤더(브랜드 + 로그아웃) + 풀폭 본문.
  // 강사=원스크린, 학생=내 학습 현황. (원장 등 나머지는 아래 12메뉴 풀 셸 그대로.)
  if (user.systemRole === "teacher" || user.systemRole === "student") {
    return (
      <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden">
        <header className="bg-background border-line sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between border-b px-5 lg:px-7">
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
        <main className="flex-1 overflow-auto px-3 py-4 lg:px-6 lg:py-5 [scrollbar-gutter:stable]">{children}</main>
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden lg:flex-row">
      {/* lg≥: 좌측 사이드바 232px (고정) / lg<: 숨김 */}
      <AppSidebar
        systemRole={user.systemRole}
        email={user.email}
        className="hidden lg:flex"
      />

      {/* lg<: 상단 horizontal nav / lg≥: 숨김 */}
      <MobileTopNav systemRole={user.systemRole} email={user.email} className="lg:hidden" />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader />
        <main className="flex-1 overflow-auto px-3 py-4 lg:px-6 lg:py-5 [scrollbar-gutter:stable]">{children}</main>
      </div>

      {/* 검색 메뉴 점프 팰릿 — 헤더 검색 클릭으로 열림, 포털 렌더라 위치 무관 */}
      <CommandPalette systemRole={user.systemRole} />

      {/* Stage Manager 워크스페이스 — 데스크톱에서만 자체 마운트(모바일/미니셸 무영향) */}
      <WorkspaceCanvas owner={`${user.tenantId}:${user.id}`} />
    </div>
  );
}
