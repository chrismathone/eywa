import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { getStudentById } from "@/features/students/server/queries";
import { RunCareAiButton } from "./run-care-ai-button";
import { StudentTabsNav, isStudentTabKey } from "./_components/tabs-nav";
import { StatusAction } from "./_components/status-action";
import { OverviewTab } from "./_tabs/overview-tab";
import { BillingTab } from "./_tabs/billing-tab";
import { GradesTab } from "./_tabs/grades-tab";
import { AttendanceTab } from "./_tabs/attendance-tab";
import { ConsultationsTab } from "./_tabs/consultations-tab";
import { MemosTab } from "./_tabs/memos-tab";
import { TimelineTab } from "./_tabs/timeline-tab";

export const metadata = { title: "학생 상세 — eywa" };

const STATUS_LABEL: Record<string, string> = {
  prospect: "예비",
  consulted: "상담완료",
  enrolled: "재원",
  on_hold: "휴원",
  withdrawn: "퇴원",
};

const STATUS_COLOR: Record<string, string> = {
  enrolled: "text-chart-2 bg-chart-2/10 border-chart-2/20",
  prospect: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  consulted: "text-chart-1 bg-chart-1/10 border-chart-1/20",
  on_hold: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  withdrawn: "text-muted-foreground bg-muted border-border",
};

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAccess("students");
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = isStudentTabKey(tabParam) ? tabParam : "overview";

  const student = await getStudentById(id);
  if (!student) notFound();

  const hasCareAi = student.aiCareSummary !== null;

  return (
    <div className="space-y-6">
      <Link
        href="/students"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        학생목록으로
      </Link>

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow">학생</p>
          <h1 className="display text-foreground text-3xl">{student.name}</h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            {student.grade ? <span>{student.grade}</span> : null}
            {student.school ? <span>· {student.school}</span> : null}
            {student.studentCode ? (
              <span className="num">· 학번 {student.studentCode}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${
              STATUS_COLOR[student.status] ?? "bg-muted text-muted-foreground border-border"
            }`}
          >
            {STATUS_LABEL[student.status] ?? student.status}
          </span>
          <div className="flex items-center gap-2">
            <StatusAction
              studentId={student.id}
              studentName={student.name}
              currentStatus={STATUS_LABEL[student.status] ?? student.status}
            />
            <Button variant="outline" render={<Link href={`/students/${student.id}/edit`} />}>
              <Pencil className="size-3.5" />
              수정
            </Button>
            {student.status === "enrolled" ? (
              <RunCareAiButton studentId={student.id} hasExisting={hasCareAi} />
            ) : null}
          </div>
        </div>
      </header>

      <StudentTabsNav studentId={student.id} active={tab} />

      <section>
        {tab === "overview" ? (
          <OverviewTab student={student} />
        ) : tab === "billing" ? (
          <BillingTab studentId={student.id} />
        ) : tab === "grades" ? (
          <GradesTab studentId={student.id} />
        ) : tab === "attendance" ? (
          <AttendanceTab studentId={student.id} />
        ) : tab === "consultations" ? (
          <ConsultationsTab studentId={student.id} />
        ) : tab === "memos" ? (
          <MemosTab studentId={student.id} />
        ) : tab === "timeline" ? (
          <TimelineTab studentId={student.id} />
        ) : null}
      </section>
    </div>
  );
}
