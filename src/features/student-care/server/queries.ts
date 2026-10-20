import "server-only";
import { cache } from "react";
import { addDays, kstToday } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import { careAccess } from "./access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { foldedReason } from "@/lib/folded-read";
import { buildCareCard } from "../build";
import { ready, type Source, type Enrollment, type Report, type Grade, type Level,
  type Attendance, type Invoice, type Consultation } from "../types";

async function source<T>(read: () => Promise<T[]>, permitted = true): Promise<Source<T>> {
  if (!permitted) return { state: "restricted", rows: [] };
  try { return ready(await read()); }
  catch { return { state: "failed", rows: [] }; } // Never show a failed source as zero/healthy. No raw DB error or PII logging.
}

/** Per-request only: no cross-user/tenant cache of financial or counseling data. */
export const getStudentCare = cache(async (studentId: string) => {
  const ctx = await careAccess(studentId);
  if (!ctx) return null;
  const { db, user, counselorId } = ctx;
  const today = kstToday();
  const [enrollments, reports, grades, levels, attendance, consultations, invoices, subjectLabels] = await Promise.all([
    source(() => fetchAllPaged<Enrollment>((from, to) => db.from("enrollments")
      .select("id,start_date,end_date,on_hold,is_transferred").eq("tenant_id", user.tenantId)
      .eq("student_id", studentId).order("id").range(from, to))),
    source(() => fetchAllPaged<Report>((from, to) => db.from("lesson_reports")
      .select("id,report_date,subject,homework_score,class:classes!lesson_reports_class_id_fkey(subject)").eq("tenant_id", user.tenantId).eq("student_id", studentId)
      .gte("report_date", addDays(today, -55)).lte("report_date", today).is("revoked_at", null).order("id").range(from, to))),
    source(() => fetchAllPaged<Grade>((from, to) => db.from("student_grades")
      .select("id,subject,exam_name,taken_on,score,max_score").eq("tenant_id", user.tenantId)
      .eq("student_id", studentId).lte("taken_on", today).order("id").range(from, to))),
    source(() => fetchAllPaged<Level>((from, to) => db.from("level_tests")
      .select("id,subject,test_type,tested_on,level").eq("tenant_id", user.tenantId)
      .eq("student_id", studentId).lte("tested_on", today).order("id").range(from, to))),
    source(() => fetchAllPaged<Attendance>((from, to) => db.from("attendance_records")
      .select("id,student_id,class_id,slot_start,session_date,recorded_at,status").eq("tenant_id", user.tenantId)
      .eq("student_id", studentId).gte("session_date", addDays(today, -27)).lte("session_date", today).order("id").range(from, to))),
    source(() => fetchAllPaged<Consultation>((from, to) => {
      let query = db.from("student_consultations")
        .select("id,consulted_at,audience,summary,follow_up_date,follow_up_done,follow_up_action")
        .eq("tenant_id", user.tenantId).eq("student_id", studentId);
      if (counselorId) query = query.eq("counselor_id", counselorId);
      return query.order("id").range(from, to);
    }), ctx.canReadConsultations),
    source(() => fetchAllPaged<Invoice>((from, to) => db.from("invoices")
      .select("id,period,status,amount_paid,line_items").eq("tenant_id", user.tenantId)
      .eq("student_id", studentId).order("id").range(from, to)), ctx.canReadBilling),
    getTenantSettings().then((settings) => foldedReason(settings) ? {} : subjectLabelRecord(settings.operations.subjects)).catch(() => ({})),
  ]);
  return buildCareCard({ studentId, today, enrolledAt: ctx.student.enrolled_at, canWriteConsultation: ctx.canWriteConsultation,
    enrollments, reports, grades, levels, attendance, invoices, subjectLabels,
    consultations: { ...consultations, rows: consultations.rows.map((r) => ({ ...r,
      summary: visibleConsultationSummary(r.summary ?? "") })) } });
});
