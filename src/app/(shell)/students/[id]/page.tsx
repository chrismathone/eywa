import { WindowLink } from "@/components/workspace/window-link";
import { notFound } from "next/navigation";
import { Pencil } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant, canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { canSeeStudentEnrollment } from "@/features/students/server/enrollment-gate";
import { BackLink } from "@/components/back-link";
import { DupSuspectTag } from "@/components/dup-suspect-tag";
import { getStudentById } from "@/features/students/server/queries";
import { DupSuspectNotice } from "./_components/dup-suspect-notice";
import { RunCareAiButton } from "./run-care-ai-button";
import { StudentTabsNav, isStudentTabKey } from "./_components/tabs-nav";
import { StatusAction } from "./_components/status-action";
import { DeleteStudentButton } from "./_components/delete-student-button";
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
  const requestedTab = isStudentTabKey(tabParam) ? tabParam : "overview";

  // '수납' 탭은 학생(students) 권한이 아니라 **수납(billing) 권한**으로 잠근다 — 학생 상세는 강사(scoped)·
  // 뷰어(readonly)도 열 수 있어서, 탭 하나가 billing=none 역할에게 청구·납입 금액을 통째로 노출하고 있었다.
  // 강제 URL(?tab=billing)도 개요로 되돌린다(UI 숨김은 게이트가 아니다 — gotchas #77).
  // DB에서도 0158a RLS가 같은 매트릭스로 막는다(권한 없으면 0행) — 여기서 되돌리는 이유는 그 경우
  // 화면이 "미납 0원"이라는 **거짓 요약**을 보여주기 때문.
  const canSeeBilling = await canAccessTenant(user.systemRole, "billing");
  const tab = requestedTab === "billing" && !canSeeBilling ? "overview" : requestedTab;

  const student = await getStudentById(id);
  if (!student) notFound();

  const hasCareAi = student.aiCareSummary !== null;
  // 수강 종료 노출 = 학생 쓰기(full) 권한 이상만(master·admin·manager·counselor).
  const canEndEnrollment = (await accessLevelTenant(user.systemRole, "students")) === "full";
  // 학생 영구 삭제 = 관리 도구(admin) 쓰기 권한(기본 master) — 파괴적이라 조임. 잘못 추가 정정용.
  const canDeleteStudent = await canWriteTenant(user.systemRole, "admin");
  // 시작/종료일 더블클릭 수정 = owner(원장) 콘솔 권한 이상만(관리자 정정).
  const canEditDates = (await accessLevelTenant(user.systemRole, "owner")) === "full";
  // 분리등원 요일(스케줄) 더블클릭 편집 = 반 쓰기 권한(updateEnrollmentsAttendanceBatch와 동일 게이트).
  const canEditSchedule = await canWriteTenant(user.systemRole, "classes");
  // 입학 상담(등록상담) 상담탭 노출.
  // ① enrollment 접근권한(원장·상담사 등) → 카드 + '상세 보기' 링크 모두.
  // ② 권한 없어도 **강사가 본인 담당 학생**이면 카드는 노출(읽기) — 단 '상세 보기'(/enrollment/[id])는
  //    여전히 enrollment 게이트라 링크는 숨김. (강사는 담당 학생의 입학 배경만 열람, 관리 상세는 불가.)
  // ①②의 판정은 타임라인 이벤트와 **같은 게이트 함수**를 쓴다(#77 — 표면마다 다시 쓰면 한쪽만 조여진다).
  const enrollmentAccess = (await accessLevelTenant(user.systemRole, "enrollment")) !== "none";
  const canSeeEnrollment = await canSeeStudentEnrollment(user.systemRole, student.id);
  const canOpenEnrollmentDetail = enrollmentAccess;

  return (
    <div className="space-y-6">
      <BackLink href="/students" label="학생목록으로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow">학생</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-bold tracking-tight text-foreground text-3xl">{student.name}</h1>
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
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
              STATUS_COLOR[student.status] ?? "bg-muted text-muted-foreground border-border"
            }`}
          >
            {STATUS_LABEL[student.status] ?? student.status}
          </span>
          {/* ⚠️ 감기게 둔다 — 이 줄엔 상태 변경·수정·AI·삭제가 함께 서고, 라벨에 목적어를 붙이면
              (수정 → 학생 수정) 좁은 화면에서 가로로 넘친다. 넘치는 대신 다음 줄로 내려간다. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusAction
              studentId={student.id}
              studentName={student.name}
              currentStatus={student.status}
            />
            {/* ⚠️ "수정" 단독 금지 — 상담 탭을 열면 상담 카드마다 '수정'(그 상담 기록)이 함께 보인다.
                여기는 **학생 정보**를 연다. 반 상세('반 수정')와 같은 규칙. */}
            <Button variant="outline" render={<WindowLink href={`/students/${student.id}/edit`} title="학생 수정" />}>
              <Pencil className="size-3.5" />
              학생 수정
            </Button>
            {student.status === "enrolled" ? (
              <RunCareAiButton studentId={student.id} hasExisting={hasCareAi} />
            ) : null}
            {canDeleteStudent ? (
              <DeleteStudentButton studentId={student.id} studentName={student.name} />
            ) : null}
          </div>
        </div>
      </header>

      <StudentTabsNav studentId={student.id} active={tab} canSeeBilling={canSeeBilling} />

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
          <ConsultationsTab
            studentId={student.id}
            canSeeEnrollment={canSeeEnrollment}
            canOpenEnrollmentDetail={canOpenEnrollmentDetail}
          />
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
