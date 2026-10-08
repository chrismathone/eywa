import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isPayrollEnabled } from "@/features/payroll/config";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getStaffDetail } from "@/features/staff/server/queries";
import {
  calculateMonthlyPayroll,
  getPayrollHistory,
} from "@/features/payroll/server/queries";
import { PayrollClient } from "./_client";
import { kstMonth } from "@/lib/date-kst";
import { PersonalSalaryScope } from "./_salary-scope";

export const metadata = { title: "강사 정산 — 에이와" };

export default async function StaffPayrollPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireAccess("staff");
  if (!isPayrollEnabled(await getTenantSettings())) redirect("/staff");
  // 급여 읽기 = 쓰기와 같은 역할 게이트(payrollReadScope와 동일) — 직원관리 개인 예외만으로는 급여를 못 연다.
  if (!canManageStaff(user.systemRole) && !(await isCurrentUserSuperAdmin())) redirect("/staff");
  const { id } = await params;
  const { period: periodParam } = await searchParams;

  const defaultPeriod = kstMonth();
  const period = periodParam ?? defaultPeriod;

  const [staff, history, autoCalc] = await Promise.all([
    getStaffDetail(id),
    getPayrollHistory(id),
    calculateMonthlyPayroll(id, period),
  ]);

  if (!staff) notFound();

  return (
    <div className="space-y-6">
      <BackLink href={`/staff/${id}`} label="직원 상세로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">강사 급여 정산</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{staff.displayName}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {staff.jobTitle ?? staff.systemRole} · 시급 {staff.hourlyRate.toLocaleString("ko-KR")}원 ·
          기본급 {staff.monthlyBase.toLocaleString("ko-KR")}원
        </p>
      </header>

      <PersonalSalaryScope teacherId={staff.id} teacherName={staff.displayName} period={period} />

      <PayrollClient
        userId={staff.id}
        period={period}
        autoCalc={autoCalc}
        history={history}
      />
    </div>
  );
}
