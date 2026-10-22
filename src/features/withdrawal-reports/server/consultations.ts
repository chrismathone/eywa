import "server-only";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import type { ReportConsultation } from "../consultation";
import type { WithdrawalReport } from "../model";
import type { reportViewer } from "./queries";

/** 보고서 접근 검증 뒤 호출. 상담 원본의 RLS·작성자 범위도 그대로 적용한다. */
export async function reportConsultations(report: WithdrawalReport, viewer: NonNullable<Awaited<ReturnType<typeof reportViewer>>>) {
  if (!(await canAccessTenant(viewer.user.systemRole, "consultations"))) return [];
  const db = await createClient();
  const rows = await fetchAllPaged<{ id: string; consulted_at: string; audience: ReportConsultation["audience"]; summary: string }>((from, to) => {
    let q = db.from("student_consultations").select("id,consulted_at,audience,summary")
      .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id);
    if (viewer.teacherId) q = q.eq("counselor_id", viewer.teacherId);
    return q.order("consulted_at", { ascending: false }).order("id").range(from, to);
  });
  return rows.map(r => ({ id: r.id, consultedAt: r.consulted_at, audience: r.audience, summary: visibleConsultationSummary(r.summary) }));
}
