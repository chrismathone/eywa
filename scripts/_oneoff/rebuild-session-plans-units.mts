/** 0267a 적용 후 계획만 시수로 재산출. 기본 dry run; --period=YYYY-MM --apply로 적용. */
import { config } from "dotenv";
import postgres from "postgres";
import { planTermsForMonth, monthRange, type PlanEnrollment } from "../../src/features/billing/session-terms/plan";
import { toAutoUnitsSchedule } from "../../src/features/attendance/auto-units";
import { mergeHolidays } from "../../src/features/billing/tuition-calc";
import { resolveSettings } from "../../src/features/owner/resolve";

config({ path: ".env.local", quiet: true });
const period = process.argv.find((arg) => arg.startsWith("--period="))?.slice(9);
const range = period ? monthRange(period) : null;
if (!period || !range) throw new Error("--period=YYYY-MM required");
const apply = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10 });
try {
  const tenants = await sql`select distinct i.tenant_id from invoices i join invoice_session_terms st on st.invoice_id=i.id where i.period=${period} and i.status <> 'void'`;
  for (const tenant of tenants) {
    await sql.begin(async (tx) => {
      // 재계산 중 시간표 변경과 확정 변경을 섞지 않는 일관된 읽기 스냅샷.
      await tx`set transaction isolation level repeatable read`;
      const [saved] = await tx`select data from tenant_settings where tenant_id=${tenant.tenant_id}`;
      const settings = resolveSettings(saved?.data ?? null, { name: "" });
      const holidays = mergeHolidays(Number(period.slice(0, 4)), settings.operations.holidays.map((h) => h.date), true);
      const terms = await tx`select st.id,st.class_id,st.planned_sessions,st.confirmed_sessions,st.amount,i.student_id from invoice_session_terms st join invoices i on i.id=st.invoice_id where st.tenant_id=${tenant.tenant_id} and i.period=${period} and i.status <> 'void'`;
      const enrollments = await tx`select e.student_id,e.class_id,e.start_date::text,e.end_date::text,c.subject from enrollments e join classes c on c.id=e.class_id where e.tenant_id=${tenant.tenant_id} and not e.on_hold and c.is_active and e.start_date <= ${range.end}::date and (e.end_date is null or e.end_date >= ${range.start}::date)`;
      const schedules = await tx`select class_id,day_of_week,start_time::text,end_time::text,valid_from::text,valid_to::text,slot_teacher_label from class_schedules where tenant_id=${tenant.tenant_id} and valid_from <= ${range.end}::date and (valid_to is null or valid_to >= ${range.start}::date)`;
      const byStudent = new Map<string, PlanEnrollment[]>();
      for (const e of enrollments) {
        const list = byStudent.get(e.student_id) ?? [];
        list.push({ classId: e.class_id, subject: e.subject, startDate: e.start_date, endDate: e.end_date, weekdays: [], schedules: schedules.filter((s) => s.class_id === e.class_id).map((s) => toAutoUnitsSchedule({ day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time, valid_from: s.valid_from, valid_to: s.valid_to, slot_teacher_label: s.slot_teacher_label })) });
        byStudent.set(e.student_id, list);
      }
      const plans = new Map([...byStudent].map(([student, enrolls]) => [student, new Map(planTermsForMonth(period, enrolls, holidays).map((p) => [p.classId, p.plannedSessions]))]));
      const changes = terms.flatMap((term) => {
        const planned = plans.get(term.student_id)?.get(term.class_id);
        const before = term.planned_sessions === null ? null : Number(term.planned_sessions);
        return planned !== undefined && planned !== before ? [{ id: term.id, before, after: planned }] : [];
      });
      console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", period, terms: terms.length, changes: changes.length, fractional: changes.filter((c) => !Number.isInteger(c.after)).length, confirmedPreserved: terms.filter((t) => t.confirmed_sessions !== null).length }));
      if (!apply || changes.length === 0) return;
      for (const change of changes) await tx`update invoice_session_terms set planned_sessions=${change.after} where id=${change.id} and planned_sessions is not distinct from ${change.before}`;
      await tx`insert into audit_logs (tenant_id,actor_name,action,target_type,target_label,metadata) values (${tenant.tenant_id},'시수 기준 전환','session_terms_refresh','invoice_session_term',${period + ' 계획 시수 갱신'},${tx.json({ period, basis: "attendance_units", script: "rebuild-session-plans-units", changes })})`;
      const [preserved] = await tx`select count(*)::integer as n from invoice_session_terms where id in ${tx(terms.map((t) => t.id))} and confirmed_sessions is not null`;
      if (preserved.n !== terms.filter((t) => t.confirmed_sessions !== null).length) throw new Error("Confirmation count changed");
    });
  }
} finally { await sql.end({ timeout: 2 }); }
