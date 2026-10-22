import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const mode=process.argv[2]??'--test';
if(!['--test','--test-reports','--test-report-groups','--apply','--check'].includes(mode)) throw new Error('Unknown mode');
const connection=new URL(process.env.DATABASE_URL??'missing:');
const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL??'missing:').hostname.split('.')[0];
if(!ref || !(connection.hostname===`db.${ref}.supabase.co` || decodeURIComponent(connection.username).endsWith(`.${ref}`))) throw new Error('Project mismatch');
const db=postgres(connection.toString(),{ssl:'require',prepare:false,max:1,connect_timeout:15,onnotice:()=>{}});
const migrations=['0426a_student_status_authority.sql','0427a_student_status_guards.sql',
 '0428a_enrollment_lifecycle_executor.sql','0429a_enrollment_history_delete.sql'];
try {
 const [before]=await db`select md5(coalesce(jsonb_agg(jsonb_build_array(tenant_id,data->'permissions'->'specialAccess'->'studentStatusManagerIds') order by tenant_id)::text,'')) as assignments from public.tenant_settings`;
 if(mode!=='--check') {
  await db`begin`;
  await db`set local lock_timeout='5s'`;
  await db`set local statement_timeout='60s'`;
  for(const name of migrations) await db.unsafe(readFileSync(`supabase/migrations/${name}`,'utf8'));
  if(mode.startsWith('--test')) {
   const fixture=mode==='--test'?'student_status_access.sql':mode==='--test-reports'?'withdrawal_reports.sql':'withdrawal_report_groups.sql';
   let testSql=readFileSync(`supabase/tests/${fixture}`,'utf8').replace(/^begin;\s*/im,'').replace(/rollback;\s*$/i,'');
   if(mode!=='--test') {
    testSql=testSql.replace('create temporary table',`insert into public.tenant_settings(tenant_id,data) values('10000000-0000-4000-8000-000000000901','{"version":1,"preset":"generic","permissions":{"specialAccess":{"studentStatusManagerIds":[]}}}');\ncreate temporary table`);
   }
   const results=await db.unsafe(testSql);
   const lines=results.flatMap(r=>Array.isArray(r)?r.flatMap(row=>Object.values(row)):Object.values(r)).filter(v=>typeof v==='string').join('\n');
   console.log(lines.split('\n').filter(l=>/^(ok |not ok |1\.\.|#)/.test(l)).join('\n'));
   if(/not ok|Looks like you failed/i.test(lines)||!(lines.match(/^ok \d+ /gm)?.length>=25)) process.exitCode=1;
   await db`rollback`;
   const [r]=await db`select count(*)::int as remaining from public.tenants where id in ('10000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000902','10000000-0000-4000-8000-000000000951','10000000-0000-4000-8000-000000000952')`;
   if(r.remaining) throw new Error('Synthetic fixtures were not rolled back');
   const [after]=await db`select md5(coalesce(jsonb_agg(jsonb_build_array(tenant_id,data->'permissions'->'specialAccess'->'studentStatusManagerIds') order by tenant_id)::text,'')) as assignments from public.tenant_settings`;
   if(before.assignments!==after.assignments) throw new Error('Existing status assignments changed during verification');
   console.log(JSON.stringify({syntheticTenantsRemaining:r.remaining,existingAssignmentsUnchanged:true,candidateMigrationsRolledBack:true}));
  } else {
   await db`commit`;
   console.log('Applied status authority functions/triggers; no tenant assignments changed.');
  }
 }
 if(!mode.startsWith('--test')) {
  console.log(JSON.stringify(await db`select proname,prosecdef,pg_get_userbyid(proowner) as owner from pg_proc where pronamespace='public'::regnamespace and proname in ('move_enrollments_batch','move_class_enrollments_batch','change_scheduled_enrollment','delete_enrollment_history') order by proname`));
  console.log(JSON.stringify(await db`select tgname from pg_trigger where tgname in ('zz_student_status_authority','zz_enrollment_status_authority','zz_student_status_settings') order by tgname`));
 }
} catch(e) {
 await db`rollback`.catch(()=>{});
 console.error(JSON.stringify({code:e.code??'ERROR',message:e.message.replace(/postgres(?:ql)?:\/\/\S+/gi,'[database-url]')}));
 process.exitCode=1;
} finally {await db.end({timeout:5});}
