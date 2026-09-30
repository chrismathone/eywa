-- 0318a: 원생상담 ↔ 반 매핑 + 반 후보 조회 RPC + 상담 통계 RPC 두 개.
--
-- 원장 2026-09-30: *"상담을 2단으로 줄이고 '반 이름' 열 추가."* · *"상담자와 매핑되는 반으로 알아서 스마트하게. 없으면 미매핑.
-- 관리자도 미매핑."* · *"상담 추가 시에도 반 매핑 가능하게"* · *"우측에 상담 통계 고도화. 모든 것을 관리 통계 추이 가능하게."*
--
-- ① student_consultations.class_id    — 이 상담이 걸린 반(없으면 미매핑). 반이 지워지면 비운다(on delete set null).
--    student_consultations.class_source — 'auto'(판정) · 'manual'(사람이 고름, 반이 비어 있으면 '미매핑'을 고른 것) · null(아직 판정 안 함).
--    🔑 출처를 따로 두는 이유: 사람이 '미매핑'을 고른 행과 아직 판정 안 한 옛 행이 둘 다 class_id null이라 구분이 안 된다 —
--       구분이 없으면 목록의 자동 판정이 사람이 고른 '미매핑'을 덮는다(원장 *"관리자 상담 등록 시에 미매핑할 수도 있게"*).
-- ② consultation_class_candidates(학생[], 날짜[]) — 그날 그 학생이 수강 중인 반 + 그 반을 가르치는 사람(담임 ∪ 그날 교시 담당).
--    판정 규칙은 scripts/_makeedu/consultation-class.cjs 한 벌(앱·워커·백필 공용). 워커·백필은 같은 조건의 SQL을 직접 돌린다 —
--    두 SQL의 조건은 가드 테스트(consultation-class.test.ts)가 대조한다. 한쪽을 고치면 다른 쪽도.
-- ③ consultation_stats(...) — 상담 목록 오른쪽 통계 패널의 집계를 한 번에(jsonb). 목록 필터(기간·카테고리·후속·상담사·과목)를 그대로 받는다.
-- ④ consultation_gap_students(...) — 상담 공백 재원생(30·60·90일+ · 이력 없음) 수와 상위 명단.
--
-- 전부 security invoker(호출자 RLS) + 명시적 auth_tenant_id() 필터 — 멀티테넌트 이중 격리(0039a·0040a 패턴).
-- 🔴 앱은 이 SQL이 없어도 돈다([[#95]]): 칸이 없으면 목록의 '반 이름' 열과 폼의 '반' 칸이 숨고, 통계 패널은 건수 카드만 보인다.
-- 되돌리기: 별도 요청(칸을 지우면 매핑이 사라진다).
-- 멱등: add column if not exists · 제약은 존재 확인 후 · create or replace function.

-- ① 칸 ------------------------------------------------------------------------
alter table public.student_consultations
  add column if not exists class_id uuid constraint student_consultations_class_id_fkey references public.classes(id) on delete set null;
alter table public.student_consultations
  add column if not exists class_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'student_consultations_class_source_check') then
    alter table public.student_consultations
      add constraint student_consultations_class_source_check check (class_source is null or class_source in ('auto', 'manual'));
  end if;
end $$;

create index if not exists sc_tenant_class_idx on public.student_consultations (tenant_id, class_id) where class_id is not null;

comment on column public.student_consultations.class_id is
  '이 상담이 걸린 반(없으면 미매핑). 판정 = 상담일에 학생이 수강 중인 반 중 상담사가 가르치는 반이 정확히 하나일 때(scripts/_makeedu/consultation-class.cjs).';
comment on column public.student_consultations.class_source is
  'auto = 자동 판정 · manual = 사람이 고름(반이 비었으면 미매핑을 고른 것) · null = 아직 판정 안 함. 자동 판정은 manual을 덮지 않는다.';

-- ② 반 후보 --------------------------------------------------------------------
-- 수강 창 = 시작 ≤ 그날 · 일반 종료는 그날 포함 · 반이동 종료는 반열림([[#125]]) · 종강(closed_at < 그날) 제외 · 폐지 반은 포함(그날의 사실).
-- 가르치는 사람 = 반 담임(현재 값) ∪ 그날 살아 있는 교시 담당(요일 무관). 자리(LAB·JJ) 교시는 teacher_id가 null이라 안 들어온다.
create or replace function public.consultation_class_candidates(p_student_ids uuid[], p_dates date[])
returns table (student_id uuid, on_date date, class_id uuid, class_name text, subject text, teacher_ids uuid[])
language sql
stable
security invoker
set search_path = public
as $fn$
  select x.sid, x.d, cl.id, cl.class_name, cl.subject,
    array_remove(array_cat(array[cl.teacher_id],
      coalesce((select array_agg(distinct cs.teacher_id) from class_schedules cs
        where cs.tenant_id = auth_tenant_id() and cs.class_id = cl.id and cs.teacher_id is not null
          and cs.valid_from <= x.d and (cs.valid_to is null or cs.valid_to >= x.d)), '{}')), null)
  from unnest(p_student_ids, p_dates) as x(sid, d)
  join enrollments e on e.tenant_id = auth_tenant_id() and e.student_id = x.sid
    and e.start_date <= x.d
    and (e.end_date is null or e.end_date > x.d or (e.end_date = x.d and not coalesce(e.is_transferred, false)))
  join classes cl on cl.id = e.class_id and cl.tenant_id = auth_tenant_id()
    and (cl.closed_at is null or cl.closed_at >= x.d);
$fn$;

-- ③ 상담 통계(패널) -------------------------------------------------------------
-- 필터 = 목록과 같은 뜻: 기간(p_since, null = 전체) · 카테고리 · 후속 긴급도(followUpUrgency와 같은 식) · 상담사 · 과목(저장값 후보 — 키·라벨).
-- 기간은 합계·분해에만 건다. 추이(최근 12개월 월별 · 최근 12주 주별)는 기간 밖까지 봐야 추이라 기간을 빼고 나머지 필터만 건다.
-- 후속 = 기한이 있거나 완료된 것(목록 '후속' 필터·위 '진행 중 후속' 카드와 같은 정의 — 기한 없는 미완료 메모는 세지 않는다).
create or replace function public.consultation_stats(
  p_since timestamptz,
  p_category text,
  p_urgency text,
  p_counselor uuid,
  p_subjects text[],
  p_today date,
  p_top int default 12
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $fn$
  with base as (
    select c.id, c.student_id, c.counselor_id, c.class_id, c.class_source, c.category, c.audience, c.makeedu_id,
      nullif(btrim(c.subject), '') as subject, c.consulted_at,
      (c.consulted_at at time zone 'Asia/Seoul')::date as d,
      c.follow_up_done as done,
      (not c.follow_up_done and c.follow_up_date is not null) as pending,
      (not c.follow_up_done and c.follow_up_date is not null and c.follow_up_date < p_today) as overdue,
      (c.audio_path is not null) as audio,
      (c.ai_summary is not null) as ai,
      (c.makeedu_id is not null) as synced
    from student_consultations c
    where c.tenant_id = auth_tenant_id()
      and (p_category is null or c.category = p_category)
      and (p_counselor is null or c.counselor_id = p_counselor)
      and (p_subjects is null or c.subject = any(p_subjects))
      and (p_urgency is null
        or (p_urgency = 'done' and c.follow_up_done)
        or (p_urgency = 'overdue' and not c.follow_up_done and c.follow_up_date is not null and c.follow_up_date < p_today)
        or (p_urgency = 'today' and not c.follow_up_done and c.follow_up_date = p_today)
        or (p_urgency = 'soon' and not c.follow_up_done and c.follow_up_date > p_today and c.follow_up_date <= p_today + 3)
        or (p_urgency = 'later' and not c.follow_up_done and c.follow_up_date > p_today + 3))
  ),
  scoped as (select * from base where p_since is null or consulted_at >= p_since),
  -- 버킷 축: 최근 12개월(이번 달 포함) · 최근 12주(이번 주 월요일 포함).
  axis as (
    select 'm'::text as u, i, (date_trunc('month', p_today::timestamp) - make_interval(months => 11 - i))::date as b
    from generate_series(0, 11) as i
    union all
    select 'w', i, (date_trunc('week', p_today::timestamp) - make_interval(days => (11 - i) * 7))::date
    from generate_series(0, 11) as i
  ),
  tagged as (
    select 'm'::text as u, date_trunc('month', d::timestamp)::date as b, base.* from base
    union all
    select 'w', date_trunc('week', d::timestamp)::date, base.* from base
  ),
  bucket_rows as (
    select a.u, a.i, a.b,
      count(t.id) as n,
      count(distinct t.student_id) as students,
      count(t.id) filter (where t.done) as done,
      count(t.id) filter (where t.pending) as pending,
      count(t.id) filter (where t.audio) as audio,
      count(t.id) filter (where t.ai) as ai,
      count(t.id) filter (where t.synced) as synced,
      count(t.id) filter (where t.class_id is not null) as mapped
    from axis a
    left join tagged t on t.u = a.u and t.b = a.b
    group by a.u, a.i, a.b
  ),
  -- 분해 축 여섯 — 키가 null이면 그 축의 '없음'(상담사 없음·미매핑 등). 이름은 여기서 붙인다(상담사·반).
  dim_rows as (
    select 'counselor'::text as dim, counselor_id::text as k, consulted_at, d from base
    union all select 'subject', subject, consulted_at, d from base
    union all select 'class', class_id::text, consulted_at, d from base
    union all select 'category', category, consulted_at, d from base
    union all select 'audience', audience, consulted_at, d from base
    union all select 'source', case when makeedu_id is not null then 'sync' else 'app' end, consulted_at, d from base
  ),
  dim_n as (
    select dim, k, count(*) as n
    from dim_rows
    where p_since is null or consulted_at >= p_since
    group by dim, k
  ),
  ranked as (
    select dim, k, n, row_number() over (partition by dim order by n desc, k nulls last) as rn,
      count(*) over (partition by dim) as distinct_n
    from dim_n
  ),
  top_items as (select * from ranked where rn <= greatest(p_top, 1)),
  dim_b as (
    select 'm'::text as u, dim, k, date_trunc('month', d::timestamp)::date as b, count(*) as c from dim_rows group by 1, 2, 3, 4
    union all
    select 'w', dim, k, date_trunc('week', d::timestamp)::date, count(*) from dim_rows group by 1, 2, 3, 4
  ),
  sparks as (
    select ti.dim, ti.k, a.u,
      array_agg(coalesce(db.c, 0) order by a.i) as series
    from top_items ti
    cross join axis a
    left join dim_b db on db.u = a.u and db.dim = ti.dim and db.k is not distinct from ti.k and db.b = a.b
    group by ti.dim, ti.k, a.u
  ),
  items as (
    select ti.dim, ti.rn, ti.distinct_n,
      jsonb_build_object(
        'k', ti.k,
        'n', ti.n,
        'label', case ti.dim
          when 'counselor' then (select u.display_name from users u where u.id::text = ti.k and u.tenant_id = auth_tenant_id())
          when 'class' then (select cl.class_name from classes cl where cl.id::text = ti.k and cl.tenant_id = auth_tenant_id())
          else null end,
        'm', (select s.series from sparks s where s.dim = ti.dim and s.k is not distinct from ti.k and s.u = 'm'),
        'w', (select s.series from sparks s where s.dim = ti.dim and s.k is not distinct from ti.k and s.u = 'w')
      ) as item
    from top_items ti
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'n', count(*),
        'students', count(distinct student_id),
        'done', count(*) filter (where done),
        'pending', count(*) filter (where pending),
        'overdue', count(*) filter (where overdue),
        'audio', count(*) filter (where audio),
        'ai', count(*) filter (where ai),
        'synced', count(*) filter (where synced),
        'mapped', count(*) filter (where class_id is not null),
        'judged', count(*) filter (where class_source is not null),
        'first', min(d),
        'last', max(d)
      )
      from scoped
    ),
    'buckets', (
      select jsonb_build_object(
        'month', coalesce((select jsonb_agg(jsonb_build_object('b', b, 'n', n, 'students', students, 'done', done, 'pending', pending,
          'audio', audio, 'ai', ai, 'synced', synced, 'mapped', mapped) order by i) from bucket_rows where u = 'm'), '[]'::jsonb),
        'week', coalesce((select jsonb_agg(jsonb_build_object('b', b, 'n', n, 'students', students, 'done', done, 'pending', pending,
          'audio', audio, 'ai', ai, 'synced', synced, 'mapped', mapped) order by i) from bucket_rows where u = 'w'), '[]'::jsonb)
      )
    ),
    'dims', coalesce((
      select jsonb_object_agg(dim, obj)
      from (
        select dim, jsonb_build_object('distinct', max(distinct_n), 'items', jsonb_agg(item order by rn)) as obj
        from items
        group by dim
      ) g
    ), '{}'::jsonb)
  );
$fn$;

-- ④ 상담 공백 재원생 ------------------------------------------------------------
-- 재원생(status='enrolled', 테스트 학생 제외) 중 마지막 원생상담이 N일 이상 지났거나 한 번도 없는 학생.
-- 🔑 재원생 = '실시간 재원생'(원장 2026-09-16) — 활성 수강(종료 안 됨 · 휴원 아님)이 있는데 **전부 미래 시작**인 학생은 아직 세지 않는다.
--    운영실·원생목록의 재원생 수와 같은 집합이어야 한다(src/features/students/enrolled-composition.ts notYetStartedStudentIds와 같은 식 —
--    수강이 아예 없는 재원생은 센다 · start_date를 모르면 시작한 것으로 본다). 한쪽을 고치면 다른 쪽도.
-- 🔑 '마지막 상담'은 작성자를 가리지 않는다(다른 상담사가 어제 상담한 학생을 재촉하면 거짓 할 일 — queries.ts 주석과 같은 결).
--    좁히는 건 학생 집합이다: p_student_ids(강사 = 담당 학생) · null = 학원 전체.
create or replace function public.consultation_gap_students(p_student_ids uuid[], p_today date, p_limit int default 10)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $fn$
  with enrolled as (
    select s.id, s.name, s.grade
    from students s
    where s.tenant_id = auth_tenant_id()
      and s.status = 'enrolled'
      and not coalesce(s.is_test, false)
      and (p_student_ids is null or s.id = any(p_student_ids))
      and not (
        exists (
          select 1 from enrollments e
          where e.tenant_id = auth_tenant_id() and e.student_id = s.id
            and e.end_date is null and not coalesce(e.on_hold, false))
        and not exists (
          select 1 from enrollments e
          where e.tenant_id = auth_tenant_id() and e.student_id = s.id
            and e.end_date is null and not coalesce(e.on_hold, false)
            and (e.start_date is null or e.start_date <= p_today))
      )
  ),
  last_seen as (
    select c.student_id, max((c.consulted_at at time zone 'Asia/Seoul')::date) as last_d
    from student_consultations c
    where c.tenant_id = auth_tenant_id()
      and c.student_id in (select id from enrolled)
    group by c.student_id
  ),
  joined as (
    select e.id, e.name, e.grade, l.last_d, case when l.last_d is null then null else p_today - l.last_d end as days
    from enrolled e left join last_seen l on l.student_id = e.id
  )
  select jsonb_build_object(
    'enrolled', (select count(*) from joined),
    'never', (select count(*) from joined where last_d is null),
    'd30', (select count(*) from joined where days >= 30),
    'd60', (select count(*) from joined where days >= 60),
    'd90', (select count(*) from joined where days >= 90),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grade', grade, 'last', last_d, 'days', days) order by (last_d is not null), days desc nulls first, name)
      from (
        select * from joined
        where last_d is null or days >= 30
        order by (last_d is not null), days desc nulls first, name
        limit greatest(p_limit, 0)
      ) t
    ), '[]'::jsonb)
  );
$fn$;

-- 실행 권한 — 로그인 사용자·서비스만(익명은 auth_tenant_id()가 비어 어차피 0행이지만 문을 닫아 둔다).
revoke all on function public.consultation_class_candidates(uuid[], date[]) from public, anon;
grant execute on function public.consultation_class_candidates(uuid[], date[]) to authenticated, service_role;
revoke all on function public.consultation_stats(timestamptz, text, text, uuid, text[], date, int) from public, anon;
grant execute on function public.consultation_stats(timestamptz, text, text, uuid, text[], date, int) to authenticated, service_role;
revoke all on function public.consultation_gap_students(uuid[], date, int) from public, anon;
grant execute on function public.consultation_gap_students(uuid[], date, int) to authenticated, service_role;

notify pgrst, 'reload schema';
