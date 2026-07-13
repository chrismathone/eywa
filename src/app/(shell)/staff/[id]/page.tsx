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
import { getSuperAdminIds, displayRoleFor } from "@/lib/auth/super-admin";
import { StaffTabsNav, isStaffTabKey } from "./_components/tabs-nav";
import { BasicInfoTab } from "./_tabs/basic-info-tab";
import { MonthlyScheduleTab } from "./_tabs/monthly-schedule-tab";
import { ClassesTab } from "./_tabs/classes-tab";
import { ActivityLogTab } from "./_tabs/activity-log-tab";
import { PAYROLL_ENABLED } from "@/features/payroll/config";

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
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  await requireAccess("staff");
  const { id } = await params;
  const { tab: tabParam, page: pageParam } = await searchParams;
  const tabRaw = isStaffTabKey(tabParam) ? tabParam : "info";
  const activityPage = Math.max(1, Number(pageParam) || 1);

  const [staff, viewer, superAdminIds] = await Promise.all([
    getStaffById(id),
    getCurrentUser(),
    getSuperAdminIds(),
  ]);
  if (!staff) notFound();

  // 표시 위장(fake admin) — 배지·버튼 노출 등 '보이는 것'에만. 위계/권한 판정엔 실제 staff.systemRole 사용.
  const displayRole = displayRoleFor(staff.id, staff.systemRole, superAdminIds);

  const canManage = !!viewer && canManageStaff(viewer.systemRole);
  // 활동 로그 탭은 사무실 전용 — 비-사무실이 ?tab=activity로 직접 와도 기본정보로 폴백(RLS도 별도 방어).
  const tab = tabRaw === "activity" && !canManage ? "info" : tabRaw;
  const canManageThis = !!viewer && canManageStaffMember(viewer.systemRole, staff.systemRole);
  // 역할 변경 옵션 — actor가 부여할 수 있는(본인보다 약한) 역할만. 패널 자체가 canManageThis로 게이트됨.
  const roleOptions = canManageThis && viewer ? assignableRoles(viewer.systemRole) : [];
  // 급여 노출은 원장(master) + 본인만 (schema.ts 주석). admin/manager에게도 보이면 안 됨.
  const canSeeSalary = !!viewer && (viewer.systemRole === "master" || viewer.id === staff.id);
  const role = ROLE_COLOR[displayRole] ?? ROLE_COLOR.viewer!;
  const status = STATUS_META[staff.status] ?? STATUS_META.active!;
  // 급여·휴가 버튼 노출은 표시 역할 기준(위장된 admin은 일반 관리자처럼 미노출) — 순수 표시.
  const isTeacherLike = displayRole === "teacher" || displayRole === "master";

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
            <Pill color={role.pill}>{ROLE_LABEL[displayRole] ?? displayRole}</Pill>
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
                {PAYROLL_ENABLED ? (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<WindowLink href={`/staff/${staff.id}/payroll`} title="급여 정산" />}
                  >
                    <Wallet className="size-3.5" />
                    급여
                  </Button>
                ) : null}
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

      <StaffTabsNav staffId={staff.id} active={tab} showActivity={canManage} />

      <section>
        {tab === "info" ? (
          <BasicInfoTab
            staff={staff}
            displayRole={displayRole}
            canManageThis={canManageThis}
            showSalary={canSeeSalary}
            roleOptions={roleOptions}
          />
        ) : tab === "monthly" ? (
          <MonthlyScheduleTab staffId={staff.id} canManage={canManage} />
        ) : tab === "classes" ? (
          <ClassesTab staffId={staff.id} />
        ) : tab === "activity" ? (
          <ActivityLogTab userId={staff.id} page={activityPage} />
        ) : null}
      </section>
    </div>
  );
}
