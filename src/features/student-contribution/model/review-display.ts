import { kstDateOf } from "@/lib/date-kst";
import type { BackfillReport } from "./backfill-report";

export type ConsultationIdentity = { id: string; prospect_name: string | null; consultation_date: string | null;
  received_date: string | null; created_at: string; referrer_student_id: string | null; referrer_staff_id: string | null };
export type ReviewDisplayReport = Omit<BackfillReport, "rows"> & { checkedAt: string;
  rows: (BackfillReport["rows"][number] & { prospectName?: string | null; consultationDay?: string | null })[] };

/** Use current source identity; a missing source must not look like a different consultation. */
export function reviewDisplay(report: BackfillReport & { checkedAt: string }, consultations: ConsultationIdentity[]): ReviewDisplayReport {
  const byId = new Map(consultations.map((row) => [row.id, row]));
  const rows = report.rows.map((row) => {
    const source = byId.get(row.consultationId);
    return { ...row, prospectName: source?.prospect_name ?? null,
      consultationDay: source ? source.consultation_date ?? source.received_date ?? kstDateOf(source.created_at) : null,
      state: source?.referrer_student_id || source?.referrer_staff_id ? "linked" as const : row.state };
  });
  return { ...report, rows, counts: { ...report.counts, automatic: rows.filter((r) => r.state === "automatic").length,
    review: rows.filter((r) => r.state === "review").length, unavailable: rows.filter((r) => r.state === "unavailable").length,
    linked: rows.filter((r) => r.state === "linked").length } };
}
