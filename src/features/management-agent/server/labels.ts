import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/report-error";
import type { AgentCase } from "../model";

// Only the bounded visible page (at most 13 cases). Labels never enter notification/AI payloads.
export async function caseLabels(db: Awaited<ReturnType<typeof createClient>>, tenantId: string, rows: AgentCase[]) {
  if (!rows.length) return rows;
  const students = [...new Set(rows.map(r => r.student_id))];
  const staff = [...new Set(rows.flatMap(r => r.assignee_id ? [r.assignee_id] : []))];
  const [names, people] = await Promise.all([
    db.from("students").select("id,name").eq("tenant_id",tenantId).in("id",students),
    staff.length ? db.from("users").select("id,display_name").eq("tenant_id",tenantId).in("id",staff)
      : Promise.resolve({data:[],error:null}),
  ]);
  if (names.error || people.error) reportError(new Error("후속조치 표시 이름 조회 실패"), {scope:"management-agent.labels"});
  const byStudent = new Map((names.error ? [] : names.data ?? []).map(r => [r.id,r.name]));
  const byStaff = new Map((people.error ? [] : people.data ?? []).map(r => [r.id,r.display_name]));
  return rows.map(r => ({...r,studentName:byStudent.get(r.student_id) ?? null,assigneeName:r.assignee_id ? byStaff.get(r.assignee_id) ?? null : null}));
}
