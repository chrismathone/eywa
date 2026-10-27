// One additive feature migration only. Fixtures and their notifications always roll back.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { readMigration } from "../src/lib/db/migrations-corpus.mjs";
const mode=process.argv[2]??'--check';
if(!['--check','--apply','--upgrade','--groups','--alignment','--test','--test-groups'].includes(mode)) throw new Error('Unknown mode.');
const connection=new URL(process.env.DATABASE_URL??'missing:');
const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL??'missing:').hostname.split('.')[0];
if(!ref || !(connection.hostname===`db.${ref}.supabase.co` || decodeURIComponent(connection.username).endsWith(`.${ref}`))) throw new Error('Database and app project do not match.');
const sql=postgres(connection.toString(),{ssl:'require',prepare:false,max:1,connect_timeout:15,onnotice:()=>{}});
try {
 const [state]=await sql`select to_regclass('public.withdrawal_reports')::text as report_table,
  to_regclass('public.lab_menu_assignments')::text as laboratory_table,
  to_regprocedure('public.is_super_admin(uuid)')::text as account_function`;
 console.log(JSON.stringify({project:ref,...state}));
 if(mode==='--apply') {
  if(state.report_table) throw new Error('Report table already exists; inspect before applying again.');
  if(!state.laboratory_table || !state.account_function) throw new Error('Required schema is missing.');
  await sql.unsafe(readMigration("0415a_withdrawal_reports.sql"));
  await sql`notify pgrst, 'reload schema'`;
  console.log('Applied withdrawal report migration.');
 }
 if(mode==='--upgrade') {
  if(!state.report_table) throw new Error('Apply the report migration first.');
  await sql.unsafe(readMigration("0416a_withdrawal_report_reasons.sql"));
  await sql.unsafe(readMigration("0417a_withdrawal_report_request_recovery.sql"));
  await sql`notify pgrst, 'reload schema'`;
  console.log('Updated report reason choices and stuck-request cancellation.');
 }
 if(mode==='--groups') {
  if(await sql`select 1 from pg_class where oid=to_regclass('public.withdrawal_report_groups')`.then(r=>r.length)) throw new Error('Group schema already exists.');
  for(const path of ['0420a_withdrawal_report_groups.sql','0421a_withdrawal_report_group_transitions.sql','0422a_withdrawal_report_archives.sql','0423a_withdrawal_report_assignment_check.sql','0424a_withdrawal_report_review_assignment_check.sql']) await sql.unsafe(readMigration(path));
  await sql`notify pgrst, 'reload schema'`;
  console.log('Applied report groups, optional principals, archive storage.');
 }
 if(mode==='--alignment') {
  await sql.unsafe(readMigration("0424a_withdrawal_report_review_assignment_check.sql"));
  await sql`notify pgrst, 'reload schema'`;
  console.log('Added live assignment verification on submission.');
 }
 if(mode==='--test' || mode==='--test-groups') {
  const results=await sql.unsafe(readFileSync(mode==='--test'?'supabase/tests/withdrawal_reports.sql':'supabase/tests/withdrawal_report_groups.sql','utf8'));
  const lines=results.flatMap(r=>Array.isArray(r)?r.flatMap(row=>Object.values(row)):Object.values(r)).filter(v=>typeof v==='string').join('\n');
  console.log(lines.split('\n').filter(line=>/^(ok |not ok |1\.\.|#)/.test(line)).join('\n'));
  if(/not ok|Looks like you failed|planned .+ but ran/i.test(lines) || !(lines.match(/^ok \d+ /gm)?.length>=20)) process.exitCode=1;
  const [fixtures]=await sql`select count(*)::int as remaining from public.tenants where id in ('10000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000902')`;
  if(fixtures.remaining!==0) throw new Error('Test fixtures were not rolled back.');
 }
 if(mode==='--apply' || state.report_table) {
  const [guard]=await sql`select (select bool_and(relrowsecurity) from pg_class where oid in ('public.withdrawal_reports'::regclass,'public.withdrawal_report_events'::regclass)) as rls,
   has_table_privilege('authenticated','public.withdrawal_reports','select') as client_read,
   has_table_privilege('authenticated','public.withdrawal_reports','update') as client_write,
   has_function_privilege('authenticated','public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)','execute') as client_rpc,
   exists(select 1 from public.lab_menu_assignments where menu_key='withdrawal_reports') as laboratory`;
  console.log(JSON.stringify(guard));
  if(!guard.rls||guard.client_read||guard.client_write||guard.client_rpc||!guard.laboratory) throw new Error('Report permission verification failed.');
 }
} catch(error) {
 await sql`rollback`.catch(()=>{});
 console.error(JSON.stringify({code:error.code??'ERROR',message:error.message.replace(/postgres(?:ql)?:\/\/\S+/gi,'[database-url]')}));
 process.exitCode=1;
} finally {await sql.end({timeout:5});}
