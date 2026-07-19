import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { PAYROLL_ENABLED } from "@/features/payroll/config";
import { getStaffDetail } from "@/features/staff/server/queries";
import {
  calculateMonthlyPayroll,
  getPayrollHistory,
} from "@/features/payroll/server/queries";
import { PayrollClient } from "./_client";
import { kstMonth } from "@/lib/date-kst";

export const metadata = { title: "강사 정산 — eywa" };

export default async function StaffPayrollPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  await requireAccess("staff");
  if (!PAYROLL_ENABLED) redirect("/staff"); // 급여 기능 비활성화(직접 URL 진입 차단)
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
      <BackLink href={`/staff/${id}/edit`} label="강사 정보로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">강사 급여 정산</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{staff.displayName}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {staff.jobTitle ?? staff.systemRole} · 시급 {staff.hourlyRate.toLocaleString("ko-KR")}원 ·
          기본급 {staff.monthlyBase.toLocaleString("ko-KR")}원
        </p>
      </header>

      <PayrollClient
        userId={staff.id}
        period={period}
        autoCalc={autoCalc}
        history={history}
      />
    </div>
  );
}
