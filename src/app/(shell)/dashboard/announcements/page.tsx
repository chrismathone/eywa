import { requireAccess } from "@/lib/auth/require-access";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { canWrite } from "@/lib/permissions";
import { getAnnouncementsForManage, getRecentAnnouncements } from "@/features/dashboard/server/queries";
import { AnnouncementsCard } from "../_components/announcements-card";

export const metadata = { title: "학원 공지 — eywa" };

export default async function AnnouncementsPage() {
  const user = await requireAccess("dashboard");
  const matrix = await getUserPermMatrix();
  const canManage = canManageStaff(user.systemRole) && canWrite(user.systemRole, "dashboard", matrix);
  const [recent, managed] = await Promise.allSettled([
    getRecentAnnouncements(user.systemRole, 20),
    canManage ? getAnnouncementsForManage() : Promise.resolve([]),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
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
