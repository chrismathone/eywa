import { WindowLink } from "@/components/workspace/window-link";
import { notFound, redirect } from "next/navigation";
import { CalendarDays, Wallet } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { getStaffById } from "@/features/staff/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isImportArtifactEmail } from "@/features/staff/email";
import { StaffForm } from "../../_components/staff-form";
import { PAYROLL_ENABLED } from "@/features/payroll/config";

export const metadata = { title: "직원 수정 — eywa" };

export default async function EditStaffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("staff");
  const user = await getCurrentUser();
  if (!user || !canManageStaff(user.systemRole)) {
    redirect("/staff");
  }

  const { id } = await params;
  const [staff, { operations }] = await Promise.all([getStaffById(id), getTenantSettings()]);
  if (!staff) notFound();
  // canEditEmail: 임포트 산물 이메일(형식불량·@imported.local)만 편집 허용 — 실 로그인 이메일은 잠금.
  // auth 계정 보유 시 서버 액션이 auth.users 이메일을 직접 변경(미러 트리거가 public 동기, 0075a).
  const canEditEmail = isImportArtifactEmail(staff.email);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/staff" label="직원관리로" />

      <header className="border-border flex flex-wrap items-end justify-between gap-3 border-b pb-5">
        <div className="space-y-1">
          <p className="eyebrow">직원 수정</p>
          <h1 className="display text-foreground text-2xl">{staff.displayName}</h1>
          <p className="text-muted-foreground text-sm">기본 정보 수정 (역할 변경은 별도)</p>
        </div>
        {(staff.systemRole === "teacher" || staff.systemRole === "master") ? (
          <div className="flex flex-wrap items-center gap-2">
            {PAYROLL_ENABLED ? (
              <Button variant="outline" render={<WindowLink href={`/staff/${staff.id}/payroll`} title="급여 정산" />}>
                <Wallet className="size-4" />
                급여 정산
              </Button>
            ) : null}
            <Button variant="outline" render={<WindowLink href={`/staff/${staff.id}/leaves`} title="휴가 관리" />}>
              <CalendarDays className="size-4" />
              휴가 관리
            </Button>
          </div>
        ) : null}
      </header>

      <StaffForm
        mode="edit"
        scope={`staff:${id}`}
        assignableRoleOptions={[]}
        jobTitleOptions={operations.jobTitles}
        canEditEmail={canEditEmail}
        initialValue={{
          id: staff.id,
          displayName: staff.displayName,
          email: staff.email,
          phone: staff.phone,
          systemRole: staff.systemRole,
          hireDate: staff.hireDate,
          jobTitle: staff.jobTitle,
          subjects: staff.subjects,
          defaultClassroom: staff.defaultClassroom,
          memo: staff.memo,
          bgColor: staff.bgColor,
        }}
      />
    </div>
  );
}
