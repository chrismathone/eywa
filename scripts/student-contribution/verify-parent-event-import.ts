/** Run with tsx. Tests the actual import code against a local, in-memory PostgreSQL database only. */
import assert from "node:assert/strict";
import type { Sql } from "postgres";
import { buildEventBundle, type EventSourcePack } from "./parent-events/bundle";
import { readEventDatabase } from "./parent-events/snapshot";
import { applyInitialEvents, revokeEventImport } from "./parent-events/import-write";
import { hash } from "./parent-events/source-values";
import { readMigration } from "../../src/lib/db/migrations-corpus.mjs";
const tenant = "11111111-1111-4111-8111-111111111111", student = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", owner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
// PGlite는 저장소 밖 로컬 설치(`work/sql-check`, docs/runbooks/student-parent-events.md)에서 실행 때 불러온다 — 정적 import면 그 설치가 없는
// 곳(다른 PC·워크트리)의 타입 검사가 늘 실패한다(수정 계획 P0-3). 쓰는 메서드만 타입으로 둔다.
const PGLITE_PATH = "../../work/sql-check/node_modules/@electric-sql/pglite/dist/index.js";
type PgLiteDb = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: PgLiteDb) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};
let db: PgLiteDb;
let sql: Sql;
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
function adapter(connection: Queryable): Sql {
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => (await connection.query(strings.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), values.map(v => v instanceof Date ? v.toISOString() : v))).rows;
  return Object.assign(tagged, { unsafe: async (q: string, values: unknown[]) => (await connection.query(q, values)).rows,
    json: JSON.stringify, begin: async (_mode: string, fn: (sql: Sql) => Promise<unknown>) => db.transaction(tx => fn(adapter(tx))) }) as unknown as Sql;
}
const header = ["학생", "전화", "취소", "회차"];
const pack: EventSourcePack = { capturedAt: "2026-10-26T00:00:00Z", sources: [{ fileId: "file", title: "설명회", sheet: "신청", gid: 1,
  url: "https://docs.google.com/spreadsheets/d/file/edit", values: [header, ["가학생", "01023456789", "FALSE", "오전"], ["가학생", "01023456789", "FALSE", "오후"]] }], profiles: [{ fileId: "file", sheet: "신청", gid: 1,
  blocks: [{ start: 0, end: 4, firstRow: 1, headerRow: 0, headerHash: hash(header), eventKey: "event", title: "설명회", date: "2025-01-01", tenantId: tenant, eligibleList: true,
    sessionColumn: 3, sessionMap: { 오전: "am", 오후: "pm" }, sameDayReviewed: true,
    issues: [], name: 0, phone: 1, markers: [{ column: 2, kind: "cancellation" }] }] }] };
let checks = 0;
async function rejects(fn: () => Promise<unknown>, match: RegExp) { await assert.rejects(fn, match); checks++; }
async function main() {
  const { PGlite } = (await import(PGLITE_PATH)) as { PGlite: new () => PgLiteDb };
  db = new PGlite();
  sql = adapter(db);
  try {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table tenants(id uuid primary key); create table users(id uuid primary key,tenant_id uuid,system_role text,status text,display_name text); create table students(id uuid primary key,tenant_id uuid,name text,parent_name text,parent_phone text,student_phone text,school text,grade text,status text,notes text,is_test boolean,enrolled_at date,withdrawn_at date); create table student_siblings(tenant_id uuid,student_a uuid,student_b uuid,linked boolean); create table audit_logs(tenant_id uuid,actor_id uuid,actor_name text,action text,target_type text,target_label text,metadata jsonb);");
  await db.query("insert into tenants values($1)", [tenant]);
  await db.exec("alter table students add column withdrawal_metadata jsonb; create table enrollments(id uuid,tenant_id uuid,student_id uuid,start_date date,end_date date);");
  await db.query("insert into users values($1,$2,'master','active','owner')", [owner, tenant]);
  await db.query("insert into students(id,tenant_id,name,parent_name,parent_phone,status,is_test) values($1,$2,'가학생','가보호','01023456789','enrolled',false)", [student, tenant]);
  for (const file of ["0442a_student_contribution.sql", "0443a_student_contribution_functions.sql", "0456a_student_parent_events.sql"])
    await db.exec(readMigration(file));
  await db.query("insert into student_contribution_settings(tenant_id) values($1)", [tenant]);
  const privacyKey = "synthetic-key-for-local-tests-only";
  const report = buildEventBundle(await readEventDatabase(sql, tenant), pack, "2026-10-26", privacyKey);
  const options = { owner, approvedFingerprint: report.fingerprint, scoringApproved: false, privacyKey };
  const verifySources = async () => {};
  const apply = () => applyInitialEvents(sql, report, pack, options, verifySources);
  await rejects(() => applyInitialEvents(sql, report, pack, { ...options, approvedFingerprint: "0".repeat(64) }, verifySources), /fingerprint/);
  await rejects(() => applyInitialEvents(sql, report, pack, options, async () => { throw new Error("source changed"); }), /source changed/);
  await rejects(() => applyInitialEvents(sql, report, pack, { ...options, owner: student }, verifySources), /Approval owner/);
  await db.query("update student_contribution_settings set refresh_token=gen_random_uuid() where tenant_id=$1", [tenant]);
  await rejects(apply, /Aggregation is running/);
  await db.query("update student_contribution_settings set refresh_token=null where tenant_id=$1", [tenant]);
  await db.query("update students set parent_phone='01098765432' where id=$1", [student]);
  await rejects(apply, /Data or mapping changed/);
  await db.query("update students set parent_phone='01023456789' where id=$1", [student]);
  assert.equal((await db.query("select count(*)::int n from student_parent_event_imports")).rows[0]!.n, 0); checks++;
  // A mid-import failure must roll back the event, registration, revision, recognition and import marker together.
  await db.exec("create function reject_test_audit() returns trigger language plpgsql as $$ begin raise exception 'test audit failure'; end; $$; create trigger audit_test before insert on audit_logs for each row execute function reject_test_audit();");
  await rejects(apply, /test audit failure/);
  assert.equal((await db.query("select count(*)::int n from student_parent_event_imports")).rows[0]!.n, 0); checks++;
  await db.exec("drop trigger audit_test on audit_logs");
  const applied = await applyInitialEvents(sql, report, pack, { ...options, scoringApproved: true }, verifySources); assert.equal(applied.count, 2); checks++;
  assert.deepEqual((await db.query("select session from student_parent_events order by session")).rows.map(r => r.session), ["am", "pm"]); checks++;
  assert.equal((await apply()).alreadyApplied, true); checks++;
  const settings = (await db.query("select config,revision from student_contribution_settings where tenant_id=$1", [tenant])).rows[0]!;
  assert.deepEqual(settings.config, {}); assert.equal(settings.revision, 1); checks++;
  const approval = (await db.query("select scoring_approved_at,summary from student_parent_event_imports")).rows[0]!;
  assert.ok(approval.scoring_approved_at); assert.deepEqual((approval.summary as { approvedRate: unknown }).approvedRate, { group: "operations", points: 5 }); checks++;
  await rejects(() => revokeEventImport(sql, tenant, applied.id, "0".repeat(64), owner, "wrong fingerprint"), /fingerprint/);
  await revokeEventImport(sql, tenant, applied.id, report.fingerprint, owner, "reviewed rollback"); checks++;
  const snapshot = (await db.query("select student_parent_event_snapshot($1) value", [tenant])).rows[0]!.value as { records: unknown[] };
  assert.equal(snapshot.records.length, 0); checks++;
  assert.equal((await db.query("select count(*)::int n from student_parent_event_revisions")).rows[0]!.n, 2); checks++;
  assert.equal((await revokeEventImport(sql, tenant, applied.id, report.fingerprint, owner, "same rollback")).alreadyRevoked, true); checks++;
  await rejects(apply, /Existing import history/);
  console.log(JSON.stringify({ memoryOnly: true, checks, result: "passed" }));
} finally { await db.close(); } }
main().catch(error => { console.error(error); process.exitCode = 1; });
