import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { PageHeader } from "@/components/page-header";
import { FaceTabs } from "@/components/face-tabs";
import { getVideoHomeworkHistory, getVideoHomeworkRoster } from "@/features/video-homework/server/queries";
import { VideoHomeworkManagement } from "@/features/video-homework/components/video-homework-management";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { addDays, kstToday } from "@/lib/date-kst";
import { getLastLessonAssignments } from "@/features/video-homework/server/assignments";
import { isVideoHomeworkDate } from "@/features/video-homework/types";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import { lessonReportFaces } from "@/features/report-admin/lesson-report-faces";
import { isModuleEnabled } from "@/lib/modules";

export const dynamic = "force-dynamic";
export const metadata = { title: "영상 제출 현황 · 에이와" };

export default async function VideoHomeworkPage({ searchParams }: {
  searchParams: Promise<{ date?: string; from?: string; to?: string }>;
}) {
  const user = await requireAccess("lesson_reports");
  const { date: requestedDate, from: requestedFrom, to: requestedTo } = await searchParams;
  const today = kstToday();
  const checkDate = requestedDate && isVideoHomeworkDate(requestedDate) && requestedDate <= today ? requestedDate : today;
  const toDate = requestedTo && isVideoHomeworkDate(requestedTo) && requestedTo <= today ? requestedTo : checkDate;
  const fromDate = requestedFrom && isVideoHomeworkDate(requestedFrom) && requestedFrom <= toDate
    ? requestedFrom : `${toDate.slice(0, 7)}-01`;
  const [{ rows, marks }, history, canEdit, canOwner, settings] = await Promise.all([
    getVideoHomeworkRoster(user.tenantId, checkDate),
    getVideoHomeworkHistory(user.tenantId, fromDate, toDate),
    canWriteTenant(user.systemRole, "lesson_reports"),
    canWriteTenant(user.systemRole, "owner"),
    getTenantSettings(),
  ]);
  const subjectLabels = buildSubjectMaps(settings.operations.subjects);
  const displayRows = rows.filter((row) => isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, {
    classId: row.classId, subjectKey: row.subject, grade: row.grade,
  })).map((row) => ({ ...row, subject: subjectLabels.labelOf(row.subject) }));
  // 지난 수업이 '영상 과제 없음'이었던 학생 표시(0308a) — 원스크린과 같은 축(그 반의 **마지막 보고서**, 값 유무 무관).
  // 검사 대상에서 빼지는 않고 표시만(모름은 표시 없음).
  const lastAssigned = await getLastLessonAssignments(user.tenantId,
    displayRows.map((row) => ({ classId: row.classId, studentId: row.studentId })), checkDate, addDays(checkDate, -60));
  const displayHistory = history.map((row) => ({ ...row, subject: subjectLabels.labelOf(row.subject) }));
  return <main className="mx-auto w-full max-w-7xl space-y-4">
    <PageHeader eyebrow="수업보고서 · 학습 관리" title="영상 제출 현황"
      description="수업 날짜별 영상 제출 검사와 기간별 횟수를 확인합니다. 검사 대상은 보고서 설정에서 과목·학교급·반별로 지정합니다." />
    <FaceTabs faces={lessonReportFaces({ canOwner, canSend: canEdit,
      classnoteOn: isModuleEnabled(settings.modules.disabled, "classnote") })}
      active="video_homework" ariaLabel="수업보고서 면" />
    {!settings.report.videoHomeworkPolicy.enabled ? <p className="border-line bg-bg-soft rounded-lg border px-3 py-2 text-xs">
      영상 제출 검사가 꺼져 있습니다. 지난 검사 이력은 아래 기간별 집계에서 계속 확인할 수 있습니다.
    </p> : rows.length > displayRows.length ? <p className="border-line bg-bg-soft rounded-lg border px-3 py-2 text-xs">
      현재 설정으로 {rows.length - displayRows.length}건이 오늘 검사 대상에서 제외되었습니다. 지난 기록은 기간별 집계에 남습니다.
    </p> : null}
    <VideoHomeworkManagement rows={displayRows} marks={marks} history={displayHistory} lastAssigned={lastAssigned}
      checkDate={checkDate} fromDate={fromDate} toDate={toDate} today={today} canEdit={canEdit} />
  </main>;
}
