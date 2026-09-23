/**
 * Backfill the demo tenant's six-calendar-month operating history.
 *
 * Dry run: node --env-file=.env.local scripts/_oneoff/backfill-demo-history.mjs
 * Apply:   node --env-file=.env.local scripts/_oneoff/backfill-demo-history.mjs --apply
 * Rehearse a presentation date without writing:
 *          node --env-file=.env.local scripts/_oneoff/backfill-demo-history.mjs --apply --verify-rollback --as-of=2026-10-05
 *
 * Every write is scoped to the tenant whose slug is exactly "demo". Existing
 * attendance and reports are preserved. Re-running inserts only missing rows.
 * The current day's fictional classes are filled before the demo opens, so
 * today's math and English sheets are ready for a presentation.
 * Production cron /api/cron/demo-refresh invokes this same function at 06:05 KST.
 */
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const marker = "demo-history:v1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function counts(tx, tenantId) {
  const rows = await tx`
    select 'attendance' item, count(*)::int n from attendance_records where tenant_id=${tenantId}
    union all select 'reports', count(*)::int from lesson_reports where tenant_id=${tenantId}
    union all select 'grades', count(*)::int from student_grades where tenant_id=${tenantId}
    union all select 'goals', count(*)::int from grade_goals where tenant_id=${tenantId}
    union all select 'sheet_plans', count(*)::int from class_sheet_plan_lines where tenant_id=${tenantId}
    union all select 'sheet_marks', count(*)::int from class_sheet_student_marks where tenant_id=${tenantId}
    union all select 'consultations', count(*)::int from student_consultations where tenant_id=${tenantId}
    union all select 'intake', count(*)::int from enrollment_consultations where tenant_id=${tenantId}
    union all select 'expenses', count(*)::int from expenses where tenant_id=${tenantId}
    union all select 'calendar', count(*)::int from calendar_events where tenant_id=${tenantId}
    union all select 'meetings', count(*)::int from meeting_minutes where tenant_id=${tenantId}
    union all select 'announcements', count(*)::int from announcements where tenant_id=${tenantId}
    union all select 'exams', count(*)::int from exams where tenant_id=${tenantId}
    union all select 'ecs_goals', count(*)::int from class_sheet_goals where tenant_id=${tenantId}
    union all select 'mcs_goals', count(*)::int from math_month_goals where tenant_id=${tenantId}
    union all select 'textbook_catalog', count(*)::int from textbook_catalog where tenant_id=${tenantId}
    union all select 'textbook_orders', count(*)::int from textbook_orders where tenant_id=${tenantId}
    union all select 'tuition_quotes', count(*)::int from tuition_quotes where tenant_id=${tenantId}
    union all select 'payroll', count(*)::int from payroll_records where tenant_id=${tenantId}
    union all select 'staff_leaves', count(*)::int from staff_leaves where tenant_id=${tenantId}
    union all select 'inventory', count(*)::int from inventory_assets where tenant_id=${tenantId}
    union all select 'student_memos', count(*)::int from student_memos where tenant_id=${tenantId}
    union all select 'grade_comments', count(*)::int from grade_comments where tenant_id=${tenantId}
    union all select 'month_plan', count(*)::int from class_month_plan_cells where tenant_id=${tenantId}
    union all select 'tuition_catalog', count(*)::int from tuition_catalog where tenant_id=${tenantId}
    union all select 'lesson_sessions', count(*)::int from onescreen_daily_sessions where tenant_id=${tenantId}
  `;
  return Object.fromEntries(rows.map((r) => [r.item, r.n]));
}

/** Idempotent six-month demo refresh; cron and the local CLI share this transaction. */
export async function runDemoHistory({ apply = false, verifyRollback = false, asOf = new Date() } = {}) {
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(asOf);
const [year, month] = today.split("-").map(Number);
const windowStart = new Date(Date.UTC(year, month - 6, 1)).toISOString().slice(0, 10);
// Demo is a fictional live academy: fill today's class outcomes before the morning presentation.
const throughDate = today;
try {
  const summary = await sql.begin(async (tx) => {
    const tenants = await tx`select id,slug from tenants where slug='demo' for update`;
    assert(tenants.length === 1, "Expected exactly one demo tenant");
    const tenantId = tenants[0].id;
    const roster = await tx`
      select
        (select count(*)::int from students where tenant_id=${tenantId}) students,
        (select count(*)::int from students where tenant_id=${tenantId} and student_code like 'DMO-%' and notes like 'demo-roster:%') tagged_students,
        (select count(*)::int from classes where tenant_id=${tenantId}) classes,
        (select count(*)::int from classes where tenant_id=${tenantId} and notes like 'demo-roster:%') tagged_classes
    `;
    assert(roster[0].students === roster[0].tagged_students, "Demo tenant has non-demo students; refusing backfill");
    assert(roster[0].classes === roster[0].tagged_classes, "Demo tenant has non-demo classes; refusing backfill");
    const before = await counts(tx, tenantId);

    // The schedule's original valid_from is September. Earlier attendance
    // would be hidden in timetable-driven screens unless this is backdated.
    await tx`
      create temporary table dh_expected on commit drop as
      select distinct on (e.student_id,e.class_id,d.day)
        e.student_id,e.class_id,d.day::date as day,sc.start_time as slot_start,
        c.subject,c.class_name,st.student_code,
        get_byte(decode(md5(st.student_code || e.class_id::text || d.day::text),'hex'),0) as seed
      from enrollments e
      join students st on st.id=e.student_id and st.tenant_id=e.tenant_id
      join classes c on c.id=e.class_id and c.tenant_id=e.tenant_id
      join class_schedules sc on sc.class_id=c.id and sc.tenant_id=e.tenant_id
      join generate_series(${windowStart}::date,${throughDate}::date,interval '1 day') d(day)
        on sc.day_of_week::text =
           (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from d.day)::int + 1]
       and (sc.valid_to is null or sc.valid_to >= d.day)
      where e.tenant_id=${tenantId}
        and st.student_code like 'DMO-%' and st.notes like 'demo-roster:%'
        and c.notes like 'demo-roster:%'
        and e.start_date <= d.day and (e.end_date is null or e.end_date >= d.day)
      order by e.student_id,e.class_id,d.day,sc.start_time
    `;
    const [expected] = await tx`
      select count(*)::int n, count(distinct student_id)::int students,
             count(distinct date_trunc('month',day))::int months from dh_expected
    `;
    // On the first days of a new month, no scheduled class may have happened yet.
    // The window still spans six calendar months, but only five have class days.
    assert(expected.n > 1000 && expected.months >= 5 && expected.months <= 6,
      "Expected class days across the rolling six-month window");
    const [missing] = await tx`
      select count(*)::int n from dh_expected x
      where not exists (
        select 1 from attendance_records a where a.tenant_id=${tenantId}
          and a.student_id=x.student_id and a.class_id=x.class_id
          and a.session_date=x.day and a.slot_start=x.slot_start
      )
    `;
    if (!apply) return { mode: "dry-run", windowStart, throughDate, roster: roster[0], expected, missingAttendance: missing.n, before };

    await tx`
      update class_schedules s set valid_from=least(s.valid_from,${windowStart}::date)
      from classes c
      where s.tenant_id=${tenantId} and c.tenant_id=${tenantId}
        and s.class_id=c.id and c.notes like 'demo-roster:%'
        and s.valid_from>${windowStart}::date
    `;
    await tx`
      insert into attendance_records
        (tenant_id,class_id,student_id,session_date,slot_start,status,session_units,
         homework_required,homework_done,note,recorded_at)
      select ${tenantId},x.class_id,x.student_id,x.day,x.slot_start,
        (case when x.seed%100<78 then 'present'
              when x.seed%100<87 then 'absent'
              when x.seed%100<93 then 'late'
              when x.seed%100<97 then 'excused'
              else 'early_leave' end)::attendance_status,
        case when x.seed%100 between 78 and 86 or x.seed%100 between 93 and 96
             then null::numeric
             when x.subject='math' then 1::numeric
             else 2::numeric end,
        x.seed%4<>0,x.seed%7<>0,${marker},
        (x.day::timestamp + interval '11 hours') at time zone 'Asia/Seoul'
      from dh_expected x
      where not exists (
        select 1 from attendance_records a where a.tenant_id=${tenantId}
          and a.student_id=x.student_id and a.class_id=x.class_id
          and a.session_date=x.day and a.slot_start=x.slot_start
      )
    `;

    // The old demo reports predate class_id support. Resolve the unambiguous
    // class before inserting a same-day report, avoiding a duplicate in UI.
    await tx`
      update lesson_reports lr set class_id=e.class_id,source='demo_roster'
      from enrollments e join classes c on c.id=e.class_id
      where lr.tenant_id=${tenantId} and e.tenant_id=${tenantId}
        and lr.student_id=e.student_id and lr.class_id is null
        and lr.report_date between e.start_date and coalesce(e.end_date,lr.report_date)
        and c.tenant_id=${tenantId} and c.subject=lr.subject
        and c.notes like 'demo-roster:%'
        and not exists (
          select 1 from enrollments e2 join classes c2 on c2.id=e2.class_id
          where e2.tenant_id=${tenantId} and e2.student_id=lr.student_id
            and e2.class_id<>e.class_id and c2.subject=lr.subject
            and lr.report_date between e2.start_date and coalesce(e2.end_date,lr.report_date)
        )
    `;

    // A report is one per attended class-day, derived from the effective
    // attendance state rather than fabricated independently.
    await tx`
      create temporary table dh_attended on commit drop as
      select a.student_id,a.class_id,a.session_date as day,c.subject,c.class_name,
        min(a.slot_start) as slot_start,min(a.status::text) as status
      from (
        select distinct on (student_id,class_id,session_date,slot_start)
          student_id,class_id,session_date,slot_start,status
        from attendance_records where tenant_id=${tenantId}
          and session_date between ${windowStart}::date and ${throughDate}::date
        order by student_id,class_id,session_date,slot_start,recorded_at desc,id desc
      ) a join classes c on c.id=a.class_id and c.tenant_id=${tenantId}
      where c.notes like 'demo-roster:%' and a.status::text in ('present','late','early_leave','makeup')
      group by a.student_id,a.class_id,a.session_date,c.subject,c.class_name
    `;
    await tx`
      insert into lesson_reports
        (tenant_id,student_id,class_id,report_date,subject,teacher_name,progress,
         homework_score,homework_today,daily_test,check_test,attitude,notes,
         textbook,trend_note,source,created_at)
      select ${tenantId},a.student_id,a.class_id,a.day,a.subject,u.display_name,
        case when a.subject='math'
             then '개념 정리와 유형별 문제 풀이 · ' || to_char(a.day,'MM/DD')
             else 'Reading · Grammar · 어휘 복습 · ' || to_char(a.day,'MM/DD') end,
        case when get_byte(decode(md5(a.student_id::text || a.day::text),'hex'),0)%13=0
             then '미제출'
             else (65 + get_byte(decode(md5(a.class_id::text || a.day::text),'hex'),0)%36)::text || '%' end,
        case when a.subject='math' then '오늘 유형 오답 3문제 다시 풀기'
             else '본문 읽기와 단어 10개 암기' end,
        (60 + get_byte(decode(md5(a.student_id::text || a.class_id::text),'hex'),0)%41)::text || '점',
        case when a.subject='math' then '핵심 개념 확인' else '어휘 확인' end,
        case when a.status='late' then '지각했지만 수업에 참여함'
             when a.status='early_leave' then '조퇴 전까지 집중해서 참여함'
             else '적극적으로 참여함' end,
        '[데모] 실제 출결에 맞춰 생성한 가상 수업보고서',
        case when a.subject='math' then '개념원리' else 'Reading Explorer' end,
        '지난 수업과 비교해 풀이 과정을 점검했습니다.',
        'demo_history',
        (a.day::timestamp + interval '13 hours') at time zone 'Asia/Seoul'
      from dh_attended a
      left join classes c on c.id=a.class_id
      left join users u on u.id=c.teacher_id
      where not exists (
        select 1 from lesson_reports lr where lr.tenant_id=${tenantId}
          and lr.student_id=a.student_id and lr.report_date=a.day
          and (lr.class_id=a.class_id or (lr.class_id is null and lr.subject=a.subject))
      )
      on conflict (tenant_id,student_id,report_date,unit_key) do nothing
    `;
    await tx`
      insert into onescreen_daily_sessions
        (tenant_id,student_id,class_id,session_date,study_grade,subject_progress,
         daily_score,daily_max,check_score,check_max,attitude,homework,
         progress_confirmed,updated_by,created_at,updated_at)
      select ${tenantId},a.student_id,a.class_id,a.day,st.grade,
        jsonb_build_object(a.class_id::text,jsonb_build_object(
          'today',case when a.subject='math' then '개념 정리와 유형별 문제 풀이'
                       else 'Reading · Grammar · 어휘 복습' end,
          'textbook',case when a.subject='math' then '개념원리'
                          else 'Reading Explorer' end,
          'homeworkToday',case when a.subject='math' then '오답 3문제'
                               else '단어 10개 암기' end
        )),
        7+get_byte(decode(md5(a.student_id::text||a.day::text),'hex'),0)%4,10,
        6+get_byte(decode(md5(a.class_id::text||a.day::text),'hex'),0)%5,10,
        '좋음','80%',true,c.teacher_id,
        (a.day::timestamp+interval '12 hours') at time zone 'Asia/Seoul',
        (a.day::timestamp+interval '12 hours') at time zone 'Asia/Seoul'
      from dh_attended a
      join students st on st.id=a.student_id and st.tenant_id=${tenantId}
      join classes c on c.id=a.class_id and c.tenant_id=${tenantId}
      where not exists (
        select 1 from onescreen_daily_sessions s where s.tenant_id=${tenantId}
          and s.student_id=a.student_id and s.class_id=a.class_id
          and s.session_date=a.day
      )
      on conflict do nothing
    `;

    // Monthly grades and goals follow each student's actual enrolled subject.
    await tx`
      create temporary table dh_monthly on commit drop as
      select distinct on (student_id,class_id,date_trunc('month',day))
        student_id,class_id,subject,day,
        to_char(day,'YYYY-MM') as month_key,
        get_byte(decode(md5(student_id::text || class_id::text || to_char(day,'YYYY-MM')),'hex'),0) as seed
      from dh_attended
      order by student_id,class_id,date_trunc('month',day),day desc
    `;
    await tx`
      insert into student_grades
        (tenant_id,student_id,class_id,exam_name,subject,score,max_score,taken_on,notes,school_year,term,exam_slot,received_at)
      select ${tenantId},m.student_id,m.class_id,m.month_key || ' 월간 진단',m.subject,
        55+(m.seed%46),100,m.day,${marker},extract(year from m.day)::int,
        null::smallint,'monthly',
        (m.day::timestamp + interval '12 hours') at time zone 'Asia/Seoul'
      from dh_monthly m
      where not exists (
        select 1 from student_grades g where g.tenant_id=${tenantId}
          and g.student_id=m.student_id and g.class_id=m.class_id
          and g.exam_name=m.month_key || ' 월간 진단'
      )
    `;
    await tx`
      insert into grade_goals
        (tenant_id,student_id,exam_name,subject,target_score,max_score,reason,created_at)
      select ${tenantId},m.student_id,m.month_key || ' 월간 진단',m.subject,
        least(100,65+(m.seed%36)+5),100,${marker},
        (m.day::timestamp + interval '10 hours') at time zone 'Asia/Seoul'
      from dh_monthly m
      where not exists (
        select 1 from grade_goals g where g.tenant_id=${tenantId}
          and g.student_id=m.student_id and g.exam_name=m.month_key || ' 월간 진단'
          and g.subject=m.subject
      )
    `;

    // The English class sheet is a per-period editor. Seed plans for every
    // scheduled period and student marks for the period carrying attendance.
    await tx`
      insert into class_sheet_plan_lines
        (tenant_id,class_id,plan_date,slot_start,term_mode,skill_area,line_no,
         textbook,page_range,progress,homework)
      select ${tenantId},c.id,d.day,sc.start_time,'regular',
        case when extract(day from d.day)::int%2=0 then 'reading' else 'grammar' end,
        1,'Reading Explorer',
        ((extract(doy from d.day)::int%80)+1)::text || '-' || ((extract(doy from d.day)::int%80)+3)::text,
        '본문 이해 및 표현 연습','본문 복습 및 어휘 암기'
      from classes c
      join class_schedules sc on sc.class_id=c.id and sc.tenant_id=${tenantId}
      join generate_series(${windowStart}::date,${throughDate}::date,interval '1 day') d(day)
        on sc.day_of_week::text =
           (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from d.day)::int + 1]
      where c.tenant_id=${tenantId} and c.notes like 'demo-roster:%'
        and c.subject='english' and (sc.valid_to is null or sc.valid_to>=d.day)
        and exists (
          select 1 from enrollments e where e.class_id=c.id and e.tenant_id=${tenantId}
            and e.start_date<=d.day and (e.end_date is null or e.end_date>=d.day)
        )
        and not exists (
          select 1 from class_sheet_plan_lines p where p.tenant_id=${tenantId}
            and p.class_id=c.id and p.plan_date=d.day
            and p.slot_start=sc.start_time and p.term_mode='regular'
        )
    `;
    await tx`
      insert into class_sheet_student_marks
        (tenant_id,class_id,student_id,mark_date,slot_start,status,progress_note,score)
      select ${tenantId},x.class_id,x.student_id,x.day,sc.start_time,
        case when a.status::text in ('absent','excused') then null::text
             when a.status::text in ('late','early_leave') then '보통'
             else '좋음' end,
        case when a.status::text in ('absent','excused') then '결석 · 다음 수업에 보충'
             else '본문과 어휘 학습 완료' end,
        case when a.status::text in ('absent','excused') then null
             else (70+x.seed%31)::text end
      from dh_expected x
      join class_schedules sc on sc.tenant_id=${tenantId} and sc.class_id=x.class_id
        and sc.day_of_week::text =
          (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from x.day)::int + 1]
        and (sc.valid_to is null or sc.valid_to>=x.day)
      join lateral (
        select ar.status from attendance_records ar
        where ar.tenant_id=${tenantId} and ar.student_id=x.student_id
          and ar.class_id=x.class_id and ar.session_date=x.day
          and ar.slot_start=x.slot_start
        order by ar.recorded_at desc,ar.id desc limit 1
      ) a on true
      where x.subject='english'
        and not exists (
          select 1 from class_sheet_student_marks m where m.tenant_id=${tenantId}
            and m.student_id=x.student_id and m.class_id=x.class_id
            and m.mark_date=x.day and m.slot_start=sc.start_time
        )
    `;
    await tx`
      update class_sheet_student_marks m
      set status=case
        when m.status='absent' then null::text
        when exists (
          select 1 from attendance_records a where a.tenant_id=${tenantId}
            and a.class_id=m.class_id and a.student_id=m.student_id
            and a.session_date=m.mark_date
            and a.status::text in ('late','early_leave')
        ) then '보통'
        else '좋음' end
      where m.tenant_id=${tenantId} and m.status in ('absent','done')
        and m.progress_note in ('결석 · 다음 수업에 보충','본문과 어휘 학습 완료')
        and exists (
          select 1 from classes c where c.id=m.class_id and c.tenant_id=${tenantId}
            and c.notes like 'demo-roster:%'
        )
    `;

    // One student consultation per eligible month; keep recent hand-entered
    // follow-ups intact. The note points to the source attendance period.
    await tx`
      insert into student_consultations
        (tenant_id,student_id,consulted_at,subject,category,audience,summary,follow_up_done)
      select ${tenantId},m.student_id,
        (m.day::timestamp + interval '14 hours') at time zone 'Asia/Seoul',
        m.subject,'학습','학부모',
        '[데모] ' || m.month_key || ' 출결과 월간 진단을 확인하고 학습 계획을 안내했습니다. ' || ${marker},
        true
      from (
        select distinct on (student_id,month_key) student_id,day,month_key,subject
        from dh_monthly order by student_id,month_key,day desc
      ) m
      where not exists (
        select 1 from student_consultations s where s.tenant_id=${tenantId}
          and s.student_id=m.student_id
          and s.summary like '%' || ${marker}
          and to_char(s.consulted_at at time zone 'Asia/Seoul','YYYY-MM')=m.month_key
      )
    `;
    await tx`
      insert into student_memos (tenant_id,student_id,category,content,created_at)
      select ${tenantId},m.student_id,'general',
        '[데모] '||m.month_key||' 출결과 과제 수행을 확인했습니다. '||${marker},
        (m.day::timestamp + interval '15 hours') at time zone 'Asia/Seoul'
      from (
        select distinct on (student_id,month_key) student_id,day,month_key
        from dh_monthly order by student_id,month_key,day desc
      ) m
      where not exists (
        select 1 from student_memos s where s.tenant_id=${tenantId}
          and s.student_id=m.student_id and s.content like '%'||${marker}
          and to_char(s.created_at at time zone 'Asia/Seoul','YYYY-MM')=m.month_key
      )
    `;
    await tx`
      insert into grade_comments
        (tenant_id,student_id,category,subject,content,period,shared_with_parent,created_at)
      select ${tenantId},m.student_id,'학습',m.subject,
        '[데모] 월간 진단 결과를 바탕으로 다음 단원 목표를 정했습니다. '||${marker},
        m.month_key,false,
        (m.day::timestamp + interval '15 hours') at time zone 'Asia/Seoul'
      from dh_monthly m
      where not exists (
        select 1 from grade_comments g where g.tenant_id=${tenantId}
          and g.student_id=m.student_id and g.subject=m.subject
          and g.period=m.month_key and g.content like '%'||${marker}
      )
    `;

    // Non-student operational pages should also have a traceable entry in
    // each month. No payment, delivery, Google, or AI integration is faked.
    await tx`
      create temporary table dh_months on commit drop as
      select to_char(m.day,'YYYY-MM') month_key,m.day::date first_day
      from generate_series(${windowStart}::date,date_trunc('month',${today}::date)::date,interval '1 month') m(day)
    `;
    await tx`
      insert into exams (tenant_id,name,subject,exam_type,exam_date,max_score,notes,created_at)
      select ${tenantId},m.month_key||' 월간 진단',subjects.subject,'weekly',
        least((m.first_day+interval '20 days')::date,${throughDate}::date),100,${marker},
        (m.first_day::timestamp + interval '9 hours') at time zone 'Asia/Seoul'
      from dh_months m cross join (values ('math'),('english')) subjects(subject)
      where not exists (
        select 1 from exams e where e.tenant_id=${tenantId}
          and e.name=m.month_key||' 월간 진단' and e.subject=subjects.subject
      )
    `;
    await tx`
      update student_grades g set exam_id=e.id
      from exams e
      where g.tenant_id=${tenantId} and e.tenant_id=${tenantId}
        and g.notes=${marker} and g.exam_id is null
        and g.exam_name=e.name and g.subject=e.subject
        and not exists (
          select 1 from student_grades other
          where other.tenant_id=${tenantId} and other.student_id=g.student_id
            and other.id<>g.id and other.exam_name=e.name and other.subject=e.subject
        )
    `;
    await tx`
      insert into class_sheet_goals
        (tenant_id,class_id,scope,period_start,role,skill_area,textbook,target_progress)
      select ${tenantId},c.id,'month',m.first_day,'homeroom','reading',
        'Reading Explorer','본문 4개 단원 학습 및 문장 표현 점검'
      from dh_months m cross join classes c
      where c.tenant_id=${tenantId} and c.notes like 'demo-roster:%'
        and c.subject='english'
        and exists (
          select 1 from enrollments e where e.tenant_id=${tenantId}
            and e.class_id=c.id and e.start_date<=(m.first_day+interval '1 month - 1 day')::date
            and (e.end_date is null or e.end_date>=m.first_day)
        )
        and not exists (
          select 1 from class_sheet_goals g where g.tenant_id=${tenantId}
            and g.class_id=c.id and g.scope='month' and g.period_start=m.first_day
            and g.role='homeroom' and g.skill_area='reading'
        )
    `;
    await tx`
      insert into class_sheet_month_memos (tenant_id,class_id,month,body)
      select ${tenantId},c.id,m.first_day,
        '[데모] '||m.month_key||' 출결 및 Reading 학습 목표를 확인합니다.'
      from dh_months m cross join classes c
      where c.tenant_id=${tenantId} and c.notes like 'demo-roster:%'
        and c.subject='english'
        and exists (
          select 1 from enrollments e where e.tenant_id=${tenantId}
            and e.class_id=c.id and e.start_date<=(m.first_day+interval '1 month - 1 day')::date
            and (e.end_date is null or e.end_date>=m.first_day)
        )
        and not exists (
          select 1 from class_sheet_month_memos x where x.tenant_id=${tenantId}
            and x.class_id=c.id and x.month=m.first_day
        )
    `;
    await tx`
      insert into math_month_goals
        (tenant_id,class_id,student_id,period_start,textbook,target_progress)
      select ${tenantId},m.class_id,m.student_id,date_trunc('month',m.day)::date,
        '개념원리','월간 단원 복습 및 유형별 문제 80% 이상 정답'
      from dh_monthly m where m.subject='math'
        and not exists (
          select 1 from math_month_goals g where g.tenant_id=${tenantId}
            and g.class_id=m.class_id and g.student_id=m.student_id
            and g.period_start=date_trunc('month',m.day)::date
        )
    `;
    await tx`
      insert into textbook_catalog
        (tenant_id,title,book_detail,grade_level,subject,publisher,price,created_at)
      select ${tenantId},v.title,v.detail,v.grade,v.subject,'데모 교재',v.price,
        (${windowStart}::date::timestamp + interval '9 hours') at time zone 'Asia/Seoul'
      from (values
        ('[데모] 개념원리 수학','월간 진도용','초·중','math',18000),
        ('[데모] Reading Explorer','본문·어휘 학습용','초·중','english',22000)
      ) v(title,detail,grade,subject,price)
      where not exists (
        select 1 from textbook_catalog c where c.tenant_id=${tenantId} and c.title=v.title
      )
    `;
    await tx`
      insert into class_month_plan_cells (tenant_id,class_id,plan_date,col_kind,body)
      select ${tenantId},c.id,m.first_day,'in_class',
        '[데모] '||m.month_key||' 핵심 개념과 단원별 복습'
      from dh_months m cross join classes c
      where c.tenant_id=${tenantId} and c.notes like 'demo-roster:%'
        and exists (
          select 1 from enrollments e where e.tenant_id=${tenantId}
            and e.class_id=c.id and e.start_date<=(m.first_day+interval '1 month - 1 day')::date
            and (e.end_date is null or e.end_date>=m.first_day)
        )
        and not exists (
          select 1 from class_month_plan_cells x where x.tenant_id=${tenantId}
            and x.class_id=c.id and x.plan_date=m.first_day and x.col_kind='in_class'
        )
    `;
    await tx`
      insert into textbooks (tenant_id,subject,skill_area,title,page_time,session_count,created_at)
      select ${tenantId},'english',v.area,v.title,'60분',12,
        (${windowStart}::date::timestamp + interval '9 hours') at time zone 'Asia/Seoul'
      from (values
        ('reading','[데모] Reading Explorer'),
        ('grammar','[데모] Grammar Basic')
      ) v(area,title)
      where not exists (
        select 1 from textbooks t where t.tenant_id=${tenantId}
          and t.title=v.title and t.skill_area=v.area
      )
    `;
    await tx`
      insert into textbook_lessons (tenant_id,textbook_id,lesson_no,progress,homework)
      select ${tenantId},t.id,n.n,'Unit '||n.n||' 본문·표현 학습','Unit '||n.n||' 복습'
      from textbooks t cross join generate_series(1,12) n(n)
      where t.tenant_id=${tenantId} and t.title like '[데모] %'
        and not exists (
          select 1 from textbook_lessons l where l.tenant_id=${tenantId}
            and l.textbook_id=t.id and l.lesson_no=n.n
        )
    `;
    await tx`
      insert into textbook_orders
        (tenant_id,student_id,student_name,book_name,book_detail,price,status,
         request_date,notes,created_at)
      select ${tenantId},p.student_id,st.name,
        case when p.subject='math' then '[데모] 개념원리 수학'
             else '[데모] Reading Explorer' end,
        '월간 수업 교재',case when p.subject='math' then 18000 else 22000 end,
        'requested',p.day,${marker},
        (p.day::timestamp + interval '9 hours') at time zone 'Asia/Seoul'
      from (
        select distinct on (month_key) student_id,subject,day,month_key
        from dh_monthly order by month_key,student_id
      ) p join students st on st.id=p.student_id
      where not exists (
        select 1 from textbook_orders o where o.tenant_id=${tenantId}
          and o.student_id=p.student_id and o.request_date=p.day and o.notes=${marker}
      )
    `;
    await tx`
      insert into tuition_quotes
        (tenant_id,student_name,school,grade,start_date,end_date,courses,extras,
         discounts,total_amount,created_at)
      select ${tenantId},'데모 견적 '||m.month_key,'한빛중','중1',m.first_day,
        (m.first_day+interval '1 month - 1 day')::date,
        jsonb_build_array(jsonb_build_object(
          'uid',m.month_key||'-math','category','수학','name','[데모] 중등 수학',
          'days','월,수','perSession',0,'sessions',0,'price',280000,
          'note','월 정액','excludeHolidays',false,'fixedMonthly',true,
          'pricingMode','monthly'
        )),'[]'::jsonb,'[]'::jsonb,280000,
        (m.first_day::timestamp + interval '10 hours') at time zone 'Asia/Seoul'
      from dh_months m where not exists (
        select 1 from tuition_quotes q where q.tenant_id=${tenantId}
          and q.student_name='데모 견적 '||m.month_key
      )
    `;
    await tx`
      insert into tuition_catalog (tenant_id,category,name,price,note,pricing_mode)
      select ${tenantId},v.category,v.name,v.price,${marker},v.mode
      from (values
        ('수학','[데모] 중등 수학 월정액',280000,'monthly'),
        ('영어','[데모] 영어 월정액',250000,'monthly')
      ) v(category,name,price,mode)
      where not exists (
        select 1 from tuition_catalog t where t.tenant_id=${tenantId} and t.name=v.name
      )
    `;
    await tx`
      insert into payroll_records
        (tenant_id,user_id,period,base_amount,hours_worked,hourly_amount,
         bonus,deduction,total,notes)
      select ${tenantId},u.id,m.month_key,1500000,60,20000,0,0,2700000,${marker}
      from dh_months m cross join users u
      where u.tenant_id=${tenantId}
        and not exists (
          select 1 from payroll_records p where p.tenant_id=${tenantId}
            and p.user_id=u.id and p.period=m.month_key
        )
    `;
    await tx`
      insert into staff_leaves
        (tenant_id,user_id,leave_type,starts_on,ends_on,reason)
      select ${tenantId},staff.id,'연차',
        least((m.first_day+interval '10 days')::date,${throughDate}::date),
        least((m.first_day+interval '10 days')::date,${throughDate}::date),
        ${marker}
      from dh_months m
      join lateral (
        select id from users where tenant_id=${tenantId} order by id limit 1
      ) staff on true
      where not exists (
        select 1 from staff_leaves l where l.tenant_id=${tenantId}
          and l.user_id=staff.id and l.reason=${marker}
          and date_trunc('month',l.starts_on)=m.first_day
      )
    `;
    await tx`
      insert into inventory_categories (tenant_id,key,label,code_prefix)
      select ${tenantId},'demo_equipment','데모 기자재','DMO'
      where not exists (
        select 1 from inventory_categories c where c.tenant_id=${tenantId}
          and c.key='demo_equipment'
      )
    `;
    await tx`
      insert into inventory_assets
        (tenant_id,asset_code,category,maker,model,acquired_on,status,location,note)
      select ${tenantId},'DMO-'||replace(m.month_key,'-',''),
        'demo_equipment','데모','태블릿',m.first_day,'in_use','교무실',${marker}
      from dh_months m where not exists (
        select 1 from inventory_assets a where a.tenant_id=${tenantId}
          and a.asset_code='DMO-'||replace(m.month_key,'-','')
      )
    `;
    await tx`
      insert into inventory_supplies
        (tenant_id,item_code,name,qty,location,checked_on,note)
      select ${tenantId},'DMO-PAPER','복사용지',30,'교무실',${throughDate}::date,${marker}
      where not exists (
        select 1 from inventory_supplies s where s.tenant_id=${tenantId}
          and s.item_code='DMO-PAPER'
      )
    `;
    await tx`
      insert into expenses (tenant_id,title,category,amount,expense_date,memo,approval_status)
      select ${tenantId},'교재·소모품 구입 ('||m.month_key||')','매입',
        90000+(extract(month from m.first_day)::int*7000),
        least((m.first_day+interval '12 days')::date,${throughDate}::date),${marker},'approved'
      from dh_months m where not exists (
        select 1 from expenses e where e.tenant_id=${tenantId}
          and e.memo=${marker} and e.title='교재·소모품 구입 ('||m.month_key||')'
      )
    `;
    await tx`
      insert into calendar_events (tenant_id,title,memo,start_date,end_date,color)
      select ${tenantId},'[데모] '||m.month_key||' 월간 학습 점검',${marker},
        least((m.first_day+interval '14 days')::date,${throughDate}::date),
        least((m.first_day+interval '14 days')::date,${throughDate}::date),'blue'
      from dh_months m where not exists (
        select 1 from calendar_events e where e.tenant_id=${tenantId}
          and e.memo=${marker} and e.title='[데모] '||m.month_key||' 월간 학습 점검'
      )
    `;
    await tx`
      insert into meeting_minutes (tenant_id,title,content,held_at)
      select ${tenantId},'[데모] '||m.month_key||' 운영 회의',
        '출결 추이, 수업보고서, 월간 진단 결과를 확인했습니다. '||${marker},
        (least((m.first_day+interval '19 days')::date,${throughDate}::date)::timestamp + interval '10 hours') at time zone 'Asia/Seoul'
      from dh_months m where not exists (
        select 1 from meeting_minutes x where x.tenant_id=${tenantId}
          and x.title='[데모] '||m.month_key||' 운영 회의'
      )
    `;
    await tx`
      insert into announcements (tenant_id,title,content,audience,created_at)
      select ${tenantId},'[데모] '||m.month_key||' 학습 안내',
        '이번 달 수업 일정과 과제를 확인해 주세요. '||${marker},
        'all'::announcement_audience,
        (m.first_day::timestamp + interval '9 hours') at time zone 'Asia/Seoul'
      from dh_months m where not exists (
        select 1 from announcements x where x.tenant_id=${tenantId}
          and x.title='[데모] '||m.month_key||' 학습 안내'
      )
    `;
    await tx`
      insert into enrollment_consultations
        (tenant_id,prospect_name,prospect_grade,prospect_school,parent_phone,
         parent_request,subject,consultation_path,outcome,consulted_at,created_at)
      select ${tenantId},'데모 상담 '||m.month_key,
        '중1','한빛중',null,${marker},'math','지인 소개',
        'consulted'::consultation_outcome,
        (least((m.first_day+interval '8 days')::date,${throughDate}::date)::timestamp + interval '13 hours') at time zone 'Asia/Seoul',
        (least((m.first_day+interval '8 days')::date,${throughDate}::date)::timestamp + interval '13 hours') at time zone 'Asia/Seoul'
      from dh_months m where not exists (
        select 1 from enrollment_consultations x where x.tenant_id=${tenantId}
          and x.parent_request=${marker} and x.prospect_name='데모 상담 '||m.month_key
      )
    `;
    // Make the locally populated demo modules browsable. Integration-backed
    // modules stay disabled because these rows have no real external service.
    await tx`
      update tenant_settings s set data=jsonb_set(
        s.data,'{modules,disabled}',
        (select coalesce(jsonb_agg(to_jsonb(x.value)),'[]'::jsonb)
           from jsonb_array_elements_text(coalesce(s.data->'modules'->'disabled','[]'::jsonb)) x(value)
          where x.value <> all(array[
            'ecs','mcs','textbooks','inventory','calendar','retention','session_billing','payroll','staff_leaves'
          ]::text[])),true)
      where s.tenant_id=${tenantId}
        and exists (
          select 1 from jsonb_array_elements_text(
            coalesce(s.data->'modules'->'disabled','[]'::jsonb)
          ) x(value)
          where x.value=any(array[
            'ecs','mcs','textbooks','inventory','calendar','retention','session_billing','payroll','staff_leaves'
          ]::text[])
        )
    `;
    const after = await counts(tx, tenantId);
    const result = { mode: "applied", windowStart, throughDate, roster: roster[0], expected, missingAttendance: missing.n, before, after };
    if (verifyRollback) throw Object.assign(new Error("VERIFIED_ROLLBACK"), { summary: result });
    return result;
  });
  return summary;
} catch (error) {
  if (error.message === "VERIFIED_ROLLBACK") {
    return { ...error.summary, mode: "verified-and-rolled-back" };
  } else {
    throw error;
  }
} finally {
  await sql.end();
}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const day = process.argv.find((arg) => arg.startsWith("--as-of="))?.slice(8);
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("--as-of requires YYYY-MM-DD");
  runDemoHistory({ apply: process.argv.includes("--apply"), verifyRollback: process.argv.includes("--verify-rollback"),
    asOf: day ? new Date(`${day}T12:00:00+09:00`) : new Date() })
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => { console.error("Demo history backfill failed:", error); process.exitCode = 1; });
}
