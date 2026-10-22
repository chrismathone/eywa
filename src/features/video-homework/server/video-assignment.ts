"use server";

import { revalidatePath } from "next/cache";
import { reportError } from "@/lib/observability/report-error";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError, viewAsTeacher } from "@/lib/auth/view-mode";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";
import { homeworkVideoLinks } from "@/features/students/homework-videos";
import { isVideoHomeworkDate } from "../types";
import { isOtherSubjectVideo, isVideoAssignableToDate, VIDEO_ASSIGNMENT_WINDOW_DAYS, videoAssignmentRange, type VideoAssignmentOptions } from "../video-assignment";
import { reconcileVideoHomework } from "./reconcile-outcomes";
import { listExtraIssuesFor } from "./extra-issues";
import { keepMarkOnlyRound, releaseBlankRound } from "./keep-round";
import { checkBlankLessonDay, loadBlankLessonDates } from "./blank-lessons";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildHolidayMap } from "@/features/attendance/calendar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class AssignmentError extends Error {}
async function context(classId: string, studentId: string, period?: { fromDate: string; toDate: string }) {
  const user = await getCurrentUser();
  if (!user) throw new AssignmentError("로그인 후 다시 시도해 주세요.");
  const readonly = await readonlyTeacherViewError();
  if (readonly) throw new AssignmentError(readonly);
  if (!UUID.test(classId) || !UUID.test(studentId)) throw new AssignmentError("반과 학생을 확인해 주세요.");
  const full = await accessLevelTenant(user.systemRole, "lesson_reports") === "full";
  if (!full && !await canWriteTenant(user.systemRole, "teacher_onescreen")) throw new AssignmentError("영상 배정 권한이 없습니다.");
  const viewAs = await viewAsTeacher();
  const db = createAdminClient();
  const { data: cls, error } = await db.from("classes").select("teacher_id").eq("tenant_id", user.tenantId).eq("id", classId).maybeSingle();
  if (error) throw new AssignmentError("담당 반을 확인하지 못했습니다.");
  if (!cls || (!full && cls.teacher_id !== (viewAs?.id ?? user.id))) throw new AssignmentError("본인 담임 반의 영상만 배정할 수 있습니다.");
  const reportQuery = db.from("lesson_reports").select("report_date").eq("tenant_id", user.tenantId).eq("class_id", classId)
    .eq("student_id", studentId).eq("video_homework", true).order("report_date", { ascending: false });
  // 기간을 먼저 좁혀야 오래 다닌 학생의 과거 숙제가 최근 366건 제한에서 잘리지 않는다.
  if (period) reportQuery.gte("report_date", period.fromDate).lt("report_date", addDays(period.toDate, 1));
  // 검사 기록만 있는 숙제일 — 보고서에 '영상 과제' 표시 없이 선생님이 손으로 찍은 칸(원장 2026-10-14 *"수동 영상들 다 학생들이 업로드해서
  // 배정하고 싶은데 배정이 불가능함"*). 장부에 숙제 칸으로 서 있으니 영상도 붙일 수 있어야 한다 — 배정할 때 옮겨 남긴 숙제로 먼저 남긴다(아래).
  const markQuery = db.from("video_homework_marks").select("homework_date").eq("tenant_id", user.tenantId).eq("class_id", classId)
    .eq("student_id", studentId).not("homework_date", "is", null).order("homework_date", { ascending: false });
  if (period) markQuery.gte("homework_date", period.fromDate).lt("homework_date", addDays(period.toDate, 1));
  // 보고서 없이 따로 낸 숙제(extra-issues.ts)도 같은 숙제다 — 기간이 없으면(집계 제외) 있는지만 본다.
  const [reports, extra, marks] = await Promise.all([
    reportQuery.limit(period ? 366 : 1),
    listExtraIssuesFor(db, user.tenantId, { studentIds: [studentId], classIds: [classId],
      ...(period ? { fromDate: period.fromDate, toDate: period.toDate, limit: 366 } : { limit: 1 }) }).catch(() => null),
    markQuery.limit(period ? 366 : 1),
  ]);
  if (reports.error || extra === null || marks.error) throw new AssignmentError("학생의 영상 숙제를 읽지 못했습니다.");
  const issued = new Set([...(reports.data ?? []).map(r => String(r.report_date)), ...extra.map(issue => issue.date)]);
  const markOnly = new Set((marks.data ?? []).map(r => String(r.homework_date)).filter(date => !issued.has(date)));
  // 숙제가 없어도 돌려준다 — 숙제 0건 반에서도 숙제없음 수업일에 영상을 붙일 수 있다(원장 2026-10-22 ③). 고를 것이 없는지는 부른 쪽이 본다.
  const dates = [...new Set([...issued, ...markOnly])].sort().reverse();
  return { user, db, full, delegated: viewAs?.access === "full", dates, markOnly };
}

/** 학원 휴원일 — 숙제없음 수업일 판정(장부와 같은 설정 · issue-window `blankLessonError`). */
async function holidayCheck(): Promise<(date: string) => boolean> {
  const holidays = buildHolidayMap((await getTenantSettings()).operations.holidays);
  return (date) => date in holidays;
}

export async function getVideoAssignmentOptions(input: { classId: string; studentId: string; fromDate: string; toDate: string }): Promise<VideoAssignmentOptions> {
  if (!input || !isVideoHomeworkDate(input.fromDate) || !isVideoHomeworkDate(input.toDate) || input.fromDate > input.toDate
    || input.toDate > addDays(input.fromDate, 365)) return { ok: false, error: "조회 기간을 확인해 주세요." };
  try {
    // 숙제없음 수업일은 조회 시작 14일 전부터 — 기간 첫머리에 올린 영상이 기간 직전 수업의 숙제일 수 있다(칸이 영상을 받는 창 14일과 같다 ·
    // 안 그러면 월 경계에서 줄은 서는데 고를 날이 없다, 적대적 리뷰 2026-10-22). 숙제 날짜 목록은 종전대로 기간 안만.
    const blankFrom = addDays(input.fromDate, -VIDEO_ASSIGNMENT_WINDOW_DAYS);
    const { user, db, dates: allDates } = await context(input.classId, input.studentId, { fromDate: blankFrom, toDate: input.toDate });
    const dates = allDates.filter(date => date >= input.fromDate && date <= input.toDate);
    // 영상은 숙제일 · 숙제없음 수업일부터 14일 뒤까지 — 수업일은 영상과 함께 읽으므로 그 범위 전체를 잡는다(한 학생 치라 가볍다).
    const range = videoAssignmentRange([...dates, blankFrom, input.toDate])!;
    const [blankDates, videos, classes] = await Promise.all([
      holidayCheck().then(isHoliday => loadBlankLessonDates(db, user.tenantId, { classId: input.classId, studentId: input.studentId,
        fromDate: blankFrom, toDate: input.toDate, exclude: new Set(allDates), isHoliday })),
      fetchAllPaged<{
        id: string; posted_at: string; post_id: number | null; source: string; drive_file_id: string | null;
        uploaded_at: string | null; route: unknown; assignment_revision: number; subject: string | null;
      }>((from, to) => db.from("homework_video_ledger_videos").select("id,posted_at,post_id,source,drive_file_id,uploaded_at,route,assignment_revision,subject")
        .eq("tenant_id", user.tenantId).eq("student_id", input.studentId).eq("status", "uploaded")
        .not("drive_file_id", "is", null)
        .gte("posted_at", `${range.from}T00:00:00+09:00`).lt("posted_at", `${addDays(range.to, 1)}T00:00:00+09:00`)
        .order("posted_at", { ascending: false }).order("id").range(from, to)),
      fetchAllPaged<{ id: string; class_name: string; subject: string | null }>((from, to) =>
        db.from("classes").select("id,class_name,subject").eq("tenant_id", user.tenantId).order("id").range(from, to)),
    ]);
    const byClass = new Map(classes.map(c => [c.id, c]));
    const targetSubject = byClass.get(input.classId)?.subject ?? null;
    const routeOf = (v: { route: unknown }) => (v.route && typeof v.route === "object" ? v.route as Record<string, unknown> : {});
    // 확실히 다른 과목인 영상은 목록에 세우지 않는다(원장 2026-10-13) — 반을 모르는 영상은 그대로 보인다.
    const sameSubject = videos.filter(v => !isOtherSubjectVideo({ classSubject: byClass.get(String(routeOf(v).classId))?.subject, subject: v.subject }, targetSubject));
    const targets = [...dates, ...blankDates];
    return { ok: true, dates, blankDates, videos: sameSubject.filter(v => targets.some(date => isVideoAssignableToDate(v.posted_at, date))).map(v => {
      const route = routeOf(v);
      const links = homeworkVideoLinks(v.drive_file_id);
      return { id: String(v.id), postedAt: String(v.posted_at), className: byClass.get(String(route.classId))?.class_name ?? null,
        classId: typeof route.classId === "string" ? route.classId : null,
        homeworkDate: typeof route.homeworkDate === "string" ? route.homeworkDate : null, source: v.source === "link" ? "제출 링크" : "ClassNote / Drive",
        note: typeof route.note === "string" && route.note.trim() ? route.note.trim().slice(0, 100) : null, free: route.free === true,
        postId: typeof v.post_id === "number" ? v.post_id : null, revision: Number(v.assignment_revision), excluded: route.excluded === true,
        playback: links ? { ...links, uploadedAt: v.uploaded_at as string | null } : null };
    }) };
  } catch (e) { return { ok: false, error: e instanceof AssignmentError ? e.message : "영상 목록을 읽지 못했습니다." }; }
}

export async function assignHomeworkVideo(input: { classId: string; studentId: string; videoId: string; homeworkDate: string | null; excluded: boolean; revision: number; reason: string }): Promise<{ ok: boolean; error?: string }> {
  if (!input || !UUID.test(input.videoId) || typeof input.excluded !== "boolean" || !Number.isInteger(input.revision) || input.revision < 0
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 300
    || (!input.excluded && (!input.homeworkDate || !isVideoHomeworkDate(input.homeworkDate)))) return { ok: false, error: "영상·숙제 날짜와 변경 사유를 확인해 주세요." };
  // 숙제없음 수업일에 방금 세운 줄 — 배정이 저장되지 않으면(실패 · 예외) 거둔다: 영상 없는 칸(미확인)이 새로 남지 않게(keep-round.ts `releaseBlankRound`).
  let release = async () => {};
  try {
    const { user, db, full, delegated, dates, markOnly } = await context(input.classId, input.studentId,
      input.excluded ? undefined : { fromDate: input.homeworkDate!, toDate: input.homeworkDate! });
    // 집계 제외는 이 반에 영상 숙제가 하나라도 있어야 저장된다(DB 함수가 그 반의 숙제로 담당을 확인한다).
    if (input.excluded && !dates.length) return { ok: false, error: "이 학생에게 낸 이 반 영상 숙제가 없어 집계 제외를 저장할 수 없습니다. 숙제없음 수업일에 붙여 주세요." };
    // 숙제가 없는 날 = 숙제없음 수업일(③, 원장 2026-10-22 '숙제없음 칸에 바로 배정')이어야 한다 — 그 학생이 그 반 수업을 들은 날.
    // 장부 칸 · 배정 창과 같은 판정으로 다시 본다(화면이 보낸 날짜를 믿지 않는다). 출제 기한(다음 수업 전)은 보지 않는다.
    const blank = !input.excluded && !dates.includes(input.homeworkDate!);
    if (blank) {
      const problem = await checkBlankLessonDay(db, user.tenantId, { classId: input.classId, studentId: input.studentId,
        date: input.homeworkDate!, isHoliday: await holidayCheck() });
      if (problem) return { ok: false, error: problem };
    }
    if (input.excluded && delegated && !full) {
      // 대리 편집도 선택한 강사 반의 영상만 제외한다. RPC에 실제 편집자를 남기기 전에 같은 범위를 검사한다.
      const video = await db.from("homework_video_ledger_videos").select("route")
        .eq("tenant_id", user.tenantId).eq("student_id", input.studentId).eq("id", input.videoId).maybeSingle();
      const route = video.data?.route as { classId?: string } | null;
      if (video.error || route?.classId !== input.classId) return { ok: false, error: "이 영상의 배정을 변경할 권한이 없습니다." };
    }
    if (!input.excluded) {
      const video = await db.from("homework_video_ledger_videos").select("posted_at,subject,route,assignment_revision")
        .eq("tenant_id", user.tenantId).eq("student_id", input.studentId).eq("id", input.videoId).eq("status", "uploaded")
        .not("drive_file_id", "is", null).maybeSingle();
      if (video.error) return { ok: false, error: "영상의 게시일을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
      if (!video.data) return { ok: false, error: "업로드가 완료된 학생 영상만 배정할 수 있습니다." };
      // 숙제없음 수업일도 같은 창이다(칸은 숙제일 + 14일까지만 영상을 받는다) — 그 수업보다 먼저 올린 영상은 그 수업의 숙제일 수 없다.
      if (!isVideoAssignableToDate(video.data.posted_at, input.homeworkDate!)) return { ok: false, error: blank
        ? "그 수업일부터 14일 뒤까지 게시된 영상만 붙일 수 있습니다." : "숙제를 낸 날부터 14일 뒤까지 게시된 영상만 배정할 수 있습니다." };
      // 목록과 같은 판정 — 확실히 다른 과목 영상은 이 반 숙제에 붙이지 않는다(목록에 없는 영상을 주소로 보내도).
      const videoClass = (video.data.route as { classId?: unknown } | null)?.classId;
      const subjects = await db.from("classes").select("id,subject").eq("tenant_id", user.tenantId)
        .in("id", [input.classId, ...(typeof videoClass === "string" && /^[0-9a-f-]{36}$/i.test(videoClass) ? [videoClass] : [])]);
      if (subjects.error) return { ok: false, error: "영상의 과목을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
      const subjectOf = new Map((subjects.data ?? []).map((c) => [c.id as string, c.subject as string | null]));
      if (isOtherSubjectVideo({ classSubject: typeof videoClass === "string" ? subjectOf.get(videoClass) : null, subject: video.data.subject as string | null }, subjectOf.get(input.classId)))
        return { ok: false, error: "다른 과목 영상은 이 반 숙제에 배정할 수 없습니다." };
      // 검사 기록만 있는 숙제일 — DB 함수는 보고서 표시나 따로 낸 숙제만 숙제로 받는다. 그 칸을 옮겨 남긴 숙제로 먼저 남긴다(keep-round.ts:
      // 판정·알림에는 안 들고 칸·손 배정에서만 숙제다). 손 기록(완료 등)은 그대로 둔다 — 붙은 영상이 ▶로 보인다.
      if (markOnly.has(input.homeworkDate!)) {
        const keep = await keepMarkOnlyRound(db, user.tenantId, user.id, { classId: input.classId, studentId: input.studentId, date: input.homeworkDate! });
        if (keep !== "kept" && keep !== "assigned") return { ok: false, error: "이 숙제 칸을 영상을 붙일 수 있게 남기지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
        // 🔴 배정이 실패해도 남긴 줄은 거두지 않는다 — 거두는 사이 다른 창이 그 칸을 미확인으로 지우면 칸이 통째로 사라진다(재리뷰 2026-10-14).
        //    남은 줄은 칸을 지킬 뿐이다(판정·알림에 안 든다 — 미확인으로 바꿀 때 생기는 줄과 같다).
      }
      // 숙제없음 수업일 — 그날을 옮겨 남긴 숙제(keep-round.ts)로 세운 뒤 붙인다: 판정·미제출 알림에 들지 않고 칸 · 손 배정에서만 숙제라
      // 새 미확인 · 미수행이 생기지 않는다(이 영상이 붙어 바로 완료다). 정식 숙제로 세우면 다른 칸의 영상을 가져간다(keep-round.ts 머리 주석).
      if (blank) {
        // 줄을 남기기 전에 버전부터 본다 — 그사이 다른 곳에서 이 영상 배정을 바꿨으면 줄 없이 끝낸다(남은 줄 = 영상 없는 칸).
        if (Number(video.data.assignment_revision ?? 0) !== input.revision) return { ok: false, error: "다른 곳에서 영상 배정이 변경됐습니다. 창을 닫고 다시 열어 확인해 주세요." };
        const keep = await keepMarkOnlyRound(db, user.tenantId, user.id, { classId: input.classId, studentId: input.studentId, date: input.homeworkDate! }, { source: "blank_lesson" });
        if (keep !== "kept" && keep !== "assigned") return { ok: false, error: "이 수업을 영상 숙제 칸으로 남기지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
        // 원래 있던 줄('assigned' — 그사이 다른 창이 세웠다)은 거두지 않는다.
        if (keep === "kept") release = () => releaseBlankRound(db, user.tenantId, { classId: input.classId, studentId: input.studentId, date: input.homeworkDate! });
      }
    }
    const { data, error } = await db.rpc("set_homework_video_assignment", {
      // 대상의 담당 반은 위에서 검증했다. 실제 편집자의 id를 대상 강사 id로 바꾸지 않는다.
      p_tenant: user.tenantId, p_actor: user.id, p_full: full || delegated, p_student: input.studentId, p_context_class: input.classId,
      p_video: input.videoId, p_date: input.excluded ? null : input.homeworkDate, p_excluded: input.excluded, p_revision: input.revision, p_reason: input.reason.trim(),
    });
    if (error) { await release(); return { ok: false, error: "영상 배정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }; }
    const errors: Record<string, string> = { conflict: "다른 곳에서 영상 배정이 변경됐습니다. 창을 닫고 다시 열어 확인해 주세요.", denied: "이 영상의 배정을 변경할 권한이 없습니다.", unavailable: "업로드가 완료된 학생 영상만 배정할 수 있습니다.", invalid_homework: "해당 학생에게 실제로 낸 영상 숙제를 골라 주세요." };
    if (data !== "saved") { await release(); return { ok: false, error: errors[String(data)] ?? "영상 배정 정보를 확인해 주세요." }; }
    // 응답 전에 끝낸다 — `after()`로 미루면 저장 응답이 다시 그린 장부에 판정 전 '미수행'이 남아 배정한 칸이 새로고침 전까지
    // 안 바뀌었다(원장 2026-10-14 *"배정하고도 안바뀌길래 안된줄 알았더니 새로고침하니까 되네"*). 실패해도 배정은 저장됐다(정기 확인이 맞춘다).
    try { await reconcileVideoHomework(user.tenantId, { studentId: input.studentId }); }
    catch (error) { reportError(error, { scope: "video-homework.after-assignment", tenantId: user.tenantId }); }
    revalidatePath("/onescreen/video-homework"); revalidatePath("/lesson-reports/video-homework"); revalidatePath(`/students/${input.studentId}`);
    return { ok: true };
  } catch (e) {
    await release();
    return { ok: false, error: e instanceof AssignmentError ? e.message : "영상 배정을 저장하지 못했습니다." };
  }
}
