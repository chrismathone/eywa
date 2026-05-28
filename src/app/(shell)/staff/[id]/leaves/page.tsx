import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import { getStaffDetail } from "@/features/staff/server/queries";
import { getStaffLeaves } from "@/features/payroll/server/queries";
import { LeavesClient } from "./_client";

export const metadata = { title: "휴가 관리 — eywa" };

export default async function StaffLeavesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("staff");
  const { id } = await params;

  const [staff, leaves] = await Promise.all([getStaffDetail(id), getStaffLeaves(id)]);
  if (!staff) notFound();

  return (
    <div className="space-y-6">
      <Link
        href={`/staff/${id}/edit`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        강사 정보로
      </Link>

      <header className="border-border border-b pb-5">
        <p className="eyebrow">강사 휴가 관리</p>
        <h1 className="display text-foreground text-2xl">{staff.displayName}</h1>
      </header>

      <LeavesClient userId={staff.id} leaves={leaves} />
    </div>
  );
}
