// Dry-run creates a complete before snapshot and a reviewable plan. --apply uses that
// exact plan, rejects concurrent changes, updates only confirmed monthly EiE terms,
// and verifies that invoices, prices and all other term fields remain unchanged.
import postgres from "postgres";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isDeepStrictEqual } from "node:util";
import { teacherFourWeekWeights } from "../../src/features/attendance/teacher-term-share.ts";

const { values } = parseArgs({ options: {
  tenant: { type: "string" }, month: { type: "string" }, reference: { type: "string" },
  out: { type: "string" }, apply: { type: "boolean" },
} });
const { tenant, month, reference, out } = values;
if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(tenant ?? "")
  || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(reference ?? "")
  || reference.slice(0, 7) !== month || !out) throw new Error("Required: --tenant UUID --month YYYY-MM --reference YYYY-MM-DD --out directory");
await mkdir(out, { recursive: true });
const planPath = join(out, "plan.json");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
async function snapshot(db, lock = false) {
  const terms = await db`select to_jsonb(t) as record, i.student_id, c.class_name
    from invoice_session_terms t join invoices i on i.id=t.invoice_id and i.tenant_id=t.tenant_id
    join classes c on c.id=t.class_id and c.tenant_id=t.tenant_id
    where t.tenant_id=${tenant} and i.period=${month} and i.status<>'void'
    and c.subject='english' and c.english_track='eie' and t.confirmed_sessions is not null
    order by t.id ${lock ? db`for update of t` : db``}`;
  if (!terms.length) throw new Error("No confirmed EiE terms in this scope");
  const ids = [...new Set(terms.map((t) => t.record.class_id))];
  const classes = await db`select id,class_name,teacher_id from classes where tenant_id=${tenant} and id in ${db(ids)} order by id`;
  const schedules = await db`select to_jsonb(s) as record from class_schedules s where tenant_id=${tenant}
    and class_id in ${db(ids)} and valid_from<=${reference} and (valid_to is null or valid_to>=${reference}) order by id`;
  const invoiceIds = [...new Set(terms.map((t) => t.record.invoice_id))];
  const invoices = await db`select to_jsonb(i) as record from invoices i where tenant_id=${tenant} and id in ${db(invoiceIds)} order by id`;
  return JSON.parse(JSON.stringify({ terms, classes, schedules, invoices }));
}
function buildPlan(before) {
  if (before.terms.some((t) => t.record.pricing_mode !== "monthly")) throw new Error("Non-monthly EiE term needs a separate price review");
  const pairs = new Set(before.terms.map((t) => `${t.record.class_id}:${t.student_id}`));
  if (pairs.size !== before.terms.length) throw new Error("Multiple confirmed invoices for the same student/class; cannot assign a full term to each");
  const quantities = new Map();
  const shares = [];
  for (const c of before.classes) {
    const schedules = before.schedules.map((s) => s.record).filter((s) => s.class_id === c.id).map((s) => ({
      teacherId: s.teacher_id, dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time,
      slotTeacherLabel: s.slot_teacher_label, labSeparate: s.lab_separate, validFrom: s.valid_from, validTo: s.valid_to,
    }));
    const weights = teacherFourWeekWeights({ referenceDate: reference, schedules, homeroomTeacherId: c.teacher_id, className: c.class_name });
    const units = [...weights.values()].reduce((sum, n) => sum + n, 0);
    if (!Number.isFinite(units) || units <= 0 || units > 99 || units * 2 !== Math.round(units * 2)) throw new Error(`Invalid four-week total: ${c.class_name}`);
    quantities.set(c.id, units);
    shares.push({ classId: c.id, className: c.class_name, units, shares: [...weights] });
  }
  const targets = before.terms.map((t) => ({ id: t.record.id, className: t.class_name, before: Number(t.record.confirmed_sessions), after: quantities.get(t.record.class_id) }));
  return { tenant, month, reference, before, shares, targets };
}
function summarize(plan) {
  return { month, reference, terms: plan.targets.length, changed: plan.targets.filter((t) => t.before !== t.after).length,
    classes: plan.shares.map((s) => ({ className: s.className, units: s.units, terms: plan.targets.filter((t) => t.className === s.className).length })) };
}
try {
  if (!values.apply) {
    const plan = await sql.begin("isolation level repeatable read read only", async (db) => buildPlan(await snapshot(db)));
    await writeFile(planPath, JSON.stringify(plan, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ mode: "dry-run", ...summarize(plan) }, null, 2));
  } else {
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    if (plan.tenant !== tenant || plan.month !== month || plan.reference !== reference) throw new Error("Plan scope does not match arguments");
    const receipt = await sql.begin("isolation level serializable", async (db) => {
      const before = await snapshot(db, true);
      if (!isDeepStrictEqual(before, plan.before)) throw new Error("Data changed since dry-run; create a new plan before applying");
      if (!isDeepStrictEqual(buildPlan(before).targets, plan.targets)) throw new Error("The reviewed calculation changed");
      const changed = [];
      for (const target of plan.targets.filter((t) => t.before !== t.after)) {
        const original = before.terms.find((t) => t.record.id === target.id).record;
        const updated = await db`update invoice_session_terms t set confirmed_sessions=${target.after}, quantity_basis='attendance_units',
          confirmed_by=null, confirmed_at=now(), updated_at=now()
          where id=${target.id} and tenant_id=${tenant} and to_jsonb(t)=${db.json(original)} returning id`;
        if (updated.length !== 1) throw new Error(`Confirmation changed concurrently: ${target.id}`);
        await db`insert into audit_logs (tenant_id,actor_name,action,target_type,target_label,metadata)
          values (${tenant},'Codex · 사용자 요청','session_term_monthly_units','invoice_session_term',${`${month} ${target.className} · 4주 확정`},
          ${db.json({ termId: target.id, sessions: target.after, previousSessions: target.before, amountPreserved: original.amount,
            unitPricePreserved: original.unit_price, period: month, referenceDate: reference, basis: "four_weeks", excluded: "*LAB", script: "confirm-eie-four-weeks" })})`;
        changed.push(target);
      }
      const after = await snapshot(db);
      if (!isDeepStrictEqual(before.invoices, after.invoices)) throw new Error("Invoices changed; rolling back");
      for (const row of after.terms) {
        const original = before.terms.find((t) => t.record.id === row.record.id).record;
        const target = plan.targets.find((t) => t.id === row.record.id);
        if (Number(row.record.confirmed_sessions) !== target.after) throw new Error("Confirmation verification failed");
        const allowed = new Set(["confirmed_sessions", "confirmed_at", "confirmed_by", "updated_at", "quantity_basis"]);
        for (const key of Object.keys(original)) {
          if (!allowed.has(key) && !isDeepStrictEqual(original[key], row.record[key])) throw new Error(`Unexpected field change: ${key}`);
        }
      }
      return { appliedAt: new Date().toISOString(), ...summarize(plan), changed, invoicesPreserved: true, after };
    });
    await writeFile(join(out, "applied.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ mode: "applied", ...summarize(plan), invoicesPreserved: receipt.invoicesPreserved }, null, 2));
  }
} finally { await sql.end(); }
