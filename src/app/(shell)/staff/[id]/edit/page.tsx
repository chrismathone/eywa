import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/staff"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        직원관리로
      </Link>

      <header className="border-border flex flex-wrap items-end justify-between gap-3 border-b pb-5">
        <div className="space-y-1">
          <p className="eyebrow">직원 수정</p>
          <h1 className="display text-foreground text-2xl">{staff.displayName}</h1>
          <p className="text-muted-foreground text-sm">기본 정보 수정 (역할 변경은 별도)</p>
        </div>
        {(staff.systemRole === "teacher" || staff.systemRole === "master") ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" render={<Link href={`/staff/${staff.id}/payroll`} />}>
              <Wallet className="size-4" />
              급여 정산
            </Button>
            <Button variant="outline" render={<Link href={`/staff/${staff.id}/leaves`} />}>
              <CalendarDays className="size-4" />
              휴가 관리
            </Button>
          </div>
        ) : null}
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
