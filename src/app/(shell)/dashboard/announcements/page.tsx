import Link from "next/link";
import { headers } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { canWrite } from "@/lib/permissions";
import { getAnnouncementsForManage, getRecentAnnouncements } from "@/features/dashboard/server/queries";
import { AnnouncementsCard } from "../_components/announcements-card";

export const metadata = { title: "학원 공지 — 에이와" };

export default async function AnnouncementsPage() {
  const user = await requireAccess("dashboard");
  const matrix = await getUserPermMatrix();
  const canManage = canManageStaff(user.systemRole) && canWrite(user.systemRole, "dashboard", matrix);
  const embed = (await headers()).get("x-embed") === "1";
  const [recent, managed] = await Promise.allSettled([
    getRecentAnnouncements(user.systemRole, 20),
    canManage ? getAnnouncementsForManage() : Promise.resolve([]),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      {embed ? null : (
        <Link href="/dashboard" className="text-text-dim hover:text-foreground mb-2 inline-flex text-sm transition print:hidden">
          운영실
        </Link>
      )}
      <AnnouncementsCard
        items={recent.status === "fulfilled" ? recent.value : []}
        unavailable={recent.status === "rejected"}
        canManage={canManage}
        manageItems={managed.status === "fulfilled" ? managed.value : []}
        manageUnavailable={managed.status === "rejected"}
      />
    </div>
  );
}
