import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WithdrawalReport } from "../model";
export async function completedEnrollmentIds(r: WithdrawalReport) {
  let subjects = r.subjects;
  let enrollmentIds = r.enrollment_ids;
  if (r.group_id) {
    const { data, error } = await createAdminClient().from("withdrawal_report_groups").select("subjects,enrollment_ids").eq("tenant_id", r.tenant_id).eq("id", r.group_id).single();
    if (error || !data) throw new Error("승인된 종료 반을 확인하지 못했습니다.");
    subjects = data.subjects;
    enrollmentIds = data.enrollment_ids;
  }
  return r.snapshot.courses.filter(c => enrollmentIds != null ? enrollmentIds.includes(c.id) : subjects.includes(c.subject)).map(c => c.id);
}
