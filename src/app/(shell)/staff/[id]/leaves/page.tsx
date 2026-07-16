import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getStaffDetail } from "@/features/staff/server/queries";
import { getStaffLeaves } from "@/features/payroll/server/queries";
import { LeavesClient } from "./_client";

export const metadata = { title: "휴가 관리 — eywa" };

export default async function StaffLeavesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("staff");
  const { id } = await params;
  const canManage =
    canManageStaff(user.systemRole) && (await canWriteTenant(user.systemRole, "staff"));

  const [staff, leaves] = await Promise.all([getStaffDetail(id), getStaffLeaves(id)]);
  if (!staff) notFound();

  return (
    <div className="space-y-6">
      <BackLink
        href={canManage ? `/staff/${id}/edit` : `/staff/${id}`}
        label={canManage ? "강사 정보로" : "강사 상세로"}
      />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">강사 휴가 관리</p>
        <h1 className="display text-foreground text-2xl">{staff.displayName}</h1>
      </header>

      <LeavesClient userId={staff.id} leaves={leaves} canManage={canManage} />
    </div>
  );
}
