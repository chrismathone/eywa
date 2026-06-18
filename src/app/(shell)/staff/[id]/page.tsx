import { WindowLink } from "@/components/workspace/window-link";
import { notFound } from "next/navigation";
import { CalendarDays, Pencil, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  assignableRoles,
  canManageStaff,
  canManageStaffMember,
  ROLE_LABEL,
} from "@/lib/auth/role-hierarchy";
import { getStaffById } from "@/features/staff/server/queries";
import { StaffTabsNav, isStaffTabKey } from "./_components/tabs-nav";
import { BasicInfoTab } from "./_tabs/basic-info-tab";
import { ScheduleTab } from "./_tabs/schedule-tab";
import { ClassesTab } from "./_tabs/classes-tab";

export const metadata = { title: "직원 상세 — eywa" };

const ROLE_COLOR: Record<string, { pill: PillColor }> = {
  master: { pill: "danger" },
  admin: { pill: "blue" },
  manager: { pill: "blue" },
  teacher: { pill: "primary" },
  counselor: { pill: "rose" },
  accountant: { pill: "purple" },
  viewer: { pill: "neutral" },
  student: { pill: "neutral" },
};

const STATUS_META: Record<string, { label: string; color: PillColor }> = {
  active: { label: "재직", color: "primary" },
  inactive: { label: "퇴사", color: "neutral" },
  pending: { label: "대기", color: "amber" },
};

export default async function StaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAccess("staff");
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = isStaffTabKey(tabParam) ? tabParam : "info";

  const [staff, viewer] = await Promise.all([getStaffById(id), getCurrentUser()]);
  if (!staff) notFound();

  const canManage = !!viewer && canManageStaff(viewer.systemRole);
  const canManageThis = !!viewer && canManageStaffMember(viewer.systemRole, staff.systemRole);
  // 역할 변경 옵션 — actor가 부여할 수 있는(본인보다 약한) 역할만. 패널 자체가 canManageThis로 게이트됨.
  const roleOptions = canManageThis && viewer ? assignableRoles(viewer.systemRole) : [];
  // 급여 노출은 원장(master) + 본인만 (schema.ts 주석). admin/manager에게도 보이면 안 됨.
  const canSeeSalary = !!viewer && (viewer.systemRole === "master" || viewer.id === staff.id);
  const role = ROLE_COLOR[staff.systemRole] ?? ROLE_COLOR.viewer!;
  const status = STATUS_META[staff.status] ?? STATUS_META.active!;
  const isTeacherLike = staff.systemRole === "teacher" || staff.systemRole === "master";

  return (
    <div className="space-y-6">
      <BackLink href="/staff" label="직원관리로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <p className="eyebrow">직원</p>
            <h1 className="display text-foreground text-2xl">{staff.displayName}</h1>
            <p className="text-text-dim num text-xs">{staff.email}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <Pill color={role.pill}>{ROLE_LABEL[staff.systemRole] ?? staff.systemRole}</Pill>
            <Pill color={status.color} soft>
              {status.label}
            </Pill>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                render={<WindowLink href={`/staff/${staff.id}/edit`} title={`${staff.displayName} 수정`} />}
              >
                <Pencil className="size-3.5" />
                수정
              </Button>
            ) : null}
            {isTeacherLike ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  render={<WindowLink href={`/staff/${staff.id}/payroll`} title="급여 정산" />}
                >
                  <Wallet className="size-3.5" />
                  급여
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  render={<WindowLink href={`/staff/${staff.id}/leaves`} title="휴가 관리" />}
                >
                  <CalendarDays className="size-3.5" />
                  휴가
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <StaffTabsNav staffId={staff.id} active={tab} />

      <section>
        {tab === "info" ? (
          <BasicInfoTab
            staff={staff}
            canManageThis={canManageThis}
            showSalary={canSeeSalary}
            roleOptions={roleOptions}
          />
        ) : tab === "schedule" ? (
          <ScheduleTab staffId={staff.id} canManage={canManage} />
        ) : tab === "classes" ? (
          <ClassesTab staffId={staff.id} />
        ) : null}
      </section>
    </div>
  );
}
