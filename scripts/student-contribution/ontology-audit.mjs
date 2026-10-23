/** P0: aggregate-only inventory, enforced read-only by PostgreSQL. No source bodies or contacts. */
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";

const connection = new URL(process.env.DATABASE_URL ?? "missing:");
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "missing:").hostname.split(".")[0];
if (!ref || !(connection.hostname === `db.${ref}.supabase.co` || decodeURIComponent(connection.username).endsWith(`.${ref}`))) {
  throw new Error("Database project mismatch");
}
const tenant = "becaa316-e636-42e9-9d09-08b133e0b094";
const tables = ["students", "enrollments", "classes", "class_schedules", "student_consultations", "student_notes",
  "student_siblings", "makeup_reservations", "makeup_cases", "makeup_legacy_maps", "attendance_records",
  "student_homework_videos", "student_grades", "student_positive_signals", "classnote_parent_messages", "classnote_parent_replies",
  "student_memos", "lesson_reports", "textbook_orders", "homework_video_ledger_videos", "math_learning_goals", "math_learning_track_goals",
  "math_learning_records", "shuttle_riders", "shuttle_boardings", "academy_documents", "notifications", "student_ontology_summaries"];
const db = postgres(connection.toString(), { ssl: "require", prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const started = performance.now();
  const result = await db.begin("read only", async (sql) => {
    await sql`set local statement_timeout = '45s'`;
    const [checkedTenant] = await sql`select id from public.tenants where id=${tenant}`;
    if (!checkedTenant) throw new Error("Pilot tenant missing");
    const columns = await sql`select table_name, column_name from information_schema.columns
      where table_schema='public' and table_name in ${sql(tables)}`;
    const inventory = [];
    for (const table of tables) {
      const names = columns.filter((c) => c.table_name === table).map((c) => c.column_name);
      if (!names.includes("tenant_id")) { inventory.push({ table, state: names.length ? "no_tenant_column" : "schema_missing", columns: names }); continue; }
      const tick = performance.now();
      const [count] = await sql`select count(*)::int as rows from ${sql("public." + table)} where tenant_id=${tenant}`;
      const states = names.includes("status") ? await sql`select status, count(*)::int as rows
        from ${sql("public." + table)} where tenant_id=${tenant} group by status order by status` : [];
      inventory.push({ table, state: "ready", ...count, states, columns: names, ms: Math.round(performance.now() - tick) });
    }
    const settings = await sql`select data->'makeups'->>'mode' as makeup_mode from public.tenant_settings where tenant_id=${tenant}`;
    const rpc = await sql`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and proname in ('makeup_list_cases','makeup_case_detail','makeup_list_participants')`;
    const identity = await sql`select count(*)::int as merged,
      count(*) filter(where not exists(select 1 from public.students target where target.tenant_id=s.tenant_id
        and target.id::text=substring(ltrim(s.notes) from '^중복 병합:[[:space:]]*([^[:space:]]+)와 통합됨')))::int as missing_target
      from public.students s where s.tenant_id=${tenant} and ltrim(s.notes) like '중복 병합:%'`;
    return { checkedAt: new Date().toISOString(), tenant, readOnly: true, settings, rpc, identity, inventory };
  });
  result.elapsedMs = Math.round(performance.now() - started);
  mkdirSync("work", { recursive: true });
  writeFileSync("work/student-ontology-audit.json", JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({ ...result, inventory: result.inventory.map(({ columns, ...rest }) => ({ ...rest, columnCount: columns.length })) }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? "ERROR", message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, "[database-url]") }));
  process.exitCode = 1;
} finally { await db.end({ timeout: 5 }); }
