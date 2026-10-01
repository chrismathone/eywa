import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { PageHeader } from "@/components/page-header";
import { FaceTabs } from "@/components/face-tabs";
import { getVideoHomeworkLedger } from "@/features/video-homework/server/ledger-queries";
import { VideoHomeworkManagement } from "@/features/video-homework/components/video-homework-management";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { kstToday } from "@/lib/date-kst";
import { parseMulti } from "@/lib/multi-value";
import { isVideoHomeworkDate } from "@/features/video-homework/types";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import { lessonReportFaces } from "@/features/report-admin/lesson-report-faces";
import { Suspense } from "react";
import { isModuleEnabled } from "@/lib/modules";
import { ManualDriveReviewNote } from "@/features/video-homework/components/manual-drive-review-note";
import { classnoteReplyMode } from "@/features/owner/classnote-gate";
import { DEFAULT_LEDGER_FILTERS, ledgerPairKey, type LedgerFilters } from "@/features/video-homework/ledger";
import { isVideoHomeworkRange } from "@/features/video-homework/ledger-roster";
import { buildLedgerRounds } from "@/features/video-homework/rounds";

export const dynamic = "force-dynamic";
export const metadata = { title: "영상숙제 확인 · 에이와" };

const NOTE = "border-line bg-bg-soft rounded-lg border px-3 py-2 text-xs";

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
  const [ledger, canEdit, canOwner, settings] = await Promise.all([
    getVideoHomeworkLedger(user.tenantId, fromDate, toDate),
    canWriteTenant(user.systemRole, "lesson_reports"),
    canWriteTenant(user.systemRole, "owner"),
    getTenantSettings(),
  ]);
  const subjectLabels = buildSubjectMaps(settings.operations.subjects);
  const candidates = ledger.rows.map((row) => {
    const tracked = isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, {
      classId: row.classId, subjectKey: row.subject, grade: row.grade,
    });
    return { ...row, subject: subjectLabels.labelOf(row.subject), tracked, editable: tracked && canEdit };
  });
  // 회차 = 숙제가 나간 날·기록(영상은 회차를 만들지 않으니 여기선 빼고 센다). 대상에서 제외된 학생은 기록만 회차다(rounds.ts).
  const rounds = buildLedgerRounds({ rows: candidates, marks: ledger.marks, videos: [], fromDate, toDate });
  // 대상 외 학생은 이 기간에 기록이 있을 때만 줄로 선다 — 새 미확인을 만들지 않는다.
  const displayRows = candidates.filter((row) => row.tracked || rounds.get(ledgerPairKey(row))?.length);
  // 기간 안에 회차가 하나도 없는 반은 세우지 않는다(숙제가 나간 날만 회차 — 원장 2026-10-01). 그 반 명단은 회차가 있는 반만.
  const activeClasses = new Set(displayRows.filter((row) => rounds.get(ledgerPairKey(row))?.length).map((row) => row.classId));
  const ledgerRows = displayRows.filter((row) => activeClasses.has(row.classId));
  const initialFilters: LedgerFilters = { ...DEFAULT_LEDGER_FILTERS,
    // 이 기간에 없는 반(다른 기간에서 골라 둔 반)은 버린다 — 버튼은 '전체 반'인데 목록이 비는 일이 없게.
    classIds: parseMulti(param("class"), "all").filter((id) => activeClasses.has(id)), subject: param("subject") || "all", school: param("school") || "all", grade: param("grade") || "all", query: param("q"),
    status: ["submitted", "missing", "unchecked"].includes(param("status")) ? param("status") as LedgerFilters["status"] : "all",
    sort: ["missing", "completion"].includes(param("sort")) ? param("sort") as LedgerFilters["sort"] : "name",
  };
  return <main className="w-full min-w-0 space-y-4">
    <PageHeader eyebrow="수업보고서 · 학습 관리" title="영상숙제 확인"
      description="숙제가 나간 수업을 학생별 회차로 세어 제출 여부를 확인합니다." />
    <FaceTabs faces={lessonReportFaces({ canOwner, canSend: canEdit,
      classnoteOn: isModuleEnabled(settings.modules.disabled, "classnote"), replyOn: classnoteReplyMode(settings) !== "off" })}
      active="video_homework" ariaLabel="수업보고서 면" />
    {/* 담임 폴더에 직접 올렸지만 세지 못한 영상(0324a) — ClassNote 기능이 꺼진 지점엔 흔적도 없게. */}
    {isModuleEnabled(settings.modules.disabled, "classnote") ? <Suspense fallback={null}><ManualDriveReviewNote tenantId={user.tenantId} /></Suspense> : null}
    {!settings.report.videoHomeworkPolicy.enabled ? <p className={NOTE}>
      영상 제출 검사가 꺼져 있습니다. 지난 기록은 장부에서 읽기 전용으로 확인할 수 있습니다.
    </p> : ledger.rows.length > displayRows.length ? <p className={NOTE}>
      현재 설정으로 {ledger.rows.length - displayRows.length}명·반이 검사 대상에서 제외되었습니다. 기존 기록은 장부에 남습니다.
    </p> : null}
    {!ledger.assignedKnown ? <p role="status" className={NOTE}>수업보고서의 영상 과제 표시를 읽지 못해 이미 찍은 기록만 보여 줍니다. 잠시 뒤 다시 열어 주세요.</p> : null}
    {!ledger.videosKnown ? <p role="status" className={NOTE}>학부모 영상 도착 기록을 읽지 못해 이번 화면에서는 영상 자동 집계를 뺐습니다.</p> : null}
    {rangeTooLong ? <p role="status" className="text-text-dim text-xs">한 번에 최대 366일을 조회할 수 있어 종료일이 속한 달을 표시했습니다.</p> : null}
    <VideoHomeworkManagement key={`${fromDate}:${toDate}`} rows={ledgerRows} initialMarks={ledger.marks} videos={ledger.videos}
      fromDate={fromDate} toDate={toDate} today={today} initialFilters={initialFilters} />
  </main>;
}
