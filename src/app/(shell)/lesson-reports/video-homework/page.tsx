import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant, canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { isFeatureLicensed } from "@/lib/license/server";
import { PageHeader } from "@/components/page-header";
import { FaceTabs } from "@/components/face-tabs";
import { getVideoHomeworkLedger } from "@/features/video-homework/server/ledger-queries";
import { VideoHomeworkManagement } from "@/features/video-homework/components/video-homework-management";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { kstToday } from "@/lib/date-kst";
import { isVideoHomeworkClassEnabled, isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import { lessonReportFaces } from "@/features/report-admin/lesson-report-faces";
import { Suspense } from "react";
import { isModuleEnabled } from "@/lib/modules";
import { ManualDriveReviewNote } from "@/features/video-homework/components/manual-drive-review-note";
import { classnoteReplyMode } from "@/features/owner/classnote-gate";
import { ledgerPairKey, ownRoundKey } from "@/features/video-homework/ledger";
import { listVideoHomeworkIssues } from "@/features/video-homework/server/own-homework";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { ledgerInitialFilters, ledgerPeriod } from "@/features/video-homework/ledger-period";
import { buildLedgerRounds } from "@/features/video-homework/rounds";
import { buildHolidayMap } from "@/features/attendance/calendar";

export const dynamic = "force-dynamic";
export const metadata = { title: "영상숙제 확인 · 에이와" };

const NOTE = "border-line bg-bg-soft rounded-lg border px-3 py-2 text-xs";

const warnTeacherFilter = (e: unknown) =>
  console.warn(JSON.stringify({ level: "warn", scope: "videoHomework.teacherFilter", message: e instanceof Error ? e.message : "unknown" }));

/**
 * 강사 필터 재료 — 숙제를 낸 사람 판정(강사뷰와 같은 `listVideoHomeworkIssues`)과 그 사람들의 표시 이름. 이름은 판정이 끝나는 대로
 * 이어서 읽는다(장부 조회와 나란히, B4). 둘 중 하나라도 못 읽으면 null — 필터만 빠지고 장부는 그대로다.
 */
async function loadIssuers(tenantId: string, fromDate: string, toDate: string) {
  const db = createAdminClient();
  const issues = await listVideoHomeworkIssues(db, tenantId, fromDate, toDate);
  const ids = [...new Set(issues.flatMap((issue) => issue.teacherIds))];
  const users = await fetchInChunks<{ id: string; display_name: string | null }>(ids, (chunk) =>
    db.from("users").select("id,display_name").eq("tenant_id", tenantId).in("id", chunk));
  return { issues, names: new Map(users.flatMap((u) => (u.display_name?.trim() ? [[u.id, u.display_name.trim()] as const] : []))) };
}

export default async function VideoHomeworkPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAccess("lesson_reports");
  const params = await searchParams;
  const param = (name: string) => typeof params[name] === "string" ? params[name] as string : "";
  const today = kstToday();
  const { fromDate, toDate, rangeTooLong } = ledgerPeriod(param, today);
  // 숙제 0건 반 — 휴원일은 수업일에서 빼고(배정 창과 같은 판정) 검사 대상 밖 반은 읽지 않는다. 설정은 지점 캐시라 장부 조회 안에서 읽는다.
  const ledgerRead = getTenantSettings().then((s) => {
    const holidays = buildHolidayMap(s.operations.holidays);
    return getVideoHomeworkLedger(user.tenantId, fromDate, toDate, undefined, { isHoliday: (date) => date in holidays,
      classTracked: (classId, subjectKey) => isVideoHomeworkClassEnabled(s.report.videoHomeworkPolicy, { classId, subjectKey }) });
  });
  const [ledger, canSend, lessonReportsLevel, canReportSettings, canAiMent, aiOn, settings, issuers] = await Promise.all([
    ledgerRead,
    canWriteTenant(user.systemRole, "lesson_reports"),
    accessLevelTenant(user.systemRole, "lesson_reports"),
    canAccessTenant(user.systemRole, "report_settings"),
    canAccessTenant(user.systemRole, "ai_ment"),
    isFeatureLicensed(user.tenantId, "ai_analysis"),
    getTenantSettings(),
    loadIssuers(user.tenantId, fromDate, toDate).catch((e: unknown) => { warnTeacherFilter(e); return null; }),
  ]);
  // 칸 편집 = 수업보고서 전체 권한(서버 ledgerRoundWriteError와 같다 — 담당 권한은 강사뷰에서 자기가 낸 숙제만 찍는다).
  const canEdit = lessonReportsLevel === "full";
  const subjectLabels = buildSubjectMaps(settings.operations.subjects);
  const policy = settings.report.videoHomeworkPolicy;
  // 숙제 0건 반의 줄(①)은 검사 대상만 — 대상 밖이면 알림도 없는 영상이다('검사 대상에서 제외' 안내 수에도 넣지 않는다).
  const candidates = ledger.rows.map((row) => {
    const tracked = isVideoHomeworkEnabled(policy, {
      classId: row.classId, subjectKey: row.subject, grade: row.grade,
    });
    return { ...row, subject: subjectLabels.labelOf(row.subject), tracked, editable: tracked && canEdit, canAssignVideos: canEdit };
  }).filter((row) => row.tracked || !row.lessonDates);
  // 회차 = 숙제가 나간 날·기록(영상은 회차를 만들지 않으니 여기선 빼고 센다). 대상에서 제외된 학생은 기록만 회차다(rounds.ts).
  const rounds = buildLedgerRounds({ rows: candidates, marks: ledger.marks, videos: [], fromDate, toDate });
  // 대상 외 학생은 이 기간에 기록이 있을 때만 줄로 선다 — 새 미확인을 만들지 않는다.
  const displayRows = candidates.filter((row) => row.tracked || rounds.get(ledgerPairKey(row))?.length);
  // 기간 안에 회차가 하나도 없는 반은 세우지 않는다(숙제가 나간 날만 회차 — 원장 2026-10-01). 그 반 명단은 회차가 있는 반만.
  // 예외 = 숙제 0건 반에서 붙지 않은 영상이 있는 학생의 줄(①, 원장 2026-10-22) — 그 학생만 선다(반 명단은 아니다).
  const activeClasses = new Set(displayRows.filter((row) => rounds.get(ledgerPairKey(row))?.length).map((row) => row.classId));
  const ledgerRows = displayRows.filter((row) => activeClasses.has(row.classId) || !!row.lessonDates);
  // ② 검색 전용 — 숙제 0건 반의 수강생(검사 대상만). 줄이 아니라 화면이 검색어와 맞을 때만 "숙제가 없는 반"으로 알린다.
  const idleRoster = ledger.idleRoster.filter((entry) => isVideoHomeworkEnabled(policy, { classId: entry.classId, subjectKey: entry.subject, grade: entry.grade }))
    .map((entry) => ({ ...entry, subject: subjectLabels.labelOf(entry.subject) }));
  // 강사 필터(원장 2026-10-14 *"숙제 제출 현황에서 강사 필터링 가능하게 … 관리자뷰에서"*) — 강사 → 그 강사가 낸 칸.
  // 보이는 줄의 칸만, 이름을 아는 강사만 싣는다(선택지에 못 서는 id는 화면으로 내려보내지 않는다). 고르면 그 강사의 강사뷰와
  // 같은 칸이 선다(열쇠가 같다).
  const shownPairs = new Set(ledgerRows.map((row) => ledgerPairKey(row)));
  const teacherRounds: Record<string, string[]> = {};
  for (const issue of issuers?.issues ?? []) {
    if (!shownPairs.has(ledgerPairKey(issue))) continue;
    for (const id of issue.teacherIds) if (issuers!.names.has(id)) (teacherRounds[id] ??= []).push(ownRoundKey(issue, issue.date));
  }
  const teacherOptions = Object.keys(teacherRounds).map((id) => ({ value: id, label: issuers!.names.get(id)! }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
  const initialFilters = ledgerInitialFilters(param, activeClasses, new Set(teacherOptions.map((option) => option.value)));
  return <main className="w-full min-w-0 space-y-4">
    <PageHeader eyebrow="수업보고서 · 학습 관리" title="영상숙제 확인"
      description="숙제가 나간 수업을 학생별 회차로 세어 제출 여부를 확인합니다." />
    <FaceTabs faces={lessonReportFaces({ canReportSettings, canAiMent, aiOn, canSend,
      classnoteOn: isModuleEnabled(settings.modules.disabled, "classnote"), replyOn: classnoteReplyMode(settings) !== "off" })}
      active="video_homework" ariaLabel="수업보고서 면" />
    {/* 담임 폴더에 직접 올렸지만 세지 못한 영상(0324a) — ClassNote 기능이 꺼진 지점엔 흔적도 없게. */}
    {isModuleEnabled(settings.modules.disabled, "classnote") ? <Suspense fallback={null}><ManualDriveReviewNote tenantId={user.tenantId} /></Suspense> : null}
    {!settings.report.videoHomeworkPolicy.enabled ? <p className={NOTE}>
      영상 제출 검사가 꺼져 있습니다. 지난 기록은 장부에서 읽기 전용으로 확인할 수 있습니다.
    </p> : candidates.length > displayRows.length ? <p className={NOTE}>
      현재 설정으로 {candidates.length - displayRows.length}명·반이 검사 대상에서 제외되었습니다. 기존 기록은 장부에 남습니다.
    </p> : null}
    {!ledger.assignedKnown ? <p role="status" className={NOTE}>수업보고서의 영상 과제 표시를 읽지 못해 이미 찍은 기록만 보여 줍니다. 잠시 뒤 다시 열어 주세요.</p> : null}
    {!ledger.videosKnown ? <p role="status" className={NOTE}>학부모 영상 도착 기록을 읽지 못해 이번 화면에서는 영상 자동 집계를 뺐습니다.</p> : null}
    {canEdit && !ledger.assignmentVideosKnown ? <p role="status" className={NOTE}>배정할 영상 목록을 확인하지 못했습니다. 잠시 뒤 새로고침해 주세요.</p> : null}
    {rangeTooLong ? <p role="status" className="text-text-dim text-xs">한 번에 최대 366일을 조회할 수 있어 종료일이 속한 달을 표시했습니다.</p> : null}
    <VideoHomeworkManagement key={`${fromDate}:${toDate}`} rows={ledgerRows} initialMarks={ledger.marks} videos={ledger.videos} blankFacts={ledger.blankFacts} videosKnown={ledger.videosKnown}
      fromDate={fromDate} toDate={toDate} today={today} initialFilters={initialFilters} showTeacher
      teacherRounds={teacherRounds} teacherOptions={teacherOptions} idleRoster={idleRoster} />
  </main>;
}
