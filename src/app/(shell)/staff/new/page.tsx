import { redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { assignableRoles } from "@/lib/auth/role-hierarchy";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getTenantSettings } from "@/features/owner/server/queries";
import { StaffForm } from "../_components/staff-form";

export const metadata = { title: "직원 등록 — eywa" };

export default async function NewStaffPage() {
  await requireAccess("staff");
  const user = await getCurrentUser();
  if (!user || !(await canWriteTenant(user.systemRole, "staff"))) {
    redirect("/staff");
  }

  const roleOptions = assignableRoles(user.systemRole);
  const { operations } = await getTenantSettings();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/staff" label="직원관리로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">직원 등록</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">새 직원 추가</h1>
        <p className="text-muted-foreground text-sm">
          Supabase Auth 계정이 자동 생성됩니다. 임시 비밀번호는 직원에게 직접 안내하고 첫 로그인 후 변경하도록 요청하세요.
        </p>
      </header>

      <StaffForm
        mode="create"
        assignableRoleOptions={roleOptions}
        jobTitleOptions={operations.jobTitles}
      />
    </div>
  );
}
