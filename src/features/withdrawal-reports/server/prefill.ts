import "server-only";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import type { SystemRole } from "@/lib/permissions";
import type { ReportBody, WithdrawalReport } from "../model";
import { attendancePrefill, type AttendancePrefillRow } from "../prefill";
import { loadReportBilling } from "./billing";

/** getReport의 지점·작성자/참여자 검증을 통과한 작성 중 보고서에만 호출한다. */
export async function loadReportPrefill(report: WithdrawalReport, role: SystemRole) {
  const attendanceAllowed = await canAccessTenant(role, "attendance");
  const db = createAdminClient();
  const today = kstToday();
  const until = report.effective_date < today ? report.effective_date : today;
  const courses = report.snapshot.courses.filter(c => report.subjects.includes(c.subject) && (!report.group_id || c.teacherId === report.teacher_id));
  const from = courses.map(c => c.startDate).sort()[0] ?? until;
  const classIds = [...new Set(courses.map(c => c.classId))];
  const results = await Promise.allSettled([
    attendanceAllowed && classIds.length ? fetchAllPagedInChunks<AttendancePrefillRow>(classIds, (ids, start, end) => db.from("attendance_records")
      .select("id,student_id,class_id,session_date,slot_start,status,recorded_at")
      .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id).in("class_id", ids)
      .gte("session_date", from).lte("session_date", until).order("id").range(start, end)) : Promise.resolve(null),
    loadReportBilling(report),
  ]);
  const prefill: Partial<ReportBody> = {};
  const warnings: string[] = [];
  const [attendance, invoices] = results;
  if (attendance.status === "fulfilled" && attendance.value) prefill.attendance = attendancePrefill(attendance.value, courses, from, until);
  if (invoices.status === "fulfilled") Object.assign(prefill, invoices.value);
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`[withdrawal-report-prefill:${i === 0 ? "attendance" : "billing"}]`, result.reason);
      warnings.push(`${i === 0 ? "출결" : "수납"} 정보를 자동으로 불러오지 못했습니다. 잠시 후 새로고침해 주세요.`);
    }
  });
  return { prefill, prefillWarning: warnings.join(" ") };
}
