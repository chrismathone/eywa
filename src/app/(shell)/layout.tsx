import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileTopNav } from "@/components/mobile-top-nav";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

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
        <main className="flex-1 overflow-auto px-4 py-5 lg:px-7 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
