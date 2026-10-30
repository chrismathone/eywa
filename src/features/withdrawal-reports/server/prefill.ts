import "server-only";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import type { SystemRole } from "@/lib/permissions";
import type { ReportBody, WithdrawalReport } from "../model";
import { attendancePrefill, type AttendancePrefillRow } from "../prefill";
import { loadReportBilling } from "./billing";
import { reportCourses } from "../target-courses";

/** YYYY-MM-DD를 n개월 옮긴다(말일은 그 달 말일로 — 05-31의 3개월 전 = 02-28). */
function shiftMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** getReport의 지점·작성자/참여자 검증을 통과한 작성 중 보고서에만 호출한다. */
export async function loadReportPrefill(report: WithdrawalReport, role: SystemRole) {
  const attendanceAllowed = await canAccessTenant(role, "attendance");
  const db = createAdminClient();
  const today = kstToday();
  const until = report.effective_date < today ? report.effective_date : today;
  const courses = reportCourses(report);
  // 출결은 **퇴원일 기준 최근 3개월**만 — 원장 2026-10-29 *"출결 현황도 전체 기간에 대해서도 사실 의미없음. 최근 3개월 출결 현황으로"*.
  // 수강 시작이 그보다 늦으면 시작일부터.
  const start = courses.map(c => c.startDate).sort()[0] ?? until;
  const threeMonths = shiftMonths(until, -3);
  const from = start > threeMonths ? start : threeMonths;
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
