/** Read-only six-month data/integrity audit for the demo tenant. */
import postgres from 'postgres';
const sql=postgres(process.env.DATABASE_URL,{prepare:false,max:1,connect_timeout:10});
const fail=(name,value)=>{if(value!==0)throw Error(`${name}: ${value}`)};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const [year,month,day]=today.split('-').map(Number);
const windowStart=new Date(Date.UTC(year,month-6,1)).toISOString().slice(0,10);
const yesterday=new Date(Date.UTC(year,month-1,day-1)).toISOString().slice(0,10);
try {
 const [tenant]=await sql`select id from tenants where slug='demo'`;
 const id=tenant.id;
 const monthly=await sql`
   select to_char(d.day,'YYYY-MM') month_key,
    (select count(*)::int from attendance_records a where a.tenant_id=${id}
      and date_trunc('month',a.session_date)=d.day) attendance,
    (select count(*)::int from lesson_reports r where r.tenant_id=${id}
      and date_trunc('month',r.report_date)=d.day) reports,
    (select count(*)::int from student_grades g where g.tenant_id=${id}
      and date_trunc('month',g.taken_on)=d.day) grades
   from generate_series(${windowStart}::date,date_trunc('month',${today}::date)::date,interval '1 month') d(day)
 `;
 const [issues]=await sql`
   select
     (select count(*)::int from lesson_reports r
       where r.tenant_id=${id} and r.source='demo_history' and not exists (
         select 1 from attendance_records a where a.tenant_id=${id}
           and a.student_id=r.student_id and a.class_id=r.class_id
           and a.session_date=r.report_date and a.status::text in ('present','late','early_leave','makeup')
       )) unlinked_reports,
     (select count(*)::int from lesson_reports r where r.tenant_id=${id}
       and r.source='demo_history'
       and (r.classnote_status is not null or r.classnote_sent_at is not null)) fake_deliveries,
     (select count(*)::int from attendance_records a
       where a.tenant_id=${id} and a.note='demo-history:v1'
         and not exists (
           select 1 from enrollments e where e.tenant_id=${id}
             and e.student_id=a.student_id and e.class_id=a.class_id
             and a.session_date between e.start_date and coalesce(e.end_date,a.session_date)
         )) outside_enrollment,
     (select count(*)::int from (
       select student_id,class_id,session_date,slot_start from attendance_records
       where tenant_id=${id} and note='demo-history:v1'
       group by 1,2,3,4 having count(*)>1
     ) duplicate) duplicate_attendance,
     (select count(*)::int from student_grades g where g.tenant_id=${id}
       and g.notes='demo-history:v1' and g.exam_id is null) grades_without_exam,
     (select count(*)::int from class_sheet_student_marks m where m.tenant_id=${id}
       and m.status in ('done','absent')
       and m.progress_note in ('결석 · 다음 수업에 보충','본문과 어휘 학습 완료')) invalid_demo_attitudes,
     (select count(*)::int from onescreen_daily_sessions s where s.tenant_id=${id}
       and not exists (
         select 1 from lesson_reports r where r.tenant_id=${id}
           and r.student_id=s.student_id and r.class_id=s.class_id
           and r.report_date=s.session_date
       )) lesson_sessions_without_report,
     (select count(*)::int from students s where s.tenant_id=${id}
       and s.enrolled_at<=${yesterday}::date and not exists (
         select 1 from attendance_records a where a.tenant_id=${id} and a.student_id=s.id
       )) historical_students_without_attendance
 `;
 for(const [name,value] of Object.entries(issues))fail(name,value);
 // Current month can be empty on the first morning before any scheduled class.
 if(monthly.length!==6||monthly.slice(0,-1).some(m=>m.attendance===0||m.reports===0||m.grades===0))throw Error('missing monthly coverage');
 const [settings]=await sql`select data->'modules'->'disabled' disabled from tenant_settings where tenant_id=${id}`;
 console.log(JSON.stringify({monthly,issues,disabledModules:settings.disabled},null,2));
}finally{await sql.end()}
