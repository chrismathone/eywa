import type { ReactNode } from "react";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { SuperAdminSidebar } from "@/components/super-admin/sidebar";

export const dynamic = "force-dynamic";

export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
  const sa = await requireSuperAdmin();

  return (
    <div className="bg-background text-foreground flex h-screen overflow-hidden">
      <SuperAdminSidebar email={sa.email} displayName={sa.displayName} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
