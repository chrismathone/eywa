import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { getStaffById } from "@/features/staff/server/queries";
import { StaffForm } from "../../_components/staff-form";

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
  const staff = await getStaffById(id);
  if (!staff) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/staff"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        직원관리로
      </Link>

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">직원 수정</p>
        <h1 className="display text-foreground text-2xl">{staff.displayName}</h1>
        <p className="text-muted-foreground text-sm">기본 정보 수정 (역할 변경은 별도)</p>
      </header>

      <StaffForm
        mode="edit"
        assignableRoleOptions={[]}
        initialValue={{
          id: staff.id,
          displayName: staff.displayName,
          email: staff.email,
          systemRole: staff.systemRole,
          hireDate: staff.hireDate,
          jobTitle: staff.jobTitle,
          subjects: staff.subjects,
          defaultClassroom: staff.defaultClassroom,
          memo: staff.memo,
        }}
      />
    </div>
  );
}
