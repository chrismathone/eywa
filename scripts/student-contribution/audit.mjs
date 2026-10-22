/** 0단계: 운영 DB 읽기 전용 집계. DB가 쓰기를 거절하는 트랜잭션에서만 실행한다. */
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";

const connection = new URL(process.env.DATABASE_URL ?? "missing:");
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "missing:").hostname.split(".")[0];
if (!ref || !(connection.hostname === `db.${ref}.supabase.co` || decodeURIComponent(connection.username).endsWith(`.${ref}`))) {
  throw new Error("Database project mismatch");
}
const db = postgres(connection.toString(), { ssl: "require", prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const result = await db.begin("read only", async (sql) => {
    await sql`set local statement_timeout = '45s'`;
    const tenants = await sql`select id, name, slug from public.tenants where name like '%침산%'`;
    if (tenants.length !== 1) throw new Error("Expected exactly one Chimsan tenant");
    const tenant = tenants[0];
    const id = tenant.id;
    const linked = await sql`select to_char(coalesce(consultation_date, received_date, (created_at at time zone 'Asia/Seoul')::date),'YYYY-MM') as month,
      count(*)::int as linked, count(student_id)::int as with_student
      from enrollment_consultations where tenant_id=${id} and referrer_student_id is not null group by 1 order by 1`;
    const [referrals] = await sql`select count(*)::int as total,
      count(*) filter(where referrer_student_id=student_id)::int as self_referrals,
      count(*) filter(where referrer_student_id is null and referrer_staff_id is null and nullif(trim(referrer_name),'') is not null)::int as named_unlinked
      from enrollment_consultations where tenant_id=${id}`;
    const [historyLinks] = await sql`select count(*)::int as enrolled,
      count(*) filter(where exists(select 1 from makeedu_history_students h where h.tenant_id=s.tenant_id and h.student_id=s.id))::int as linked
      from students s where s.tenant_id=${id} and s.status='enrolled' and s.is_test=false`;
    const [invoices] = await sql`select count(*)::int as invoices,
      count(*) filter(where line_items::text like '%"paid"%')::int as per_line_paid,
      count(*) filter(where line_items::text like '%"refunds"%')::int as has_refunds,
      count(*) filter(where amount_total=0)::int as zero_amount
      from invoices where tenant_id=${id} and category='tuition' and status<>'void'
      and period>=to_char((current_timestamp at time zone 'Asia/Seoul')::date-interval '12 months','YYYY-MM')`;
    const invoiceKinds = await sql`select item->>'kind' as kind, count(*)::int as rows
      from invoices i cross join lateral jsonb_array_elements(case when jsonb_typeof(i.line_items)='array' then i.line_items else '[]'::jsonb end) item
      where i.tenant_id=${id} group by 1 order by 2 desc`;
    const [messages] = await sql`select count(*)::int as eligible,
      min((created_at at time zone 'Asia/Seoul')::date) as first_record,
      count(*) filter(where content ~ '(태도|열심|좋아졌|늘었|집중|습관|노력|성적)')::int as keyword_candidates
      from classnote_parent_messages where tenant_id=${id} and student_id is not null and coalesce(category,'none')='none'`;
    const [replies] = await sql`select count(*)::int as eligible,
      min((posted_at at time zone 'Asia/Seoul')::date) as first_record,
      count(*) filter(where body ~ '(태도|열심|좋아졌|늘었|집중|습관|노력|성적)')::int as keyword_candidates
      from classnote_parent_replies where tenant_id=${id} and student_id is not null and status='success'`;
    const historyBills = await sql`select refunded,partial,paid_status,count(*)::int as rows,sum(paid)::text as paid,
      min(bill_month) as first_month,max(bill_month) as last_month
      from makeedu_history_bills where tenant_id=${id} and item_kind='lesson' group by 1,2,3 order by 1,2,3`;
    const [holdOverlap] = await sql`select count(distinct e.student_id)::int as currently_held_with_current_bill
      from enrollments e join invoices i on i.student_id=e.student_id and i.tenant_id=e.tenant_id
      where e.tenant_id=${id} and e.on_hold and e.end_date is null and i.period=to_char(current_timestamp at time zone 'Asia/Seoul','YYYY-MM')
      and i.category='tuition' and i.status not in ('void','refunded')`;
    return { checkedAt: new Date().toISOString(), readOnly: true, tenant, linked, referrals, historyLinks, invoices, invoiceKinds, messages, replies, historyBills, holdOverlap };
  });
  mkdirSync("work", { recursive: true });
  writeFileSync("work/student-contribution-audit.json", JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? "ERROR", message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, "[database-url]") }));
  process.exitCode = 1;
} finally {
  await db.end({ timeout: 5 });
}
