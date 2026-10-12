// node --env-file=.env.local scripts/video-homework-outcomes-db.mjs --test | --apply
// Tests install the migration and synthetic fixtures in one transaction, then roll everything back.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import postgres from 'postgres';

const mode = process.argv[2] ?? '--test';
if (!['--test', '--apply'].includes(mode)) throw new Error('Use --test or --apply.');
const connection = new URL(process.env.DATABASE_URL ?? 'missing:');
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'missing:').hostname.split('.')[0];
if (!ref || !(connection.hostname === `db.${ref}.supabase.co` || decodeURIComponent(connection.username).endsWith(`.${ref}`)))
  throw new Error('Database and app project do not match.');
const sql = postgres(connection.toString(), { ssl: 'require', prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
const migration = readFileSync('supabase/migrations/20261012090000_video_homework_outcomes.sql', 'utf8');
const rollback = new Error('ROLLBACK_FIXTURES');
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
try {
  const [state] = await sql`select to_regclass('public.video_homework_auto_outcomes')::text as outcomes`;
  if (mode === '--apply') {
    if (state.outcomes) throw new Error('Migration already exists; inspect instead of replaying.');
    await sql.unsafe(migration);
    console.log('Applied video homework outcome migration.');
  } else {
    const tenant = randomUUID(), other = randomUUID(), teacher = randomUUID(), student = randomUUID(), cls = randomUUID();
    try {
      await sql.begin(async tx => {
        if (!state.outcomes) await tx.unsafe(migration.replace(/^begin;\s*$/gm, '').replace(/^commit;\s*$/gm, '').replace(/^notify pgrst,.*$/gm, ''));
        await tx`select set_config('request.jwt.claims','{}',true)`;
        await tx`insert into public.tenants(id,slug,name) values(${tenant},${'video-test-'+tenant},'Synthetic video test'),(${other},${'video-test-'+other},'Other test')`;
        await tx`insert into public.users(id,tenant_id,email,display_name,system_role,status) values(${teacher},${tenant},${teacher+'@fixture.invalid'},'Synthetic teacher','teacher','active')`;
        await tx`insert into public.classes(id,tenant_id,class_name,subject,teacher_id) values(${cls},${tenant},'Synthetic class','math',${teacher})`;
        await tx`insert into public.students(id,tenant_id,name,status,is_test) values(${student},${tenant},'Synthetic student','enrolled',false)`;
        const [{ old, recent, yesterday, tomorrow }] = await tx`select ((now() at time zone 'Asia/Seoul')::date-10)::text as old,
          ((now() at time zone 'Asia/Seoul')::date-3)::text as recent,((now() at time zone 'Asia/Seoul')::date-1)::text as yesterday,
          ((now() at time zone 'Asia/Seoul')::date+1)::text as tomorrow`;
        for (const date of [old, recent]) {
          await tx`insert into public.lesson_reports(tenant_id,student_id,class_id,subject,report_date,progress,video_homework,created_by)
            values(${tenant},${student},${cls},'math',${date},'Synthetic',true,${teacher})`;
          await tx`insert into public.video_homework_marks(tenant_id,class_id,student_id,check_date,homework_date,status,updated_by)
            values(${tenant},${cls},${student},${date}::date+1,${date},'submitted',${teacher})`;
        }
        await tx`set local role service_role`;
        const outcome = (date, status, videoId=null) => ({classId:cls,studentId:student,homeworkDate:date,status,videoId});
        const run = async (items, target=tenant, observed=null) => {
          const [r] = await tx`select public.reconcile_video_homework_outcomes(${target},${tx.json(items)},coalesce(${observed}::timestamptz,clock_timestamp())) as result`;
          return r.result;
        };
        equal((await run([outcome(old,'missing')])).notifications,1);
        equal((await run([outcome(old,'missing')])).notifications,0);
        equal((await run([outcome(recent,'unchecked')])).updated,0);
        const [mark] = await tx`select status,updated_by from public.video_homework_marks where tenant_id=${tenant} and homework_date=${recent}`;
        equal(mark,{status:'submitted',updated_by:teacher});
        const videoId = randomUUID();
        await tx`insert into public.student_homework_videos(id,tenant_id,student_id,subject,teacher_id,center_id,video_id,post_id,posted_at,
          status,drive_file_id,route,uploaded_at,created_at,updated_at) values(${videoId},${tenant},${student},'math',${teacher},-1,-1,-1,
          ${yesterday}::date+interval '12 hours','uploaded','syntheticDriveFile123',${tx.json({classId:cls,homeworkDate:old})},now(),now(),now())`;
        equal((await run([outcome(old,'submitted',videoId)])).notifications,1);
        equal((await run([outcome(old,'submitted',videoId)])).notifications,0);
        equal((await run([outcome(recent,'submitted',videoId)])).updated,0); // explicit date cannot change
        equal((await run([outcome(old,'missing')],other)).updated,0);
        equal((await run([outcome(tomorrow,'missing')])).updated,0);
        equal((await run([outcome(old,'missing')],tenant,new Date(Date.now()-60_000).toISOString())).updated,0);
        const [{ count }] = await tx`select count(*)::int from public.notifications where tenant_id=${tenant} and recipient_id=${teacher}`;
        equal(count,2);
        const [permissions] = await tx`select has_function_privilege('anon','public.reconcile_video_homework_outcomes(uuid,jsonb,timestamptz)','execute') as anonymous,
          has_function_privilege('authenticated','public.notify_unassigned_homework_videos(uuid,uuid[],timestamptz)','execute') as authenticated`;
        equal(permissions,{anonymous:false,authenticated:false});
        const pendingId=randomUUID();
        await tx`insert into public.student_homework_videos(id,tenant_id,student_id,subject,teacher_id,center_id,video_id,post_id,posted_at,
          status,drive_file_id,route,uploaded_at,created_at,updated_at) values(${pendingId},${tenant},${student},'math',${teacher},-1,-2,-2,
          ${yesterday}::date+interval '12 hours','uploaded','syntheticDriveFile456',${tx.json({classId:cls})},now(),now(),now())`;
        const alert = async (ids, target=tenant) => (await tx`select public.notify_unassigned_homework_videos(${target},${ids}::uuid[],clock_timestamp()) as count`)[0].count;
        equal(await alert([videoId]),0);
        equal(await alert([pendingId],other),0);
        equal(await alert([pendingId]),1);
        equal(await alert([pendingId]),0);
        await tx`update public.video_homework_marks set status='missing' where tenant_id=${tenant} and homework_date=${recent}`;
        const [mapped]=await tx`select public.set_homework_video_assignment(${tenant},${teacher},false,${student},${cls},${pendingId},${recent},false,0,'Synthetic remapping') as result`;
        equal(mapped.result,'saved');
        equal(await alert([pendingId]),0);
        equal((await run([outcome(recent,'submitted',pendingId)])).notifications,1);
        const [removed]=await tx`select public.set_homework_video_assignment(${tenant},${teacher},false,${student},${cls},${pendingId},null,true,1,'Synthetic exclusion') as result`;
        equal(removed.result,'saved');
        await run([outcome(recent,'unchecked')]);
        equal((await tx`select count(*)::int as count from public.video_homework_marks where tenant_id=${tenant} and homework_date=${recent}`)[0].count,0);
        throw rollback;
      });
    } catch (e) { if (e !== rollback) throw e; }
    equal((await sql`select count(*)::int as count from public.tenants where id in (${tenant},${other})`)[0].count,0);
    console.log(`PASS ${assertions} database assertions; all fixtures and test migration rolled back.`);
  }
} catch (e) {
  console.error(JSON.stringify({code:e.code ?? 'ERROR',message:String(e.message).replace(/postgres(?:ql)?:\/\/\S+/gi,'[database-url]')}));
  process.exitCode=1;
} finally { await sql.end({timeout:5}); }
