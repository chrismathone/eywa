import { notFound } from "next/navigation";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isChinsanTenant } from "@/features/owner/preset";
import { isStaffLeavesEnabled } from "@/features/payroll/config";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getStaffDetail } from "@/features/staff/server/queries";
import { getStaffLeaves } from "@/features/payroll/server/queries";
import { LeavesClient } from "./_client";

export const metadata = { title: "휴가 관리 — 에이와" };

export default async function StaffLeavesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("staff");
  const settings = await getTenantSettings();
  if (!isChinsanTenant(settings) && !isStaffLeavesEnabled(settings)) notFound();
  const { id } = await params;
  const canManage =
    await canWriteTenant(user.systemRole, "staff"); // 메뉴 쓰기 권한(개인 예외 포함) 단일 기준

  const [staff, leaves] = await Promise.all([getStaffDetail(id), getStaffLeaves(id)]);
  if (!staff) notFound();

  return (
    <div className="space-y-6">
      {/* 되돌아갈 곳은 상세다 — /edit은 이제 '근무 설정'(담당·알림 토글)이라 휴가에서 돌아가 볼 화면이
          아니고, 권한별로 목적지가 갈리면 같은 버튼이 사람마다 다른 데로 간다. */}
      <BackLink href={`/staff/${id}`} label="직원 상세로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">강사 휴가 관리</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{staff.displayName}</h1>
      </header>

      <LeavesClient userId={staff.id} leaves={leaves} canManage={canManage} />
    </div>
  );
}
