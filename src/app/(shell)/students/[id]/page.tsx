import { WindowLink } from "@/components/workspace/window-link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { DupSuspectTag } from "@/components/dup-suspect-tag";
import { getStudentById } from "@/features/students/server/queries";
import { DupSuspectNotice } from "./_components/dup-suspect-notice";
import { RunCareAiButton } from "./run-care-ai-button";
import { StudentTabsNav, isStudentTabKey } from "./_components/tabs-nav";
import { StatusAction } from "./_components/status-action";
import { OverviewTab } from "./_tabs/overview-tab";
import { ClassesTab } from "./_tabs/classes-tab";
import { BillingTab } from "./_tabs/billing-tab";
import { GradesTab } from "./_tabs/grades-tab";
import { ProgressTab } from "./_tabs/progress-tab";
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
  const user = await requireAccess("students");
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = isStudentTabKey(tabParam) ? tabParam : "overview";

  const student = await getStudentById(id);
  if (!student) notFound();

  const hasCareAi = student.aiCareSummary !== null;
  // 수강 종료 노출 = 학생 쓰기(full) 권한 이상만(master·admin·manager·counselor).
  const canEndEnrollment = (await accessLevelTenant(user.systemRole, "students")) === "full";
  // 시작/종료일 더블클릭 수정 = owner(원장) 콘솔 권한 이상만(관리자 정정).
  const canEditDates = (await accessLevelTenant(user.systemRole, "owner")) === "full";
  // 분리등원 요일(스케줄) 더블클릭 편집 = 반 쓰기 권한(updateEnrollmentsAttendanceBatch와 동일 게이트).
  const canEditSchedule = await canWriteTenant(user.systemRole, "classes");

  return (
    <div className="space-y-6">
      <BackLink href="/students" label="학생목록으로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow">학생</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="display text-foreground text-3xl">{student.name}</h1>
            {student.dupSuspect ? <DupSuspectTag /> : null}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            {student.grade ? <span>{student.grade}</span> : null}
            {student.school ? <span>· {student.school}</span> : null}
            {student.studentCode ? (
              <span className="num">· 학번 {student.studentCode}</span>
            ) : null}
          </div>
          {student.dupSuspect ? (
            <DupSuspectNotice studentId={student.id} canClear={canEndEnrollment} />
          ) : null}
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
              currentStatus={student.status}
            />
            <Button variant="outline" render={<WindowLink href={`/students/${student.id}/edit`} title="학생 수정" />}>
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
        ) : tab === "classes" ? (
          <ClassesTab student={student} canEnd={canEndEnrollment} canEditDates={canEditDates} canEditSchedule={canEditSchedule} />
        ) : tab === "grades" ? (
          <GradesTab studentId={student.id} />
        ) : tab === "progress" ? (
          <ProgressTab studentId={student.id} />
        ) : tab === "attendance" ? (
          <AttendanceTab studentId={student.id} />
        ) : tab === "consultations" ? (
          <ConsultationsTab studentId={student.id} />
        ) : tab === "memos" ? (
          <MemosTab studentId={student.id} />
        ) : tab === "billing" ? (
          <BillingTab studentId={student.id} />
        ) : tab === "timeline" ? (
          <TimelineTab studentId={student.id} />
        ) : null}
      </section>
    </div>
  );
}
