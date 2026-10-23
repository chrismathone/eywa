import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { CLASS_COLUMNS, ENROLLMENT_COLUMNS, SCHEDULE_COLUMNS, paged, toTransitions, transitionRows } from "@/features/teacher-portfolio/server/churn-source";
import type { SnapshotClass, SnapshotEnrollment, SnapshotSchedule } from "@/features/teacher-portfolio/model/types";
import type { ContributionInvoice } from "../model/billing";
import type { ContributionStudent, ContributionConsultation, CoreSources, HistoryLink, RawHistoryBill } from "./source-types";

/** 배치·드라이런 전용. 화면 목록에서 부르지 않는다. 지점 내 식별자를 원본별로 한 번 읽는다. */
export async function loadCoreSources(db: SupabaseClient, tenant: string): Promise<CoreSources> {
  const table = (name: string, columns: string) => db.from(name).select(columns).eq("tenant_id", tenant);
  const [students, classes, enrollments, schedules, users, invoices, consultations, historyLinks, transitions] = await Promise.all([
    paged<ContributionStudent>((a, b) => table("students", "id, name, school, grade, status, is_test, notes, parent_phone, makeedu_id, withdrawal_metadata").order("id").range(a, b)),
    paged<SnapshotClass>((a, b) => table("classes", CLASS_COLUMNS).order("id").range(a, b)),
    paged<SnapshotEnrollment>((a, b) => table("enrollments", ENROLLMENT_COLUMNS).order("id").range(a, b)),
    paged<SnapshotSchedule>((a, b) => table("class_schedules", SCHEDULE_COLUMNS).order("id").range(a, b)),
    paged<CoreSources["users"][number]>((a, b) => table("users", "id, display_name, english_name, status, subjects").order("id").range(a, b)),
    paged<ContributionInvoice>((a, b) => table("invoices", "id, student_id, period, status, category, line_items, amount_total, amount_paid").gte("period", "2026-01").order("id").range(a, b)),
    paged<ContributionConsultation>((a, b) => table("enrollment_consultations", "id, student_id, prospect_name, prospect_school, prospect_grade, parent_phone, referrer_student_id, referrer_staff_id, referrer_name, consultation_date, received_date, created_at, subject, consultation_path, parent_request, safety_notes, follow_up_content").order("id").range(a, b)),
    paged<HistoryLink>((a, b) => table("makeedu_history_students", "makeedu_no, student_id").order("makeedu_no").range(a, b)),
    transitionRows(db, tenant),
  ]);
  return { students, classes, enrollments, schedules, users, invoices, consultations, historyLinks, transitions: toTransitions(transitions) };
}

/** 연결된 번호만 청크·페이징한다. 지난 청구 수정·학생 연결 보완도 현재 달 정정에 반영한다. */
export async function loadHistoricalBills(db: SupabaseClient, tenant: string, links: readonly HistoryLink[]) {
  const numbers = [...new Set(links.filter((h) => h.student_id).map((h) => h.makeedu_no))];
  return fetchAllPagedInChunks<RawHistoryBill>(numbers, (chunk, a, b) => db.from("makeedu_history_bills")
    .select("makeedu_no, bill_month, seq, item_kind, item_name, billed, paid, refunded").eq("tenant_id", tenant).in("makeedu_no", chunk).eq("item_kind", "lesson")
    .gte("bill_month", "2020-01-01").lt("bill_month", "2026-01-01")
    .order("makeedu_no").order("bill_month").order("seq").range(a, b));
}
