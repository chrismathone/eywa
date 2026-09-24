import type { ReactNode } from "react";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { SuperAdminSidebar } from "@/components/super-admin/sidebar";
import { SuperAdminMobileBar } from "@/components/super-admin/mobile-bar";

export const dynamic = "force-dynamic";

/**
 * 슈퍼관리자 셸 — 앱 관리자 셸(`(shell)/layout.tsx`)과 **같은 뼈대**다(원장 2026-09-25 전면 정리).
 * - 데스크톱(≥lg + 마우스) = 왼쪽 사이드바 / 그 외(좁은 폭·터치) = 상단 한 줄 바. 조건 `lg:pointer-fine:`은
 *   앱 셸·`use-is-desktop.ts`·`compact-chrome` 변형과 같은 축이다 — 한쪽만 바꾸면 "사이드바도 바도 없는" 폭이 생긴다.
 * - `<main>` 여백은 앱 셸 풀셸과 같은 값(`px-3 pt-2 pb-8 lg:px-6 lg:pt-5 lg:pb-10`) — 본문 하단 여백 규약.
 * 🔴 종전엔 사이드바가 폰에서도 256px로 서서 본문이 한 글자 폭으로 짜부라졌다(폰 캡처 2026-09-25).
 */
export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
  const sa = await requireSuperAdmin();

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden lg:pointer-fine:flex-row">
      <SuperAdminSidebar email={sa.email} displayName={sa.displayName} className="hidden lg:pointer-fine:flex" />
      <SuperAdminMobileBar email={sa.email} className="lg:pointer-fine:hidden" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto px-3 pt-2 pb-8 lg:px-6 lg:pt-5 lg:pb-10 [scrollbar-gutter:stable]">
          <div className="mx-auto max-w-[1400px] space-y-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
