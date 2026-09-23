import "server-only";

import { createClient } from "@/lib/supabase/server";
import { linkedConsultationSummary, type ConsultationLink } from "./consultation-link";

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export async function addAcademicConsultation(tenantId: string, link: ConsultationLink): Promise<string | null> {
  const supabase = await createClient();
  const { studentId, subject, date } = link;
  const summary = linkedConsultationSummary(link);
  const start = `${date}T00:00:00.000+09:00`;
  const end = `${nextDay(date)}T00:00:00.000+09:00`;
  const { data: existing, error } = await supabase.from("student_consultations")
    .select("id").eq("tenant_id", tenantId).eq("student_id", studentId).eq("category", "academic")
    .eq("subject", subject).eq("summary", summary)
    .gte("consulted_at", start).lt("consulted_at", end).limit(1);
  if (error) return error.message;
  if (existing?.length) return null;
  const inserted = await supabase.from("student_consultations").insert({
    tenant_id: tenantId, student_id: studentId, category: "academic", subject,
    summary, consulted_at: `${date}T12:00:00+09:00`,
  });
  return inserted.error?.message ?? null;
}
