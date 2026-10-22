import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { buildBackfillReport } from "../../src/features/student-contribution/model/backfill-report";
import { referralDay } from "../../src/features/student-contribution/model/referrals";
import { billingMonths, type HistoricalBill } from "../../src/features/student-contribution/model/billing";
import type { CoreSources, RawHistoryBill } from "../../src/features/student-contribution/server/source-types";
import { CONTRIBUTION_PILOT_TENANT } from "../../src/features/student-contribution/model/access";

export function checkedConnection() {
  const connection = new URL(process.env.DATABASE_URL ?? "missing:");
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "missing:").hostname.split(".")[0];
  if (!ref || !(connection.hostname === `db.${ref}.supabase.co` || decodeURIComponent(connection.username).endsWith(`.${ref}`))) throw new Error("Database project mismatch");
  return connection.toString();
}
/** 호출부가 read only/serializable 트랜잭션을 정한다. 이 함수에는 SELECT만 있다. */
export async function readBackfillSnapshot(sql: Pick<Sql, "unsafe">) {
  const tenant = CONTRIBUTION_PILOT_TENANT;
  const read = async <T>(table: string, columns: string, order = "id"): Promise<T[]> => (await sql.unsafe(
    `select to_jsonb(r) as data from (select ${columns} from public.${table} where tenant_id=$1 order by ${order}) r`, [tenant])).map((r) => r.data as T);
  const students = await read<CoreSources["students"][number]>("students", "id,name,school,grade,status,is_test,notes,parent_phone,makeedu_id,withdrawal_metadata");
  const consultations = await read<CoreSources["consultations"][number]>("enrollment_consultations", "id,student_id,prospect_name,prospect_school,prospect_grade,parent_phone,referrer_student_id,referrer_staff_id,referrer_name,consultation_date,received_date,created_at,subject,consultation_path,parent_request,safety_notes,follow_up_content");
  const users = await read<CoreSources["users"][number]>("users", "id,display_name,status,subjects");
  const enrollments = await read<CoreSources["enrollments"][number]>("enrollments", "id,student_id,class_id,start_date,end_date,on_hold,attendance_days,is_transferred,is_transferred_in,withdrawal_reason");
  const invoices = await read<CoreSources["invoices"][number]>("invoices", "id,student_id,period,status,category,line_items,amount_total,amount_paid");
  const historyLinks = await read<CoreSources["historyLinks"][number]>("makeedu_history_students", "makeedu_no,student_id", "makeedu_no");
  const history = await read<RawHistoryBill>("makeedu_history_bills", "makeedu_no,bill_month,seq,item_kind,item_name,billed,paid,refunded", "makeedu_no,bill_month,seq");
  const studentOf = new Map(historyLinks.filter((h) => h.student_id).map((h) => [h.makeedu_no, h.student_id!]));
  const bills: HistoricalBill[] = history.flatMap((h) => {
    const studentId = studentOf.get(h.makeedu_no);
    return studentId ? [{ id: `${h.makeedu_no}:${h.bill_month}:${h.seq}`, studentId, month: h.bill_month.slice(0, 7), lesson: h.item_kind === "lesson",
      billed: Number(h.billed), paid: Number(h.paid), refunded: h.refunded, subject: null }] : [];
  });
  const billing = billingMonths({ invoices, history: bills, aywaFrom: "2026-01", through: "2026-10", subjectOf: () => null });
  const result = buildBackfillReport({ students, consultations, users, enrollments, historyLinks }, billing.map((b) => b.seed));
  const sample = result.rows.filter((r) => r.state === "automatic").slice(0, 20).map((r) => ({ ...r,
    referrerName: students.find((s) => s.id === r.candidateId)?.name,
    consultedOn: referralDay(consultations.find((c) => c.id === r.consultationId)!) }));
  const fingerprint = createHash("sha256").update(JSON.stringify({ result, consultations, students, enrollments, users, billing: billing.map((b) => b.seed) })).digest("hex");
  return { checkedAt: new Date().toISOString(), readOnly: true, tenantId: tenant, fingerprint, ...result, sample };
}
