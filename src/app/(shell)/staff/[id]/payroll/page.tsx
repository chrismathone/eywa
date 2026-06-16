import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getStaffDetail } from "@/features/staff/server/queries";
import {
  calculateMonthlyPayroll,
  getPayrollHistory,
} from "@/features/payroll/server/queries";
import { PayrollClient } from "./_client";

export const metadata = { title: "강사 정산 — eywa" };

export default async function StaffPayrollPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  await requireAccess("staff");
  const { id } = await params;
  const { period: periodParam } = await searchParams;

  const today = new Date();
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
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
        <h1 className="display text-foreground text-2xl">{staff.displayName}</h1>
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
