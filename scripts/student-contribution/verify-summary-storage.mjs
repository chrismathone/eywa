// Disposable in-memory PostgreSQL only. No environment files or operating DB connections.
// node scripts/student-contribution/verify-summary-storage.mjs <path-to-pglite/dist/index.js>
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Pass the isolated PGlite module path");
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const tenant = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const student = "00000000-0000-4000-8000-000000000003";
const user = "00000000-0000-4000-8000-000000000004";
const foreignUser = "00000000-0000-4000-8000-000000000005";
const token = "00000000-0000-4000-8000-000000000006";
const nextToken = "00000000-0000-4000-8000-000000000007";
let checks = 0;
const check = (condition) => { assert.ok(condition); checks++; };
async function denied(sql, params = []) { await assert.rejects(db.query(sql, params)); checks++; }
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.tenants(id uuid primary key);
    create table public.students(id uuid primary key, tenant_id uuid references tenants(id));
    create table public.users(id uuid primary key, tenant_id uuid references tenants(id));
    grant select on tenants, students, users to service_role;
  `);
  await db.query("insert into tenants values ($1),($2)", [tenant, other]);
  await db.query("insert into students values ($1,$2)", [student, tenant]);
  await db.query("insert into users values ($1,$2),($3,$4)", [user, tenant, foreignUser, other]);
  const migration = await readFile("supabase/migrations/0445a_student_ontology_summaries.sql", "utf8");
  await db.exec(migration); await db.exec(migration); checks++;
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await denied("select * from student_ontology_summaries");
    await denied("select reserve_student_ontology_summary_call($1)", [tenant]);
    await denied("select * from student_ontology_summary_daily_usage");
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  const insert = "insert into student_ontology_summaries(tenant_id,student_id,requested_by,request_token,requested_at) values ($1,$2,$3,$4,now())";
  await denied(insert, [other, student, foreignUser, token]);
  await denied(insert, [tenant, student, foreignUser, token]);
  await db.query(insert, [tenant, student, user, token]); checks++;
  const competing = await db.query(`${insert} on conflict (tenant_id,student_id,requested_by,purpose) do nothing returning request_token`, [tenant, student, user, nextToken]);
  check(competing.rows.length === 0);
  const claim = "update student_ontology_summaries set request_token=$1, requested_at=now() where tenant_id=$2 and student_id=$3 and requested_by=$4 and (request_token is null or requested_at < now() - interval '120 seconds') returning request_token";
  check((await db.query(claim, [nextToken, tenant, student, user])).rows.length === 0);
  await db.query("update student_ontology_summaries set requested_at=now()-interval '121 seconds' where tenant_id=$1", [tenant]);
  check((await db.query(claim, [nextToken, tenant, student, user])).rows.length === 1);
  check((await db.query("update student_ontology_summaries set request_token=null where request_token=$1 returning student_id", [token])).rows.length === 0);
  check((await db.query("update student_ontology_summaries set request_token=null where request_token=$1 returning student_id", [nextToken])).rows.length === 1);
  await denied("update student_ontology_summaries set result='[]'::jsonb");
  await denied("update student_ontology_summaries set input_hash='invalid'");
  await denied("update student_ontology_summaries set result=jsonb_build_object('text',repeat('x',17000))");
  const attempts = await Promise.all(Array.from({ length: 25 }, () => db.query("select reserve_student_ontology_summary_call($1) as ok", [tenant])));
  check(attempts.filter((r) => r.rows[0].ok).length === 20);
  check((await db.query("select attempts from student_ontology_summary_daily_usage where tenant_id=$1", [tenant])).rows[0].attempts === 20);
  check((await db.query("select reserve_student_ontology_summary_call($1) as ok", [other])).rows[0].ok === true);
  check((await db.query("select usage_date=(now() at time zone 'Asia/Seoul')::date as ok from student_ontology_summary_daily_usage limit 1")).rows[0].ok === true);
  await db.query("update student_ontology_summary_daily_usage set usage_date=usage_date-1 where tenant_id=$1", [tenant]);
  check((await db.query("select reserve_student_ontology_summary_call($1) as ok", [tenant])).rows[0].ok === true);
  console.log(JSON.stringify({ checks, status: "passed", database: "disposable in-memory PostgreSQL", productionWrites: 0 }));
} finally { await db.close(); }
