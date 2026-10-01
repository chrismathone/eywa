import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { PageHeader } from "@/components/page-header";
import { FaceTabs } from "@/components/face-tabs";
import { getVideoHomeworkLedger } from "@/features/video-homework/server/queries";
import { VideoHomeworkManagement } from "@/features/video-homework/components/video-homework-management";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { addDays, kstToday } from "@/lib/date-kst";
import { getLastLessonAssignments } from "@/features/video-homework/server/assignments";
import { isVideoHomeworkDate } from "@/features/video-homework/types";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import { lessonReportFaces } from "@/features/report-admin/lesson-report-faces";
import { isModuleEnabled } from "@/lib/modules";
import { classnoteReplyMode } from "@/features/owner/classnote-gate";
import { DEFAULT_LEDGER_FILTERS, ledgerPairKey, type LedgerFilters } from "@/features/video-homework/ledger";
import { isVideoHomeworkRange } from "@/features/video-homework/ledger-roster";

export const dynamic = "force-dynamic";
export const metadata = { title: "영상숙제 확인 · 에이와" };

export default async function VideoHomeworkPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAccess("lesson_reports");
  const params = await searchParams;
  const param = (name: string) => typeof params[name] === "string" ? params[name] as string : "";
  const requestedDate = param("date"), requestedFrom = param("from"), requestedTo = param("to");
  const today = kstToday();
  const checkDate = requestedDate && isVideoHomeworkDate(requestedDate) && requestedDate <= today ? requestedDate : today;
  const toDate = requestedTo && isVideoHomeworkDate(requestedTo) && requestedTo <= today ? requestedTo : checkDate;
  const requestedStart = requestedFrom && isVideoHomeworkDate(requestedFrom) && requestedFrom <= toDate
    ? requestedFrom : `${toDate.slice(0, 7)}-01`;
  const rangeTooLong = !isVideoHomeworkRange(requestedStart, toDate);
  const fromDate = rangeTooLong ? `${toDate.slice(0, 7)}-01` : requestedStart;
  const [{ rows, marks }, canEdit, canOwner, settings] = await Promise.all([
    getVideoHomeworkLedger(user.tenantId, fromDate, toDate),
    canWriteTenant(user.systemRole, "lesson_reports"),
    canWriteTenant(user.systemRole, "owner"),
    getTenantSettings(),
  ]);
  const subjectLabels = buildSubjectMaps(settings.operations.subjects);
  const recordedDates = new Map<string, string[]>();
  for (const mark of marks) {
    const key = ledgerPairKey(mark);
    const dates = recordedDates.get(key) ?? [];
    dates.push(mark.checkDate);
    recordedDates.set(key, dates);
  }
  const displayRows = rows.flatMap((row) => {
    const enabled = isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, {
      classId: row.classId, subjectKey: row.subject, grade: row.grade,
    });
    return enabled || recordedDates.has(ledgerPairKey(row))
      ? [{ ...row, subject: subjectLabels.labelOf(row.subject), editable: enabled && canEdit,
        // 대상에서 제외된 학생은 저장된 이력만 표시한다. 빈칸을 새 미확인 숙제로 세지 않는다.
        lessonDates: enabled ? row.lessonDates : [...(recordedDates.get(ledgerPairKey(row)) ?? [])].sort() }]
      : [];
  });
  const initialFilters: LedgerFilters = { ...DEFAULT_LEDGER_FILTERS,
    classId: param("class") || "all", subject: param("subject") || "all", school: param("school") || "all", grade: param("grade") || "all", query: param("q"),
    status: ["submitted", "missing", "unchecked"].includes(param("status")) ? param("status") as LedgerFilters["status"] : "all",
    sort: ["missing", "completion"].includes(param("sort")) ? param("sort") as LedgerFilters["sort"] : "name",
  };
  // 종료일 전 마지막 보고서의 과제 표시만 보존한다. 과거 회차나 검사 대상 여부는 바꾸지 않는다.
  const lastAssigned = await getLastLessonAssignments(user.tenantId, displayRows, toDate, addDays(toDate, -60));
  const ledgerRows = displayRows.map((row) => ({ ...row,
    lastAssignment: typeof lastAssigned[ledgerPairKey(row)] === "boolean"
      ? { beforeDate: toDate, assigned: lastAssigned[ledgerPairKey(row)] } : undefined,
  }));
  return <main className="w-full min-w-0 space-y-4">
    <PageHeader eyebrow="수업보고서 · 학습 관리" title="영상숙제 확인"
      description="반별 장부에서 학생별 회차·수업 날짜·수행 여부를 확인합니다." />
    <FaceTabs faces={lessonReportFaces({ canOwner, canSend: canEdit,
      classnoteOn: isModuleEnabled(settings.modules.disabled, "classnote"), replyOn: classnoteReplyMode(settings) !== "off" })}
      active="video_homework" ariaLabel="수업보고서 면" />
    {!settings.report.videoHomeworkPolicy.enabled ? <p className="border-line bg-bg-soft rounded-lg border px-3 py-2 text-xs">
      영상 제출 검사가 꺼져 있습니다. 지난 기록은 장부에서 읽기 전용으로 확인할 수 있습니다.
    </p> : rows.length > displayRows.length ? <p className="border-line bg-bg-soft rounded-lg border px-3 py-2 text-xs">
      현재 설정으로 {rows.length - displayRows.length}명·반이 검사 대상에서 제외되었습니다. 기존 기록은 장부에 남습니다.
    </p> : null}
    {rangeTooLong ? <p role="status" className="text-text-dim text-xs">한 번에 최대 366일을 조회할 수 있어 종료일이 속한 달을 표시했습니다.</p> : null}
    <VideoHomeworkManagement key={`${fromDate}:${toDate}`} rows={ledgerRows} initialMarks={marks}
      fromDate={fromDate} toDate={toDate} today={today} initialFilters={initialFilters} />
  </main>;
}
