/** Explicit tenant only. Dry run by default; --apply requires the reviewed plan via --plan=<path>.
 * node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/_maintenance/rename-closed-classes.mts
 *   --tenant=<uuid> --plan=output/closed-class-names.json [--undated=YYYY-MM-DD] [--apply]
 * Undated is a user-approved name housekeeping date, never a synthetic classes.closed_at.
 * Hidden makeup pools are ongoing system containers, not retired classes; never rename them here.
 */
import postgres from "postgres";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { nextClosedClassName } from "../../src/features/classes/closed-name";

const option = (name: string) =>
  process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const tenant = option("tenant"),
  path = option("plan"),
  undated = option("undated");
const apply = process.argv.includes("--apply");
if (!tenant || !/^[a-f0-9-]{36}$/.test(tenant) || !path)
  throw new Error("--tenant and --plan are required");
type Row = {
  id: string;
  class_name: string;
  subject: string;
  is_active: boolean;
  is_makeup_pool: boolean;
  closed_at: string | null;
  audit_date: string | null;
  enrollment_date: string | null;
};
type Change = {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  basis: string;
};
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
try {
  await sql.begin(
    apply ? "isolation level serializable" : "isolation level repeatable read read only",
    async (tx) => {
      await tx`set local lock_timeout='5s'`;
      const [clock] = await tx<
        { today: string }[]
      >`select (now() at time zone 'Asia/Seoul')::date::text as today`;
      if (apply) await tx`select id from classes where tenant_id=${tenant} order by id for update`;
      const rows = await tx<Row[]>`select c.id,c.class_name,c.subject,c.is_active,c.is_makeup_pool,c.closed_at::text,
      (select to_char(max(a.created_at) at time zone 'Asia/Seoul','YYYY-MM-DD') from audit_logs a
        where a.tenant_id=c.tenant_id and a.metadata->>'classId'=c.id::text
          and a.action in ('class_archive','class_end_term')) as audit_date,
      (select max(e.end_date)::text from enrollments e where e.tenant_id=c.tenant_id and e.class_id=c.id
        and e.withdrawal_reason in ('종강','반 폐지')) as enrollment_date
      from classes c where c.tenant_id=${tenant} order by c.id`;
      const inactive = rows.filter(
        (r) => !r.is_makeup_pool && (!r.is_active || (r.closed_at && r.closed_at <= clock!.today)),
      );
      const changes: Change[] = [],
        missing: string[] = [];
      for (const r of inactive) {
        const date =
          r.closed_at && r.closed_at <= clock!.today
            ? r.closed_at
            : (r.audit_date ?? r.enrollment_date ?? undated);
        if (!date) {
          missing.push(r.id);
          continue;
        }
        const to = nextClosedClassName(
          r.class_name,
          date,
          rows.filter((v) => v.subject === r.subject && v.id !== r.id).map((v) => v.class_name),
        );
        if (to === r.class_name) continue;
        changes.push({
          id: r.id,
          subject: r.subject,
          from: r.class_name,
          to,
          date,
          basis:
            r.closed_at && r.closed_at <= clock!.today
              ? "closed_at"
              : r.audit_date
                ? "closure_audit"
                : r.enrollment_date
                  ? "enrollment_end"
                  : "approved_housekeeping_date",
        });
        r.class_name = to;
      }
      const plan = {
        tenant,
        today: clock!.today,
        total: rows.length,
        excludedMakeupPools: rows.filter((r) => r.is_makeup_pool).length,
        inactive: inactive.length,
        changes,
        missing,
      };
      if (!apply) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(plan, null, 2), { flag: "wx" });
      } else {
        const reviewed = JSON.parse(readFileSync(path, "utf8"));
        if (JSON.stringify(reviewed) !== JSON.stringify(plan))
          throw new Error("Plan changed; run and review a fresh dry run.");
        const ids = changes.map((r) => r.id);
        const fingerprint = async () => {
          const [v] = await tx`select
          (select md5(string_agg(to_jsonb(e)::text,'' order by id)) from enrollments e where tenant_id=${tenant} and class_id=any(${ids}::uuid[])) as enrollments,
          (select md5(string_agg(to_jsonb(a)::text,'' order by id)) from attendance_records a where tenant_id=${tenant} and class_id=any(${ids}::uuid[])) as attendance,
          (select md5(string_agg((to_jsonb(c)-'class_name'-'updated_at')::text,'' order by id)) from classes c where tenant_id=${tenant}) as classes`;
          return v;
        };
        const before = await fingerprint();
        for (const c of changes) {
          const updated = await tx`update classes set class_name=${c.to}
          where tenant_id=${tenant} and id=${c.id} and subject=${c.subject} and class_name=${c.from}
            and not is_makeup_pool and (not is_active or closed_at <= ${clock!.today}::date) returning id`;
          if (updated.length !== 1) throw new Error(`Concurrent change: ${c.id}`);
          await tx`insert into audit_logs(tenant_id,actor_name,action,target_type,target_label,metadata)
          values(${tenant},'시스템(요청한 반 이름 정리)','class_update','class',${c.to},
            ${tx.json({
              classId: c.id,
              fromName: c.from,
              toName: c.to,
              nameDate: c.date,
              dateBasis: c.basis,
              note: "사용자 요청: 비활성·종강 반 이름에 종료일 표시. 반 상태·수강·출결은 유지.",
            })})`;
        }
        const after = await fingerprint();
        if (JSON.stringify(before) !== JSON.stringify(after))
          throw new Error("Non-name data changed; aborting.");
        const duplicates = await tx`select subject,class_name from classes where tenant_id=${tenant}
        group by subject,class_name having count(*) > 1`;
        if (duplicates.length) throw new Error("Duplicate class names remain; aborting.");
      }
      console.log(
        JSON.stringify({
          applied: apply,
          total: plan.total,
          excludedMakeupPools: plan.excludedMakeupPools,
          inactive: plan.inactive,
          renamed: changes.length,
          missingDates: missing.length,
          plan: path,
        }),
      );
    },
  );
} finally {
  await sql.end();
}
