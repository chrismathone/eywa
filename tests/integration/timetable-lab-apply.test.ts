import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
const connection = process.env.TIMETABLE_LAB_TEST_DATABASE_URL;
const auth = vi.hoisted(() => ({ user: { id:'10000000-0000-4000-8000-000000000010',tenantId:'10000000-0000-4000-8000-000000000001',systemRole:'master' }, allowed:true }));
vi.mock('@/lib/auth/current-user',()=>({getCurrentUser:async()=>auth.user}));
vi.mock('@/lib/auth/perm-matrix',()=>({canManageTenant:async()=>auth.allowed}));
vi.mock('@/features/timetable-lab/server/access',()=>({canUseTimetableEditor:async()=>auth.allowed}));
vi.mock('@/features/timetable/server/master-sheet-store', () => ({ openMasterDb: () => postgres(connection!, { max: 1, onnotice: () => {}, connect_timeout: 5 }) }));
import { contextFingerprint, readApplyContext, fingerprint } from '@/features/timetable-lab/server/apply-context';
import { runApplyJob, policyHash } from '@/features/timetable-lab/server/apply-store';
import { importSource } from '@/features/timetable-lab/editor/import-source';
import { defaultAppearance } from '@/features/timetable-lab/editor/appearance';
import { moveClassStudent } from '@/features/timetable-lab/editor/class-commands';
import { shiftDays } from '@/features/timetable/lib/week';
import type { Draft } from '@/features/timetable-lab/editor/model';
import {previewTimetableLabApply,queueTimetableLabApply,listTimetableLabApplyJobs,cancelTimetableLabApplyJob,readTimetableLabApplyDraft} from '@/features/timetable-lab/server/apply-actions';
import {nextApplyHour} from '@/features/timetable-lab/apply-time';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
describe.skipIf(!connection)('시간표 연습본 예약: 실제 PostgreSQL 트랜잭션', () => {
  let db: postgres.Sql, today: string, draft: Draft;
  beforeAll(async () => {
    const url = new URL(connection!);
    if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname!=='/lab_apply_test_20261008') throw Error('Owned local test DB required');
    db=postgres(connection!,{max:1,onnotice:()=>{}});
    expect((await db`select current_database() as n`)[0].n).toBe('lab_apply_test_20261008');
  });
  afterAll(async()=>{await db?.end({timeout:5});});
  beforeEach(async()=>{
    auth.allowed=true;auth.user.id=id(10);auth.user.tenantId=id(1);
    await db.begin(async tx => {
      // Cleanup only the exact owned fixture asserted above; restore all real constraints for the exercise.
      await tx`set local session_replication_role=replica`;
      await tx`truncate timetable_lab_apply_jobs,audit_logs,enrollments,class_schedules,teacher_schedule_blocks,students,classes,classrooms,tenant_settings,users,tenants cascade`;
    });
    today=(await db`select (now() at time zone 'Asia/Seoul')::date::text as d`)[0].d;
    await db`insert into tenants(id,slug,name) values(${id(1)},'lab-a','가상 지점'),(${id(2)},'lab-b','가상 지점 B')`;
    await db`insert into users(id,tenant_id,email,display_name,system_role,status,ui_prefs) values(${id(10)},${id(1)},'lab@test.invalid','강사','master','active','{"unrelated":{"keep":true},"timetable":{"teacherOrder":{"math":{"teacherview":["수학 강사"]}}}}'::jsonb)`;
    await db`insert into tenant_settings(tenant_id,data) values(${id(1)},'{}'::jsonb),(${id(2)},'{}'::jsonb)`;
    await db`insert into classrooms(id,tenant_id,name,capacity) values(${id(20)},${id(1)},'301',20)`;
    await db`insert into classes(id,tenant_id,class_name,subject,teacher_id,classroom_id,bg_color,text_color) values(${id(30)},${id(1)},'반 A','english',${id(10)},${id(20)},'#abcdef','#121212'),(${id(31)},${id(1)},'반 B','english',${id(10)},${id(20)},'#abcdef','#121212')`;
    await db`insert into class_schedules(id,tenant_id,class_id,day_of_week,start_time,end_time,valid_from) values(${id(40)},${id(1)},${id(30)},'mon','14:20','15:00','2020-01-01'),(${id(41)},${id(1)},${id(31)},'mon','15:00','15:40','2020-01-01')`;
    await db`insert into students(id,tenant_id,name,school,grade,status) values(${id(50)},${id(1)},'가상 학생','가상 중학교','중1','enrolled')`;
    await db`insert into enrollments(id,tenant_id,class_id,student_id,start_date,salary_tier) values(${id(60)},${id(1)},${id(30)},${id(50)},'2020-01-01','A')`;
    const context=await readApplyContext(db,id(1));
    draft=importSource({version:1,tenantId:id(1),referenceDate:today,fetchedAt:new Date().toISOString(),subject:'english',academy:'가상 지점',stepMinutes:10,teacherOrder:['강사'],notices:[],outside:[],appearance:structuredClone(defaultAppearance),baselineHash:contextFingerprint(context),slots:context.schedules.map(s=>({id:s.id,classId:s.classId,name:s.classId===id(30)?'반 A':'반 B',subject:'english',day:s.day,start:s.start,end:s.end,teacher:'강사',teacherId:id(10),room:'301',roomId:id(20),kind:'lesson',classColor:{bg:'#abcdef',text:'#121212'},homeroomTeacher:'강사',students:s.classId===id(30)?[{id:id(50),name:'가상 학생',attendanceDays:['mon']}]:[]}))});
  });
  async function queue(snapshot=draft,future=false) {
    const context=await readApplyContext(db,id(1)), job=randomUUID();
    const [clock]=await db`select date_trunc('hour',now()) ${db.unsafe(future ? "+interval '1 hour'" : '')} as at`;
    const date=future ? (await db`select (${clock.at}::timestamptz at time zone 'Asia/Seoul')::date::text as d`)[0].d : today;
    await db`insert into timetable_lab_apply_jobs(id,tenant_id,actor_id,actor_role,policy_hash,request_hash,baseline_hash,apply_at,effective_date,payload,summary) values(${job},${id(1)},${id(10)},'master',${policyHash(context.settings,'master')},${fingerprint(snapshot)},${snapshot.source!.baselineHash!},${clock.at},${date}::date,${db.json(snapshot as never)},'{}'::jsonb)`;
    return job;
  }
  it('정시 전에는 운영 자료를 바꾸지 않는다',async()=>{
    draft.cells[1][2].text='14:30';const job=await queue(draft,true);
    expect(await runApplyJob(job)).toBeNull();
    expect((await db`select start_time::text as start from class_schedules where id=${id(40)}`)[0].start).toBe('14:20:00');
    expect((await db`select status from timetable_lab_apply_jobs where id=${job}`)[0].status).toBe('pending');
  });
  it('시간·학생 이동·개인 보기를 함께 적용하고 옛 이력과 다른 과목 보기를 남긴다',async()=>{
    draft=moveClassStudent(draft,id(50),id(30),id(31));draft.cells[1][2].text='14:30';draft.appearance!.hidePeriods=true;draft.appearance!.scale=.8;
    const job=await queue();expect(await runApplyJob(job)).toMatchObject({schedules:1,enrollments:2});
    expect((await db`select valid_to::text as until from class_schedules where id=${id(40)}`)[0].until).toBe(shiftDays(today,-1));
    expect((await db`select start_time::text as start from class_schedules where class_id=${id(30)} and valid_from=${today}::date`)[0].start).toBe('14:30:00');
    expect((await db`select end_date::text as until from enrollments where id=${id(60)}`)[0].until).toBe(today);
    expect((await db`select salary_tier,is_transferred_in from enrollments where class_id=${id(31)} and student_id=${id(50)}`)[0]).toMatchObject({salary_tier:'A',is_transferred_in:true});
    const prefs=(await db`select ui_prefs from users where id=${id(10)}`)[0].ui_prefs;
    expect(prefs.unrelated.keep).toBe(true);expect(prefs.timetable.teacherOrder.math.teacherview).toEqual(['수학 강사']);expect(prefs.timetable.editorView.english).toMatchObject({hidePeriods:true,scale:.8});
    expect(await runApplyJob(job)).toBeNull();expect((await db`select count(*)::int as n from audit_logs`)[0].n).toBe(1);
  });
  it('중간 SQL 실패는 수업·수강·개인 설정을 모두 되돌린다',async()=>{
    draft=moveClassStudent(draft,id(50),id(30),id(31));draft.cells[1][2].text='14:30';const job=await queue();
    await db.unsafe("create function public.lab_fault() returns trigger language plpgsql as $$begin raise exception 'Synthetic failure' using errcode='XX000';end;$$;create trigger lab_fault before insert on enrollments for each row execute function public.lab_fault();");
    try {
      await expect(runApplyJob(job)).rejects.toThrow();
      expect((await db`select valid_to from class_schedules where id=${id(40)}`)[0].valid_to).toBeNull();
      expect((await db`select end_date from enrollments where id=${id(60)}`)[0].end_date).toBeNull();
      expect((await db`select count(*)::int as n from audit_logs`)[0].n).toBe(0);
      expect((await db`select status from timetable_lab_apply_jobs where id=${job}`)[0].status).toBe('failed');
    } finally {await db.unsafe('drop trigger lab_fault on enrollments;drop function public.lab_fault();');}
  });
  it.each(['원본','계정','권한','지점'])('%s 변경 시 실행을 거절한다',async kind=>{
    const job=await queue();
    if(kind==='원본')await db`update class_schedules set start_time='14:30' where id=${id(40)}`;
    if(kind==='계정')await db`update users set status='inactive' where id=${id(10)}`;
    if(kind==='권한')await db`update tenant_settings set data='{"permissions":{"changed":true}}'::jsonb where tenant_id=${id(1)}`;
    if(kind==='지점')await db`update timetable_lab_apply_jobs set payload=jsonb_set(payload,'{source,tenantId}',${db.json(id(2))}) where id=${job}`;
    await expect(runApplyJob(job)).rejects.toThrow();expect((await db`select status from timetable_lab_apply_jobs where id=${job}`)[0].status).toBe('failed');
  });
  it('예약 취소 후에는 적용하지 않으며 같은 요청으로 재예약할 수 있다',async()=>{
    const job=await queue();await db`update timetable_lab_apply_jobs set status='cancelled' where id=${job}`;
    expect(await runApplyJob(job)).toBeNull();const again=await queue();expect(again).not.toBe(job);expect(await runApplyJob(again)).toBeTruthy();
  });
  it('동시 실행해도 한 번만 적용한다',async()=>{
    draft.cells[1][2].text='14:30';const job=await queue();
    const results=await Promise.allSettled([runApplyJob(job),runApplyJob(job)]);
    expect(results.filter(r=>r.status==='fulfilled'&&r.value)).toHaveLength(1);
    expect((await db`select count(*)::int as n from class_schedules where valid_from=${today}::date`)[0].n).toBe(1);
  });
  it.each(['출결','보강','교시 고정'])('%s 연결이 있으면 운영 배치를 덮어쓰지 않는다',async kind=>{
    draft.cells[1][2].text='14:30';const job=await queue();
    if(kind==='출결')await db`insert into attendance_records(tenant_id,student_id,class_id,session_date,status,recorded_by) values(${id(1)},${id(50)},${id(30)},${today}::date,'present',${id(10)})`;
    if(kind==='보강')await db.begin(async tx=>{await tx`select set_config('makeup.ctx',pg_current_xact_id()::text,true)`;await tx`insert into makeup_sessions(tenant_id,class_id,teacher_id,classroom_id,subject_key,session_date,start_time,end_time) values(${id(1)},${id(30)},${id(10)},${id(20)},'english',${today}::date,'14:20','15:00')`;});
    if(kind==='교시 고정')await db`insert into seat_period_pins(tenant_id,student_id,class_id,seat,day_of_week,slot_start,effective_from) values(${id(1)},${id(50)},${id(30)},'lab','mon','14:20',${today}::date)`;
    await expect(runApplyJob(job)).rejects.toThrow();expect((await db`select valid_to from class_schedules where id=${id(40)}`)[0].valid_to).toBeNull();
  });
  it('예약 표는 일반 로그인과 비로그인 역할에 쓰기 권한이 없다',async()=>{
    for(const role of ['anon','authenticated'])expect((await db`select has_table_privilege(${role},'timetable_lab_apply_jobs','INSERT,UPDATE,DELETE') as writable`)[0].writable).toBe(false);
  });
  it('검토 후 같은 요청 재전송은 예약 한 건을 반환하고 다른 계정은 조회·취소할 수 없다',async()=>{
    draft.appearance!.hidePeriods=true;
    const time=nextApplyHour(),input={draft,...time};
    const review=await previewTimetableLabApply(input);expect(review).toHaveProperty('review');if(!('review'in review))throw Error(review.error);
    const first=await queueTimetableLabApply({...input,expectedHash:review.review.hash,acknowledgeWarnings:true});expect(first).toHaveProperty('job');if(!('job'in first))throw Error(first.error);
    const again=await queueTimetableLabApply({...input,expectedHash:review.review.hash,acknowledgeWarnings:true});expect(again).toEqual(first);
    expect((await db`select count(*)::int as n from timetable_lab_apply_jobs`)[0].n).toBe(1);
    auth.user.id=id(11);expect(await listTimetableLabApplyJobs()).toEqual({jobs:[]});expect(await cancelTimetableLabApplyJob(first.job.id)).toHaveProperty('error');expect(await readTimetableLabApplyDraft(first.job.id)).toHaveProperty('error');
    auth.user.id=id(10);expect(await readTimetableLabApplyDraft(first.job.id)).toHaveProperty('draft');expect(await cancelTimetableLabApplyJob(first.job.id)).toEqual({ok:true});
  });
  it('변조된 검토 해시·다른 지점·권한 없는 요청은 예약을 만들지 않는다',async()=>{
    const time=nextApplyHour();
    expect(await queueTimetableLabApply({draft,...time,expectedHash:'잘못된 해시',acknowledgeWarnings:true})).toHaveProperty('error');
    auth.user.tenantId=id(2);expect(await previewTimetableLabApply({draft,...time})).toHaveProperty('error');
    auth.user.tenantId=id(1);auth.allowed=false;expect(await previewTimetableLabApply({draft,...time})).toHaveProperty('error');
    expect((await db`select count(*)::int as n from timetable_lab_apply_jobs`)[0].n).toBe(0);
  });
  it('일반 로그인 RLS도 같은 지점의 다른 직원에게 예약 원문을 공개하지 않는다',async()=>{
    await db`insert into users(id,tenant_id,email,display_name,system_role,status) values(${id(11)},${id(1)},'other@test.invalid','다른 직원','master','active')`;
    await queue(draft,true);
    const count=async(actor:string)=>db.begin(async tx=>{
      await tx`select set_config('request.jwt.claims',${JSON.stringify({sub:actor,role:'authenticated'})},true)`;
      await tx`set local role authenticated`;
      return (await tx`select count(*)::int as n from timetable_lab_apply_jobs`)[0].n;
    });
    expect(await count(id(10))).toBe(1);expect(await count(id(11))).toBe(0);
  });
});
