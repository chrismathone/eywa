import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { isVideoHomeworkDate } from "../types";
import { videoMatchRange } from "../rounds";
import { videoReceiptComment } from "../receipt-comment";
import { loadClassVideos } from "./ledger-queries";

/** 클라이언트의 제출 체크를 신뢰하지 않고, 접근 가능한 학생의 실제 영상으로 확인한다. */
export async function getVideoReceiptComment(tenantId: string, input: { studentId?: string; classId?: string | null; date?: string }): Promise<string | null> {
  if (!input.studentId || !input.classId) return null;
  const { studentId, classId } = input;
  const reportDate = input.date && isVideoHomeworkDate(input.date) ? input.date : kstToday();
  if (reportDate > kstToday()) return null;
  const db = await createClient();
  const user = await getCurrentUser();
  if (!user || user.tenantId !== tenantId || user.systemRole === "student") return null;
  if (await accessLevelTenant(user.systemRole, "lesson_reports") !== "full") {
    const teacher = (await effectiveTeacherId()) ?? user.id;
    if (!(await getTeachingClassIds(db, teacher, reportDate)).all.includes(classId)) return null;
  }
  const student = await db.from("students").select("id").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle();
  if (student.error || !student.data) return null;
  const range = videoMatchRange(reportDate, reportDate, reportDate);
  // 보고서는 RLS로 먼저 범위를 확인한다. 남의 반의 영상 조회를 위한 우회로가 되지 않는다.
  const reports = await fetchAllPaged<{ report_date: string; video_homework: boolean | null }>((from, to) =>
    db.from("lesson_reports").select("report_date,video_homework").eq("tenant_id", tenantId).eq("student_id", studentId).eq("class_id", classId)
      .gte("report_date", range.from).lt("report_date", reportDate).order("report_date", { ascending: false }).order("id").range(from, to));
  if (!reports.length) return null;
  const [videos, older] = await Promise.all([
    loadClassVideos(tenantId, [studentId], range.from, reportDate),
    db.from("lesson_reports").select("id").eq("tenant_id", tenantId).eq("student_id", studentId).eq("class_id", classId)
      .eq("video_homework", true).lt("report_date", range.from).limit(1),
  ]);
  if (videos === null) return null;
  return videoReceiptComment({ classId, studentId, reportDate, previousReportDate: reports[0].report_date,
    homeworkDates: reports.filter(report => report.video_homework === true).map(report => report.report_date), videos, fromDate: range.from,
    historyComplete: !older.error && !older.data?.length });
}
