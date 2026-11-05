import Link from "next/link";
import { headers } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { getAnnouncementsForManage, getRecentAnnouncements } from "@/features/dashboard/server/queries";
import { AnnouncementsCard } from "../_components/announcements-card";

export const metadata = { title: "학원 공지 — 에이와" };

export default async function AnnouncementsPage() {
  const user = await requireAccess("dashboard");
  // 공지 관리 판정은 서버 액션(createAnnouncement 등)과 같은 함수 — 지점 보기 · 다른 강사 뷰의 쓰기 차단까지 같이 본다.
  const canManage = canManageStaff(user.systemRole) && (await canWriteTenant(user.systemRole, "dashboard"));
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
