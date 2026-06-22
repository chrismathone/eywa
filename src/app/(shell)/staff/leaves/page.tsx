import { redirect } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { getAllStaffLeaves } from "@/features/payroll/server/queries";
import { LeavesAdminClient } from "./_client";

export const metadata = { title: "휴가 관리 — eywa" };

/** 전 직원 휴가 일괄 관리(master/admin/manager) — 대기 건 승인/삭제. ijw LeaveManagement 이식. */
export default async function StaffLeavesPage() {
  const user = await requireAccess("staff");
  if (!canManageStaff(user.systemRole)) redirect("/staff");

  const leaves = await getAllStaffLeaves();
  const pending = leaves.filter((l) => !l.approvedAt).length;

  return (
    <div className="space-y-5">
      <BackLink href="/staff" label="직원관리로" />
      <header className="border-border flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <p className="eyebrow">직원 관리</p>
          <h1 className="display text-foreground text-2xl">휴가 관리</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          전체 <span className="num text-foreground font-bold">{leaves.length}</span>건 · 대기{" "}
          <span className={`num font-bold ${pending > 0 ? "text-chart-3" : "text-chart-2"}`}>{pending}</span>건
        </p>
      </header>

      {leaves.length === 0 ? (
        <EmptyState icon={CalendarClock} title="등록된 휴가가 없습니다" description="강사 상세에서 휴가를 신청할 수 있습니다." />
      ) : (
        <LeavesAdminClient leaves={leaves} />
      )}
    </div>
  );
}
