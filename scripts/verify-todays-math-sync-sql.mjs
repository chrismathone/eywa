/** Real PostgreSQL verification. Never accepts an application/live DB URL.
 * node scripts/verify-todays-math-sync-sql.mjs --reset
 * Uses localhost:55432/eywa_source_test exclusively; the coordinator owns Docker.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A single reserved connection per instance is important for explicit transaction
// and row-lock assertions. Reuse the repository's pinned postgres dependency.
class Client {
  constructor(config) { this.sql=postgres({...config,max:1,onnotice:()=>{},connect_timeout:10}); }
  async connect() { await this.sql`select 1`; }
  async query(text,args=[]) { return {rows:await this.sql.unsafe(text,args)}; }
  async end() { await this.sql.end({timeout:5}); }
}
const config = { host: '127.0.0.1', port: 55432, user: 'postgres', database: 'eywa_source_test' };
const db = new Client(config);
await db.connect();
const read = (name) => readFile(path.join(root,name),'utf8');
const migration = 'supabase/migrations/0337a_todays_math_sync_v2.sql';
async function apply(name) { await db.query(await read(name)); }
let checks = 0;
async function sqlTest(name, file) {
  await apply(file); checks++; console.log(`PASS ${name}`);
}
try {
  assert.equal((await db.query('select current_database() db')).rows[0].db,'eywa_source_test');
  if (process.argv.includes('--reset')) {
    await db.query('drop schema if exists tm_sync_private cascade; drop schema if exists auth cascade; drop schema public cascade; create schema public;');
    await apply('supabase/tests/todays_math_sync_fixture.sql');
    // Exact existing migrations, rather than invented source-table projections.
    for (const name of ['0000_fair_amazoness','0001_parallel_meggan','0013_last_swarm',
      '0021_fat_gideon','0023_amazing_doctor_faustus','0027_big_swordsman',
      '0044a_class_teacher_handover','0049a_lesson_reports','0059a_class_closed_at',
      '0075a_mirror_trigger_role_hardening','0083a_lesson_reports_classnote',
      '0089a_lesson_reports_textbook_makeup','0134a_lesson_reports_class_id',
      '0141a_students_is_test','0171a_lesson_reports_makeup_class','0173a_class_delegations',
      '0274a_class_period_enrollment_end']) await apply(`supabase/migrations/${name}.sql`);
    await apply(migration);
    await apply(migration); // alpha rerun safety
    await apply('supabase/migrations/20261004060214_todays_math_student_phone_tail.sql');
    await apply('supabase/migrations/20261004060214_todays_math_student_phone_tail.sql');
    console.log('PASS migration and rerun against actual source DDL'); checks++;
  }
  await sqlTest('transactional lifecycle, scopes, exports, PKCE and privileges','supabase/tests/todays_math_sync.sql');
  await sqlTest('automatic first ON, repeated bootstrap, OFF/ON identity, operator stop and privileges','supabase/tests/todays_math_sync_automatic.sql');
  await sqlTest('contact tail selection, content refresh, privacy and schema health','supabase/tests/todays_math_student_phone_tail.sql');
  const one = new Client(config); const two = new Client(config);
  await one.connect(); await two.connect();
  const bid='30000000-0000-0000-0000-000000000001';
  const uid='20000000-0000-0000-0000-000000000001';
  const cls='40000000-0000-0000-0000-000000000001';
  const scalar=async (connection,sql,args=[]) => (await connection.query(sql,args)).rows[0].value;
  try {
    await one.query("set statement_timeout='10s'"); await two.query("set statement_timeout='10s'");
    await one.query('begin');
    const first=await scalar(one,'select public.tm_sync_claim_events(1) value');
    const second=await scalar(two,'select public.tm_sync_claim_events(100) value');
    assert.equal(first.length,1); assert(second.length>0);
    assert(!second.some(row=>row.event.eventId===first[0].event.eventId),'SKIP LOCKED must not duplicate first worker claim');
    await one.query('commit');
    console.log('PASS independent connections SKIP LOCKED claim distinct work'); checks++;

    await one.query('begin');
    const nonce='80000000-0000-0000-0000-000000000010';
    assert.equal(await scalar(one,"select public.tm_sync_consume_nonce($1,$2,clock_timestamp()+interval '60 seconds') value",[bid,nonce]),true);
    const competingNonce=scalar(two,"select public.tm_sync_consume_nonce($1,$2,clock_timestamp()+interval '60 seconds') value",[bid,nonce]);
    await one.query('commit');
    assert.equal(await competingNonce,false);
    console.log('PASS concurrent nonce insert has exactly one winner'); checks++;

    const code='e'.repeat(64), state='f'.repeat(64), challenge='G'.repeat(43);
    assert.equal(await scalar(db,'select public.tm_sync_issue_code($1,$2,$3,$4,$5) value',[bid,uid,code,state,challenge]),true);
    const redeemed=await Promise.all([one,two].map(c=>scalar(c,'select public.tm_sync_redeem_code($1,$2,$3,$4) value',[bid,code,state,challenge])));
    assert.equal(redeemed.filter(Boolean).length,1);
    console.log('PASS concurrent PKCE code redemption has exactly one winner'); checks++;

    const before=await scalar(db,'select public.tm_sync_control($1) value',[bid]);
    await one.query('begin');
    await one.query('update public.classes set teacher_id=$2 where id=$1',[cls,'20000000-0000-0000-0000-000000000002']);
    const frozen=await scalar(two,'select public.tm_sync_create_snapshot($1) value',[bid]);
    assert.equal(frozen.securityRevision,before.securityRevision,'Uncommitted source revision invisible');
    const frozenPage=await scalar(two,"select public.tm_sync_snapshot_page($1,$2,'classes',0) value",[bid,frozen.snapshotId]);
    assert.equal(JSON.parse(frozenPage.json).find(c=>c.id===cls).teacherId,uid,'Uncommitted business state invisible');
    await one.query('commit');
    const after=await scalar(two,'select public.tm_sync_create_snapshot($1) value',[bid]);
    assert(BigInt(after.securityRevision)>BigInt(frozen.securityRevision));
    const afterPage=await scalar(two,"select public.tm_sync_snapshot_page($1,$2,'classes',0) value",[bid,after.snapshotId]);
    assert.equal(JSON.parse(afterPage.json).find(c=>c.id===cls).teacherId,'20000000-0000-0000-0000-000000000002');
    assert.equal((await scalar(two,"select public.tm_sync_snapshot_page($1,$2,'classes',0) value",[bid,frozen.snapshotId])).json,frozenPage.json);
    console.log('PASS source mutation and revision visibility are atomic; stored pages remain frozen'); checks++;

    await one.query('begin');
    const older=await scalar(one,'select public.tm_sync_create_snapshot($1) value',[bid]);
    const waiting=scalar(two,'select public.tm_sync_create_snapshot($1) value',[bid]);
    await db.query('update public.classes set teacher_id=$2 where id=$1',[cls,uid]);
    await one.query('commit');
    const newer=await waiting;
    assert(BigInt(newer.contentGeneration)>BigInt(older.contentGeneration));
    assert(BigInt(newer.securityRevision)>BigInt(older.securityRevision),'Waiting export reads after it acquires generation lock');
    console.log('PASS export generation serializes exports without blocking source security commits'); checks++;

    const wire=await import(pathToFileURL(path.join(root,'src/features/integrations/todays-math/sync-contract.ts')).href);
    wire.manifestSchema.parse(newer);
    const pages=[];
    for (const [kind,collection] of Object.entries(newer.collections)) {
      for (const page of collection.pages) pages.push(await scalar(db,'select public.tm_sync_snapshot_page($1,$2,$3,$4) value',[bid,newer.snapshotId,kind,page.page]));
    }
    wire.validateCompleteSnapshot(newer,pages);
    for (const row of first) wire.eventSchema.parse(row.event);
    console.log('PASS actual SQL JSON passes frozen shared TypeScript manifest/page/event contract'); checks++;
  } finally {
    await one.query('rollback'); await two.query('rollback');
    await one.end(); await two.end();
  }
  await sqlTest('recording gap, transport isolation, expiry, cleanup and durable deletion','supabase/tests/todays_math_sync_recovery.sql');
  await sqlTest('serialized wire-page byte bounds, exact hash and atomic rejection','supabase/tests/todays_math_sync_page_bytes.sql');
  console.log(`Completed ${checks} SQL verification groups`);
} finally { await db.end(); }
