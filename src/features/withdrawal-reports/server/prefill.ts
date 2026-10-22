import "server-only";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import type { SystemRole } from "@/lib/permissions";
import type { ReportBody, WithdrawalReport } from "../model";
import { attendancePrefill, billingPrefill, type AttendancePrefillRow } from "../prefill";

/** getReport의 지점·참여자 검증을 통과한 신규 초안에만 호출한다. 원본 메뉴의 읽기 권한도 유지한다. */
export async function loadReportPrefill(report: WithdrawalReport, role: SystemRole) {
  const [attendanceAllowed, billingAllowed] = await Promise.all([canAccessTenant(role, "attendance"), canAccessTenant(role, "billing")]);
  const db = createAdminClient();
  const today = kstToday();
  const until = report.effective_date < today ? report.effective_date : today;
  const from = addDays(until, -29);
  const month = report.effective_date.slice(0, 7);
  const courses = report.snapshot.courses.filter(c => report.subjects.includes(c.subject) && (!report.group_id || c.teacherId === report.teacher_id));
  const classIds = [...new Set(courses.map(c => c.classId))];
  const results = await Promise.allSettled([
    attendanceAllowed && classIds.length ? fetchAllPagedInChunks<AttendancePrefillRow>(classIds, (ids, start, end) => db.from("attendance_records")
      .select("id,student_id,class_id,session_date,slot_start,status,recorded_at")
      .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id).in("class_id", ids)
      .gte("session_date", from).lte("session_date", until).order("id").range(start, end)) : Promise.resolve(null),
    billingAllowed ? fetchAllPaged<{ period: string; category: string; status: string; amount_total: number; amount_paid: number; amount_discount: number }>((start, end) => db.from("invoices")
      .select("period,category,status,amount_total,amount_paid,amount_discount")
      .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id).lte("period", month)
      .order("id").range(start, end)) : Promise.resolve(null),
  ]);
  const prefill: Partial<ReportBody> = {};
  const warnings: string[] = [];
  const [attendance, invoices] = results;
  if (attendance.status === "fulfilled" && attendance.value) prefill.attendance = attendancePrefill(attendance.value, courses, from, until);
  if (invoices.status === "fulfilled" && invoices.value) Object.assign(prefill, billingPrefill(invoices.value.map(r => ({ period: r.period, category: r.category, status: r.status, amountTotal: Number(r.amount_total), amountPaid: Number(r.amount_paid), amountDiscount: Number(r.amount_discount) })), month, today));
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`[withdrawal-report-prefill:${i === 0 ? "attendance" : "billing"}]`, result.reason);
      warnings.push(`${i === 0 ? "출결" : "수납"} 정보를 자동으로 불러오지 못했습니다. 해당 항목을 확인해 입력해 주세요.`);
    }
  });
  return { prefill, prefillWarning: warnings.join(" ") };
}
