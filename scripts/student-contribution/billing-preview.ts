/** 운영 DB SELECT 전용. 수납 통계와 같은 모집단·월별 금액을 비교하고 원생 표본을 로컬에 저장한다. */
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";
import { checkedConnection } from "./backfill-source";
import { resolveSettings } from "../../src/features/owner/resolve";
import { billingMonths, type HistoricalBill } from "../../src/features/student-contribution/model/billing";
import { contributionSubjectOf } from "../../src/features/student-contribution/model/subjects";
import { contributionIdentity } from "../../src/features/student-contribution/model/identity";
import { contributionRoster } from "../../src/features/student-contribution/model/roster";
import { CONTRIBUTION_PILOT_TENANT } from "../../src/features/student-contribution/model/access";
import { aywaHistoryMonths, lessonNameWeights } from "../../src/features/students/stats/history-aywa";
import { DEFAULT_CONFIG } from "../../src/features/student-contribution/model/config";
import { scoreRaws, sumRaws } from "../../src/features/student-contribution/model/calc";
import { kstToday } from "../../src/lib/date-kst";
import type { CoreSources, RawHistoryBill } from "../../src/features/student-contribution/server/source-types";

async function main() {
const db = postgres(checkedConnection(), { ssl: "require", prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const result = await db.begin("read only", async (sql) => {
    await sql`set local statement_timeout = '45s'`;
    const tenant = CONTRIBUTION_PILOT_TENANT, through = kstToday().slice(0, 7);
    const read = async <T>(table: string, columns: string, extra = ""): Promise<T[]> => (await sql.unsafe(
      `select to_jsonb(r) as data from (select ${columns} from public.${table} where tenant_id=$1 ${extra}) r`, [tenant])).map((r) => r.data as T);
    const students = await read<CoreSources["students"][number]>("students", "id,name,school,grade,status,is_test,notes,parent_phone,makeedu_id,withdrawal_metadata");
    const classes = await read<CoreSources["classes"][number]>("classes", "id,subject");
    const users = await read<CoreSources["users"][number]>("users", "id,display_name,subjects");
    const enrollments = await read<{ student_id: string }>("enrollments", "student_id");
    const invoices = await read<CoreSources["invoices"][number]>("invoices", "id,student_id,period,status,category,line_items,amount_total,amount_paid", "and period >= '2026-01'");
    const links = await read<CoreSources["historyLinks"][number]>("makeedu_history_students", "makeedu_no,student_id");
    const history = await read<RawHistoryBill>("makeedu_history_bills", "makeedu_no,bill_month,seq,item_kind,item_name,billed,paid,refunded",
      "and item_kind='lesson' and bill_month >= '2020-01-01' and bill_month < '2026-01-01'");
    const [rawSettings] = await sql`select data from tenant_settings where tenant_id=${tenant}`;
    const [columnCheck] = await sql`select count(*)::int as count from information_schema.columns where table_schema='public' and table_name='enrollment_consultations' and column_name='updated_at'`;
    if (columnCheck?.count !== 1) throw new Error("상담 동시 수정 방지 칸을 확인하지 못했습니다");
    const settings = resolveSettings(rawSettings?.data ?? {}, { name: "인재원침산" }), canonical = contributionIdentity(students);
    const valid = new Set(students.filter((s) => !s.is_test).map((s) => s.id));
    const roster = contributionRoster(students, new Set(enrollments.map((e) => canonical(e.student_id))));
    const rosterIds = new Set(roster.map((s) => s.id));
    const eligible = (id: string) => valid.has(id) && valid.has(canonical(id)) && rosterIds.has(canonical(id));
    // 운영 집계의 loadContributionHistory와 동일하게 연결된 청구만 과목명 추론에 사용한다.
    const linkedNumbers = new Set(links.filter((link) => link.student_id).map((link) => link.makeedu_no));
    const subjectOf = contributionSubjectOf({ subjects: settings.operations.subjects, classes,
      names: [...lessonNameWeights(invoices), ...history.filter((h) => linkedNumbers.has(h.makeedu_no)).map((h) => ({ name: h.item_name ?? "", weight: Math.abs(Number(h.paid)) }))],
      staff: users.map((u) => ({ names: [u.display_name], subjects: u.subjects ?? [] })) });
    const studentOf = new Map(links.filter((h) => h.student_id).map((h) => [h.makeedu_no, h.student_id!]));
    const historical: HistoricalBill[] = history.flatMap((h) => {
      const id = studentOf.get(h.makeedu_no);
      return id && eligible(id) ? [{ id: `${h.makeedu_no}:${h.bill_month}:${h.seq}`, studentId: canonical(id), month: h.bill_month.slice(0, 7), lesson: true,
        billed: Number(h.billed), paid: Number(h.paid), refunded: h.refunded, subject: subjectOf({ name: h.item_name }) }] : [];
    });
    const scoped = invoices.filter((i) => eligible(i.student_id)).map((i) => ({ ...i, student_id: canonical(i.student_id) }));
    const billing = billingMonths({ invoices: scoped, history: historical, through, aywaFrom: "2026-01", subjectOf });
    const months = [...new Set(billing.filter((b) => b.month >= "2026-01").map((b) => b.month))].sort();
    const control = aywaHistoryMonths({ invoices: scoped, registrations: [], started: new Set(), months });
    const comparison = control.map((row) => {
      const contributionWon = billing.filter((b) => b.month === row.month).reduce((s, b) => s + b.raws.tuitionWon, 0);
      const statisticsWon = (row.data.tuitionPaidGeneral ?? 0) + (row.data.tuitionPaidEie ?? 0);
      return { month: row.month, contributionWon, statisticsWon, difference: contributionWon - statisticsWon };
    });
    if (comparison.some((r) => r.difference)) throw new Error("수납 통계와 원생 기여도의 월별 수업료가 일치하지 않습니다");
    const totals = sumRaws(billing.map((b) => b.raws)), score = scoreRaws(totals, DEFAULT_CONFIG);
    const samples = roster.map((s) => {
      const rows = billing.filter((b) => b.studentId === s.id);
      return { id: s.id, name: s.name, status: s.status, firstMonth: rows[0]?.month ?? null, liveMonths: rows.filter((r) => r.seed.active).length,
        tuitionWon: rows.reduce((sum, b) => sum + b.raws.tuitionWon, 0), mergedSources: students.filter((x) => x.id !== s.id && canonical(x.id) === s.id).map((x) => x.id) };
    }).filter((s) => s.firstMonth);
    const unknownNames = new Map<string, number>();
    for (const h of history) if (!subjectOf({ name: h.item_name })) unknownNames.set(h.item_name ?? "(이름 없음)", (unknownNames.get(h.item_name ?? "(이름 없음)") ?? 0) + 1);
    return { checkedAt: new Date().toISOString(), readOnly: true, scope: "수업료·과목달·재원 대조. 소개·활동·AI 미실행", tenantId: tenant,
      sourceCounts: { students: students.length, roster: roster.length, invoices: scoped.length, linkedHistory: historical.length,
        unlinkedHistory: history.filter((h) => !studentOf.has(h.makeedu_no)).length }, comparison, totals,
      amountPoints: score.points.tuitionWon, subjectMonthPoints: score.points.subjectMonths, unknownSubjectMonths: billing.filter((b) => b.unknownSubjects > 0).length,
      unknownNames: [...unknownNames].sort((a, b) => b[1] - a[1]).slice(0, 20),
      samples: { oldest: [...samples].sort((a, b) => a.firstMonth!.localeCompare(b.firstMonth!)).slice(0, 5),
        newest: [...samples].sort((a, b) => b.firstMonth!.localeCompare(a.firstMonth!)).slice(0, 5), merged: samples.filter((s) => s.mergedSources.length).slice(0, 5) } };
  });
  mkdirSync("work", { recursive: true });
  writeFileSync("work/student-contribution-billing-preview.json", JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({ ...result, samples: "로컬 보고서에 저장", unknownNames: "로컬 보고서에 저장" }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[database-url]") : "미확인 오류"); process.exitCode = 1;
} finally { await db.end({ timeout: 5 }); }
}
void main();
