"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";
import { homeworkVideoLinks } from "@/features/students/homework-videos";
import { isVideoHomeworkDate } from "../types";
import { isVideoAssignableToDate, videoAssignmentRange, type VideoAssignmentOptions } from "../video-assignment";

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
  const db = createAdminClient();
  const { data: cls, error } = await db.from("classes").select("teacher_id").eq("tenant_id", user.tenantId).eq("id", classId).maybeSingle();
  if (error) throw new AssignmentError("담당 반을 확인하지 못했습니다.");
  if (!cls || (!full && cls.teacher_id !== user.id)) throw new AssignmentError("본인 담임 반의 영상만 배정할 수 있습니다.");
  const reportQuery = db.from("lesson_reports").select("report_date").eq("tenant_id", user.tenantId).eq("class_id", classId)
    .eq("student_id", studentId).eq("video_homework", true).order("report_date", { ascending: false });
  // 기간을 먼저 좁혀야 오래 다닌 학생의 과거 숙제가 최근 366건 제한에서 잘리지 않는다.
  if (period) reportQuery.gte("report_date", period.fromDate).lt("report_date", addDays(period.toDate, 1));
  const reports = await reportQuery.limit(period ? 366 : 1);
  if (reports.error) throw new AssignmentError("학생의 영상 숙제를 읽지 못했습니다.");
  if (!reports.data?.length) throw new AssignmentError("이 반에 배정할 영상 숙제가 없습니다.");
  return { user, db, full, dates: [...new Set(reports.data.map(r => String(r.report_date)))] };
}

export async function getVideoAssignmentOptions(input: { classId: string; studentId: string; fromDate: string; toDate: string }): Promise<VideoAssignmentOptions> {
  if (!input || !isVideoHomeworkDate(input.fromDate) || !isVideoHomeworkDate(input.toDate) || input.fromDate > input.toDate
    || input.toDate > addDays(input.fromDate, 365)) return { ok: false, error: "조회 기간을 확인해 주세요." };
  try {
    const { user, db, dates: allDates } = await context(input.classId, input.studentId, input);
    const dates = allDates.filter(date => date >= input.fromDate && date <= input.toDate);
    const range = videoAssignmentRange(dates);
    if (!range) return { ok: true, dates, videos: [] };
    const videos = await fetchAllPaged<{
      id: string; posted_at: string; post_id: number | null; source: string; drive_file_id: string | null;
      uploaded_at: string | null; route: unknown; assignment_revision: number;
    }>((from, to) => db.from("homework_video_ledger_videos").select("id,posted_at,post_id,source,drive_file_id,uploaded_at,route,assignment_revision")
      .eq("tenant_id", user.tenantId).eq("student_id", input.studentId).eq("status", "uploaded")
      .not("drive_file_id", "is", null)
      .gte("posted_at", `${range.from}T00:00:00+09:00`).lt("posted_at", `${addDays(range.to, 1)}T00:00:00+09:00`)
      .order("posted_at", { ascending: false }).order("id").range(from, to));
    const classes = await db.from("classes").select("id,class_name").eq("tenant_id", user.tenantId);
    if (classes.error) return { ok: false, error: "영상의 반을 확인하지 못했습니다." };
    const names = new Map((classes.data ?? []).map(c => [c.id, c.class_name]));
    return { ok: true, dates, videos: videos.filter(v => dates.some(date => isVideoAssignableToDate(v.posted_at, date))).map(v => {
      const route = v.route && typeof v.route === "object" ? v.route as Record<string, unknown> : {};
      const links = homeworkVideoLinks(v.drive_file_id);
      return { id: String(v.id), postedAt: String(v.posted_at), className: names.get(route.classId) ?? null,
        homeworkDate: typeof route.homeworkDate === "string" ? route.homeworkDate : null, source: v.source === "link" ? "제출 링크" : "ClassNote / Drive",
        postId: typeof v.post_id === "number" ? v.post_id : null, revision: Number(v.assignment_revision), excluded: route.excluded === true,
        playback: links ? { ...links, uploadedAt: v.uploaded_at as string | null } : null };
    }) };
  } catch (e) { return { ok: false, error: e instanceof AssignmentError ? e.message : "영상 목록을 읽지 못했습니다." }; }
}

export async function assignHomeworkVideo(input: { classId: string; studentId: string; videoId: string; homeworkDate: string | null; excluded: boolean; revision: number; reason: string }): Promise<{ ok: boolean; error?: string }> {
  if (!input || !UUID.test(input.videoId) || typeof input.excluded !== "boolean" || !Number.isInteger(input.revision) || input.revision < 0
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 300
    || (!input.excluded && (!input.homeworkDate || !isVideoHomeworkDate(input.homeworkDate)))) return { ok: false, error: "영상·숙제 날짜와 변경 사유를 확인해 주세요." };
  try {
    const { user, db, full, dates } = await context(input.classId, input.studentId,
      input.excluded ? undefined : { fromDate: input.homeworkDate!, toDate: input.homeworkDate! });
    if (!input.excluded && !dates.includes(input.homeworkDate!)) return { ok: false, error: "이 학생에게 낸 영상 숙제를 골라 주세요." };
    if (!input.excluded) {
      const video = await db.from("homework_video_ledger_videos").select("posted_at")
        .eq("tenant_id", user.tenantId).eq("student_id", input.studentId).eq("id", input.videoId).eq("status", "uploaded")
        .not("drive_file_id", "is", null).maybeSingle();
      if (video.error) return { ok: false, error: "영상의 게시일을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
      if (!video.data) return { ok: false, error: "업로드가 완료된 학생 영상만 배정할 수 있습니다." };
      if (!isVideoAssignableToDate(video.data.posted_at, input.homeworkDate!)) return { ok: false, error: "숙제일과 30일 이상 차이 나는 영상은 배정할 수 없습니다." };
    }
    const { data, error } = await db.rpc("set_homework_video_assignment", {
      p_tenant: user.tenantId, p_actor: user.id, p_full: full, p_student: input.studentId, p_context_class: input.classId,
      p_video: input.videoId, p_date: input.excluded ? null : input.homeworkDate, p_excluded: input.excluded, p_revision: input.revision, p_reason: input.reason.trim(),
    });
    if (error) return { ok: false, error: "영상 배정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
    const errors: Record<string, string> = { conflict: "다른 곳에서 영상 배정이 변경됐습니다. 창을 닫고 다시 열어 확인해 주세요.", denied: "이 영상의 배정을 변경할 권한이 없습니다.", unavailable: "업로드가 완료된 학생 영상만 배정할 수 있습니다.", invalid_homework: "해당 학생에게 실제로 낸 영상 숙제를 골라 주세요.", missing_mark: "미수행으로 기록된 숙제입니다. 수행 상태를 먼저 수정해 주세요." };
    if (data !== "saved") return { ok: false, error: errors[String(data)] ?? "영상 배정 정보를 확인해 주세요." };
    revalidatePath("/onescreen/video-homework"); revalidatePath("/lesson-reports/video-homework"); revalidatePath(`/students/${input.studentId}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof AssignmentError ? e.message : "영상 배정을 저장하지 못했습니다." }; }
}
