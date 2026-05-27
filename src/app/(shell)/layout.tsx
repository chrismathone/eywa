import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="bg-background text-foreground flex h-screen overflow-hidden">
      <AppSidebar
        systemRole={user.systemRole}
        displayName={user.displayName}
        email={user.email}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader email={user.email} />
        <main className="flex-1 overflow-auto px-7 py-6">{children}</main>
      </div>
    </div>
  );
}
