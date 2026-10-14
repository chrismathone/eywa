import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { isVideoHomeworkDate } from "../types";
import { videoMatchRange } from "../rounds";
import { videoReceiptComment } from "../receipt-comment";
import { loadClassVideos } from "./ledger-queries";
import { listExtraIssuesFor } from "./extra-issues";
import { listRejections } from "./rejections";

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
  const reports = await fetchAllPaged<{ report_date: string; video_homework: boolean | null; classnote_sent_at: string | null; created_at: string | null }>((from, to) =>
    db.from("lesson_reports").select("report_date,video_homework,classnote_sent_at,created_at").eq("tenant_id", tenantId).eq("student_id", studentId).eq("class_id", classId)
      .gte("report_date", range.from).lt("report_date", reportDate).order("report_date", { ascending: false }).order("id").range(from, to));
  if (!reports.length) return null;
  // 보고서 없이 따로 낸 숙제(extra-issues.ts)도 같은 숙제다 — 못 읽으면 보고서의 숙제만 본다. ⚠️ 그때는 숙제가 덜 보여 짝이 달라질 수 있다
  // (드물게 남은 숙제를 못 보고 "모두 제출했습니다"가 나올 수 있다 — 조회 실패가 겹칠 때만).
  const [videos, older, extra, rejections] = await Promise.all([
    loadClassVideos(tenantId, [studentId], range.from, reportDate),
    db.from("lesson_reports").select("id").eq("tenant_id", tenantId).eq("student_id", studentId).eq("class_id", classId)
      .eq("video_homework", true).lt("report_date", range.from).limit(1),
    listExtraIssuesFor(createAdminClient(), tenantId, { studentIds: [studentId], classIds: [classId], fromDate: range.from, toDate: addDays(reportDate, -1) })
      .catch(() => []),
    // 반려한 숙제 — 반려 전 영상을 그 숙제의 제출로 세지 않게(장부와 같은 칸). 못 읽으면 반려 없이 본다.
    listRejections(createAdminClient(), tenantId, { studentIds: [studentId], fromDate: range.from, toDate: reportDate }).catch(() => []),
  ]);
  if (videos === null) return null;
  return videoReceiptComment({ classId, studentId, reportDate, previousReportDate: reports[0].report_date,
    previousReportAt: reports[0].classnote_sent_at ?? reports[0].created_at,
    homeworkDates: [...reports.filter(report => report.video_homework === true).map(report => report.report_date), ...extra.filter(issue => !issue.kept).map(issue => issue.date)], videos, fromDate: range.from,
    keptDates: extra.filter(issue => issue.kept).map(issue => issue.date),
    historyComplete: !older.error && !older.data?.length,
    rejected: Object.fromEntries(rejections.filter((r) => r.classId === classId).map((r) => [r.date, r.rejectedAt])) });
}
