import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant, getPermMatrix } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId, getShellView, viewAsTeacher } from "@/lib/auth/view-mode";
import { roleHome } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getVideoHomeworkLedger } from "@/features/video-homework/server/ledger-queries";
import { getOwnVideoHomework } from "@/features/video-homework/server/own-homework";
import { VideoHomeworkManagement } from "@/features/video-homework/components/video-homework-management";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import { keepLedgerRounds, ledgerPairKey, ownRoundKey } from "@/features/video-homework/ledger";
import { ledgerInitialFilters, ledgerPeriod } from "@/features/video-homework/ledger-period";
import { buildLedgerRounds } from "@/features/video-homework/rounds";

export const dynamic = "force-dynamic";
export const metadata = { title: "영상 제출 현황 · 에이와" };

const NOTE = "border-line bg-bg-soft rounded-lg border px-3 py-2 text-xs";

/**
 * 강사뷰 '영상 제출 현황' — 관리자 화면(`/lesson-reports/video-homework`)과 **같은 장부**를, 내가 낸 영상 숙제만 보이게 연다.
 * 원장 2026-10-03 *"강사뷰에 새 매뉴 추가. 영상 제출 현황을 내가 출제한것만 확인가능하게 … 기존 영상 제출 현황을 활용하도록"* ·
 * *"관리자뷰에서는 모두가 보이지만, 각 강사뷰에서는 내가 출제한것만"* · *"강사뷰에서도 수동 체크. 관리자와 동일하게 스스로 낸 숙제만 체크 하게"*.
 *  · ⚠️ 게이트는 원스크린과 같은 **뷰 기준**(실 강사 · 겸직 강사뷰 · '다른 강사 뷰') — `teacher_onescreen`은 관리자 계열 역할이 none이라
 *    `requireAccess`로 막으면 겸직이 튕긴다(원스크린 page.tsx와 같은 이유).
 *  · 내가 낸 숙제 = 보고서 작성 계정(`created_by`)이 나이고 '영상 과제 있음'인 수업(`getOwnVideoHomework`). '다른 강사 뷰'(열람 전용)면
 *    그 강사가 낸 숙제를 보고(`effectiveTeacherId`), 체크는 열지 않는다.
 *  · 🔴 판정은 관리자 화면과 같다 — 그 반 × 학생의 숙제·기록·영상을 **전부** 넘겨 짝을 지은 뒤 내가 낸 칸만 세운다(`keepRounds`).
 *    ⚠️ 그래서 같은 반 × 학생의 남이 낸 숙제 날짜·기록도 화면 재료로 내려간다(그 칸은 안 그린다 — 판정을 관리자 화면과 같게 하려는 대가).
 *  · 체크 = 관리자 화면과 같은 칸 편집(`setVideoHomeworkRound`) — 서버가 "내가 낸 숙제인가"를 다시 확인한다(`ledgerRoundWriteError`).
 */
export default async function TeacherVideoHomeworkPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if ((await getShellView()) !== "teacher") redirect(roleHome(user.systemRole, await getPermMatrix()));
  const params = await searchParams;
  const param = (name: string) => typeof params[name] === "string" ? params[name] as string : "";
  const today = kstToday();
  const { fromDate, toDate, rangeTooLong } = ledgerPeriod(param, today);
  const [owner, viewAs] = await Promise.all([effectiveTeacherId(), viewAsTeacher()]);
  // 내가 낸 숙제를 먼저 읽는다 — 장부는 그 반 × 학생만 명단·영상·출결을 읽는다(지점 전체를 강사 폰으로 읽지 않게, B7).
  const own = await getOwnVideoHomework(createAdminClient(), user.tenantId, owner ?? user.id, fromDate, toDate).catch((e: unknown) => {
    console.warn(JSON.stringify({ level: "warn", scope: "videoHomework.teacherLedger", message: e instanceof Error ? e.message : "unknown" }));
    return null;
  });
  const ownPairs = new Set((own ?? []).map((row) => ledgerPairKey(row)));
  const keepRounds = (own ?? []).map((row) => ownRoundKey(row, row.date));
  const [ledger, canTeacherWrite, lessonReportsLevel, settings, ownedClasses] = await Promise.all([
    getVideoHomeworkLedger(user.tenantId, fromDate, toDate, { pairs: ownPairs }),
    canWriteTenant(user.systemRole, "teacher_onescreen"),
    accessLevelTenant(user.systemRole, "lesson_reports"),
    getTenantSettings(),
    createAdminClient().from("classes").select("id").eq("tenant_id", user.tenantId).eq("teacher_id", owner ?? user.id),
  ]);
  // 체크 = 서버 판정과 같은 조건(강사 쓰기 또는 수업보고서 전체 권한 — 겸직) · '다른 강사 뷰'는 열람 전용.
  const canEdit = viewAs?.access !== "readonly" && (canTeacherWrite || lessonReportsLevel === "full");
  const subjectLabels = buildSubjectMaps(settings.operations.subjects);
  // 줄 = 내가 낸 숙제가 있는 반 × 학생 — 그 줄의 숙제일은 **남이 낸 것까지 전부** 둔다(영상 짝을 관리자 화면과 같게 짓기 위해).
  const candidates = ledger.rows.filter((row) => ownPairs.has(ledgerPairKey(row))).map((row) => {
    const tracked = isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, { classId: row.classId, subjectKey: row.subject, grade: row.grade });
    return { ...row, subject: subjectLabels.labelOf(row.subject), tracked, editable: tracked && canEdit,
      canAssignVideos: canEdit && (lessonReportsLevel === "full" || !!ownedClasses.data?.some(cls => cls.id === row.classId)) };
  });
  const marks = ledger.marks.filter((mark) => ownPairs.has(ledgerPairKey(mark)));
  const videos = ledger.videos.filter((video) => !!video.classId && ownPairs.has(ledgerPairKey({ classId: video.classId, studentId: video.studentId })));
  // 대상 외 학생은 이 기간에 내 칸 기록이 있을 때만 줄로 선다 — 관리자 화면과 같은 규칙(영상은 회차를 만들지 않으니 빼고 센다).
  const draft = keepLedgerRounds(buildLedgerRounds({ rows: candidates, marks, videos: [], fromDate, toDate }), new Set(keepRounds));
  const rows = candidates.filter((row) => row.tracked || draft.get(ledgerPairKey(row))?.length);
  const shown = new Set(rows.map((row) => ledgerPairKey(row)));
  const blankFacts = Object.fromEntries(Object.entries(ledger.blankFacts).filter(([pair]) => shown.has(pair)));
  const initialFilters = ledgerInitialFilters(param, new Set(rows.map((row) => row.classId)));
  return <main className="w-full min-w-0 space-y-4">
    <PageHeader eyebrow="강사뷰" title="영상 제출 현황" description="내가 '영상 과제 있음'으로 낸 수업만 학생별 회차로 셉니다." />
    {own === null ? <p role="status" className={NOTE}>내가 낸 영상 숙제를 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.</p> : null}
    {!settings.report.videoHomeworkPolicy.enabled ? <p className={NOTE}>
      영상 제출 검사가 꺼져 있습니다. 지난 기록은 장부에서 읽기 전용으로 확인할 수 있습니다.
    </p> : candidates.length > rows.length ? <p className={NOTE}>
      현재 설정으로 {candidates.length - rows.length}명·반이 검사 대상에서 제외되었습니다. 기존 기록은 장부에 남습니다.
    </p> : null}
    {!ledger.assignedKnown ? <p role="status" className={NOTE}>수업보고서의 영상 과제 표시를 읽지 못해 이미 찍은 기록만 보여 줍니다. 잠시 뒤 다시 열어 주세요.</p> : null}
    {!ledger.videosKnown ? <p role="status" className={NOTE}>학부모 영상 도착 기록을 읽지 못해 이번 화면에서는 영상 자동 집계를 뺐습니다.</p> : null}
    {canEdit && !ledger.assignmentVideosKnown ? <p role="status" className={NOTE}>배정할 영상 목록을 확인하지 못했습니다. 잠시 뒤 새로고침해 주세요.</p> : null}
    {rangeTooLong ? <p role="status" className="text-text-dim text-xs">한 번에 최대 366일을 조회할 수 있어 종료일이 속한 달을 표시했습니다.</p> : null}
    <VideoHomeworkManagement key={`${fromDate}:${toDate}`} rows={rows} initialMarks={marks.filter((mark) => shown.has(ledgerPairKey(mark)))}
      videos={videos.filter((video) => shown.has(ledgerPairKey({ classId: video.classId!, studentId: video.studentId })))} blankFacts={blankFacts}
      videosKnown={ledger.videosKnown} fromDate={fromDate} toDate={toDate} today={today} initialFilters={initialFilters} keepRounds={keepRounds} />
  </main>;
}
