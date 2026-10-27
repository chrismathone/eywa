/** 로컬 메모리 PostgreSQL에서만 검사. DATABASE_URL이나 네트워크 DB를 사용하지 않는다. */
import assert from "node:assert/strict";
import { PGlite } from "../../work/student-contribution-sql-check/node_modules/@electric-sql/pglite/dist/index.js";
import { readMigration } from "../../src/lib/db/migrations-corpus.mjs";
const db = new PGlite();
const tenant = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const student = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", outsider = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const keys = ["referralConsult", "referralStarted", "tuitionWon", "subjectMonths", "tenureYears", "perfectMonths", "videoMonths", "examMonths", "parentPositiveMonths", "teacherPositiveMonths"];
const raws = (values = {}) => Object.fromEntries(keys.map((k) => [k, values[k] ?? 0]));
let checks = 0;
async function rejects(sql, params = [], expected) { await assert.rejects(db.query(sql, params), expected); checks++; }
try {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table tenants(id uuid primary key); create table users(id uuid primary key); create table students(id uuid primary key,tenant_id uuid references tenants(id));");
  await db.query("insert into tenants values ($1),($2)", [tenant, other]);
  await db.query("insert into students values ($1,$2),($3,$4)", [student, tenant, outsider, other]);
  for (const file of ["0442a_student_contribution.sql", "0443a_student_contribution_functions.sql", "0456a_student_parent_events.sql", "0457a_student_participation_units.sql"])
    await db.exec(readMigration(file));
  const tables = ["student_contribution_settings", "student_contribution_months", "student_positive_signals"];
  const security = await db.query("select relname,relrowsecurity from pg_class where relname = any($1)", [tables]);
  assert.equal(security.rows.length, 3); assert.ok(security.rows.every((r) => r.relrowsecurity)); checks++;
  assert.equal((await db.query("select * from pg_policies where tablename = any($1)", [tables])).rows.length, 0); checks++;
  await db.exec("set role authenticated");
  await rejects("select * from student_contribution_months");
  await rejects("select claim_student_contribution_refresh($1)", [tenant]);
  await db.exec("reset role");
  const token = (await db.query("select claim_student_contribution_refresh($1) token", [tenant])).rows[0].token;
  assert.ok(token); assert.equal((await db.query("select claim_student_contribution_refresh($1) token", [tenant])).rows[0].token, null); checks++;
  const row = (month, values, closed = null) => ({ student_id: student, month, raws: raws(values), correction: raws(), payload: {}, historical: [], unavailable: [], closed_at: closed, reconstructed: !!closed, computed_at: "2026-10-22T00:00:00Z" });
  const save = "select save_student_contribution_months($1,$2,$3,$4) written";
  const past = row("2026-09", { tuitionWon: 100000000000, referralConsult: 3 }, "2026-10-01T00:00:00Z");
  const open = row("2026-10", { tuitionWon: 200000 }); open.correction = raws({ tuitionWon: -50000 });
  assert.equal((await db.query(save, [tenant, token, 0, JSON.stringify([past, open])])).rows[0].written, 2); checks++;
  await rejects("update student_contribution_months set raws=$1 where tenant_id=$2 and month='2026-09'", [raws(), tenant]);
  await rejects("delete from student_contribution_months where tenant_id=$1 and month='2026-09'", [tenant]);
  assert.equal((await db.query(save, [tenant, token, 0, JSON.stringify([past])])).rows[0].written, 0); checks++;
  const total = (await db.query("select * from student_contribution_totals($1,$2,$3)", [tenant, [student], "2026-10"])).rows[0];
  assert.equal(total.raws.tuitionWon, 100000150000); assert.equal(total.recent.tuitionWon, 150000); checks++;
  assert.equal((await db.query("select * from student_contribution_totals($1,$2,$3)", [other, [student], "2026-01"])).rows.length, 0); checks++;
  await rejects(save, [tenant, token, 1, JSON.stringify([open])]);
  await rejects(save, [tenant, null, 0, JSON.stringify([open])]);
  await rejects(save, [tenant, token, 0, JSON.stringify([{ ...open, student_id: outsider }])]);
  await rejects(save, [tenant, token, 0, JSON.stringify([{ ...open, raws: raws({ tuitionWon: 1.2 }) }])]);
  await rejects(save, [tenant, token, 0, JSON.stringify([{ ...open, raws: raws({ tuitionWon: 9007199254740992 }) }])]);
  const newRaw = { ...raws(), perfectWeeks: 4, videoAssignments: 12 };
  const newCorrection = { ...raws(), perfectWeeks: -1, videoAssignments: 2 };
  await db.query(save, [tenant, token, 0, JSON.stringify([{ ...open, raws: newRaw, correction: newCorrection }])]); checks++;
  const updated = (await db.query("select * from student_contribution_totals($1,$2,$3)", [tenant, [student], "2026-10"])).rows[0];
  assert.equal(updated.raws.perfectWeeks, 3); assert.equal(updated.raws.videoAssignments, 14); checks++;
  for (const key of ["perfectWeeks", "videoAssignments"]) for (const invalid of [null, "1", 1.5, 9007199254740992]) {
    await rejects(save, [tenant, token, 0, JSON.stringify([{ ...open, raws: { ...newRaw, [key]: invalid } }])], /학습·참여 실적의 수치를 확인/);
    await rejects(save, [tenant, token, 0, JSON.stringify([{ ...open, correction: { ...newCorrection, [key]: invalid } }])], /학습·참여 실적의 수치를 확인/);
  }
  await db.query("insert into student_positive_signals(tenant_id,student_id,source,source_id,source_hash,occurred_on,classification,method) values($1,$2,'parent',$3,'hash','2026-10-01','observed','ai')", [tenant, student, student]); checks++;
  await rejects("insert into student_positive_signals(tenant_id,student_id,source,source_id,source_hash,occurred_on,classification,method) values($1,$2,'parent',$3,'hash','2026-10-01','observed','ai')", [tenant, outsider, outsider]);
  await db.query("select finish_student_contribution_refresh($1,$2,true)", [tenant, token]);
  assert.equal((await db.query("select history_ready from student_contribution_settings where tenant_id=$1", [tenant])).rows[0].history_ready, true); checks++;
  console.log(JSON.stringify({ memoryOnly: true, checks, result: "passed" }));
} finally { await db.close(); }
