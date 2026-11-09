-- s2_0038_academy_assistant_analysis_views.sql — 학원 비서: 분석용 보기 5개 + 비서 의견 대상 고정·실행 지표·실행일 기준 재측정 · 2026-11-09
--
-- 원장 2026-11-09 *"학원 전체에서 학생이 점점 줄어드는 원인 찾아봐. 필요한 팩터가 더 있는지도"* 답을 Claude·Codex가 따로 검토(판정 '부분 적절')
-- → 개선안 2·3순위. 검토가 짚은 비서의 잘못 읽기를 DB가 미리 계산한 보기로 막는다:
--   · 담임 교체 비교에서 없는 키(oldTeacherId)를 읽어 81건이 모두 비었다 → onto_homeroom_history(앱 teacher-as-of.ts와 같은 규칙)
--   · 형제를 '수동 지정 표 0쌍'으로 읽었다(앱은 휴대폰·학부모 이름으로 자동 판정) → onto_siblings · onto_households(앱 siblings.ts와 같은 규칙)
--   · 총원(장부 정리 포함 427)과 학년별 합계(416)가 어긋났다 · 영어를 합쳐 인재원 영어 감소가 가려졌다 → onto_tuition_months(학생·청구 달)
--   · 지금 담임을 3월 학생에게 붙여 강사별 퇴원율을 지어냈다 → onto_teacher_churn(앱 강사평가가 계산·마감한 값 그대로)
--   · 종강 반 절반을 못 봤다 → onto_classes(상태 칸: 운영 중 · 종강 · 종강 예정 · 폐지 · 프로그램)
-- 비서 의견(s2_0036 표): 대상 명단 고정(target_kind · target_ids) · 실행 지표(exec_check — 결과 지표 check_*와 따로) · 실행일(acted_on — 원장이
-- 채택·완료로 처리한 날, 다시 잴 날의 기준) — 처음 저장한 대상·지표 원문은 바꿀 수 없다(트리거).
--
-- 🔴 보기 생성 함수(create_ontology_views)는 s2_0031 본문을 그대로 두고 뒤에 새 보기만 더한다(운영 본문 = s2_0031 파일과 같음을 2026-11-09 확인).
--    생성 규칙 판을 rules-v2로 올려 앱의 '바뀌었을 때만 다시 만들기'가 다음 질문에서 저절로 다시 만들게 하고, 여기서도 한 번 다시 만든다.
-- 🔴 새 보기는 assistant.* 보기(이미 지점으로 묶임)만 읽는다 — 지점 조건을 따로 두지 않는다. 새 함수 없음(비서 역할 실행권 변화 없음 · #155).
-- 순서 = 이 SQL → 앱 배포(앱이 새 칸에 쓴다 — 앱을 먼저 올리면 의견 저장이 실패해 처리 단추만 안 보인다(ask.ts) · 답은 산다).
-- 되돌리기 = scripts/_oneoff/revert-s2_0038-academy-assistant-analysis-views.sql(앱 먼저 되돌린 뒤).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ── §1 비서 의견: 대상 고정 · 실행 지표 · 실행일 ───────────────────────────────────────────────
alter table public.assistant_advice
  add column if not exists target_kind text,
  add column if not exists target_ids uuid[],
  add column if not exists exec_check jsonb,
  add column if not exists acted_on date;

alter table public.assistant_advice drop constraint if exists assistant_advice_target_kind_check;
alter table public.assistant_advice add constraint assistant_advice_target_kind_check
  check (target_kind is null or target_kind in ('student', 'class', 'teacher', 'consultation'));
alter table public.assistant_advice drop constraint if exists assistant_advice_target_pair;
alter table public.assistant_advice add constraint assistant_advice_target_pair
  check ((target_kind is null) = (target_ids is null) and (target_ids is null or cardinality(target_ids) between 1 and 500));
alter table public.assistant_advice drop constraint if exists assistant_advice_exec_check_shape;
alter table public.assistant_advice add constraint assistant_advice_exec_check_shape
  check (exec_check is null or (jsonb_typeof(exec_check) = 'object' and exec_check ? 'label' and exec_check ? 'sql' and octet_length(exec_check::text) <= 20000));

create or replace function assistant_private.advice_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.tenant_id, new.message_id, new.thread_id, new.item_no, new.asked_by)
       is distinct from (old.tenant_id, old.message_id, old.thread_id, old.item_no, old.asked_by) then
    raise exception '비서 의견의 지점·답·순번·묻는 사람은 바꿀 수 없습니다' using errcode = '42501';
  end if;
  -- s2_0038: 대상 명단·지표 원문은 처음 저장한 그대로(다시 잴 때 대상·조회문이 바뀌면 비교가 안 된다).
  if tg_op = 'UPDATE' and (new.target_kind, new.target_ids, new.check_sql, new.exec_check -> 'sql')
       is distinct from (old.target_kind, old.target_ids, old.check_sql, old.exec_check -> 'sql') then
    raise exception '비서 의견의 대상 명단·확인 지표 조회문은 바꿀 수 없습니다' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.assistant_messages m
                    where m.id = new.message_id and m.tenant_id = new.tenant_id and m.thread_id = new.thread_id and m.user_id = new.asked_by) then
      raise exception '비서 의견의 답·대화·지점·묻는 사람이 맞지 않습니다' using errcode = '42501';
    end if;
    if new.status <> 'open' then
      raise exception '새 비서 의견은 처리 전(open)으로만 만듭니다' using errcode = '42501';
    end if;
  end if;
  if new.status_by is not null and new.status_by is distinct from old.status_by
     and not exists (select 1 from public.users u where u.id = new.status_by and u.tenant_id = new.tenant_id) then
    raise exception '처리한 사람이 이 지점 직원이 아닙니다' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status_at is distinct from old.status_at then
    new.status_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function assistant_private.advice_guard() from public, anon, authenticated, service_role;

-- ── §2 생성 규칙 판 rules-v2(보기가 바뀌었다 — 앱의 '바뀌었을 때만 다시 만들기'가 알아보게) ─────────────
create or replace function assistant_private.schema_signature() returns text
language sql stable security definer set search_path = '' as $$
  select md5(
    coalesce((select string_agg(c.relname || '.' || a.attname || ':' || a.atttypid::text, ',' order by c.relname, a.attnum)
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                join pg_attribute a on a.attrelid = c.oid
               where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped), '')
    || '|' || coalesce((select string_agg(table_name, ',' order by table_name) from assistant_private.excluded_tables), '')
    || '|' || coalesce((select string_agg(table_name || '.' || column_name, ',' order by table_name, column_name) from assistant_private.hidden_columns), '')
    || '|' || coalesce((select string_agg(table_name || '.' || column_name || '=' || expr, ',' order by table_name, column_name) from assistant_private.masked_columns), '')
    || '|rules-v2'
  )
$$;

-- ── §3 온톨로지 보기 — s2_0031 넷 그대로 + 분석용 다섯(onto_classes · onto_homeroom_history · onto_siblings · onto_households ·
--     onto_tuition_months · onto_teacher_churn) ─────────────────────────────────────────────────────────
create or replace function assistant_private.create_ontology_views() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- 원생 한 사람 한 줄 + 세는 규칙(앱 판정과 같은 뜻 — src/features/assistant/catalog/ontology.ts).
  --  · 병합 = 메모 맨 앞 `중복 병합: <id>와 통합됨`(isMergedStudent) · 장부 정리 퇴원 = 끝난 수강 없음 + 정리 메모 + 사유 없음/기타(isBookkeepingOnlyExit)
  --  · 시스템 일괄 = 2026-07-10·07-03 + 끝난 수강 없음(isSystemBulkWithdrawal) · 퇴원 예정 = 퇴원일이 오늘(한국) 뒤
  if to_regclass('assistant.students') is not null and to_regclass('assistant.enrollments') is not null then
    execute $v$
      create view assistant.onto_students with (security_barrier = true) as
      with s as (
        select st.*,
               regexp_replace(coalesce(st.notes, ''), '^\s+', '') as notes_lead,
               exists (select 1 from assistant.enrollments e where e.student_id = st.id and e.end_date is not null) as has_ended_enrollment,
               nullif(st.withdrawal_metadata ->> 'reason', '') as w_reason,
               btrim(coalesce(st.withdrawal_metadata ->> 'memo', '')) as w_memo
          from assistant.students st
      ), k as (
        select s.*,
               s.notes_lead ~ '^중복 병합:\s*\S+와 통합됨' as merged,
               substring(s.notes_lead from '^중복 병합:\s*(\S+)와 통합됨') as merged_into_text,
               (s.w_reason is null or s.w_reason = 'other'
                  or s.w_reason not in ('dissatisfaction', 'grades', 'motivation', 'method', 'competitor', 'schedule', 'financial', 'career',
                                        'peers', 'illness', 'advised', 'relocation', 'graduated', 'other',
                                        'dissatisfied', 'unsatisfied', 'moved', 'graduate', 'cost', 'money'))
                 and (s.w_memo = '데이터 정리 일괄 퇴원' or s.w_memo like '수강 반 없음 일괄 퇴원 처리%') as cleanup_exit
          from s
      )
      select k.id,
             k.name,
             k.school,
             k.grade,
             k.gender,
             k.status::text as status,
             case k.status::text when 'prospect' then '예비' when 'consulted' then '상담완료' when 'enrolled' then '재원'
                                 when 'on_hold' then '휴원' when 'withdrawn' then '퇴원' else k.status::text end as status_label,
             k.enrolled_at,
             k.withdrawn_at as withdrawn_on,
             k.withdrawal_metadata ->> 'reason' as withdrawal_reason,
             coalesce(k.is_test, false) as is_test,
             k.merged as is_merged,
             case when k.merged_into_text ~ '^[0-9a-fA-F-]{36}$' then k.merged_into_text::uuid end as merged_into,
             k.has_ended_enrollment,
             case
               when k.withdrawn_at is null and k.status::text <> 'withdrawn' then null
               when not k.has_ended_enrollment and k.cleanup_exit then 'bookkeeping'
               when k.withdrawn_at > (now() at time zone 'Asia/Seoul')::date then 'scheduled'
               when not k.has_ended_enrollment and k.withdrawn_at in (date '2026-07-10', date '2026-07-03') then 'system_bulk'
               else 'real'
             end as exit_kind,
             (not coalesce(k.is_test, false) and not k.merged and not (not k.has_ended_enrollment and k.cleanup_exit)) as counted,
             k.created_at
        from k
    $v$;
  end if;

  -- 수강 + 반 과목 · 오늘(한국) 기준 진행 여부.
  if to_regclass('assistant.enrollments') is not null and to_regclass('assistant.classes') is not null then
    execute $v$
      create view assistant.onto_enrollments with (security_barrier = true) as
      select e.id,
             e.student_id,
             e.class_id,
             c.class_name,
             c.subject,
             c.teacher_id as homeroom_teacher_id,
             e.start_date,
             e.end_date,
             coalesce(e.on_hold, false) as on_hold,
             -- 명단(휴원 포함) = 시작했고 끝나지 않음 · 반이동으로 끝난 수강은 이동일에 이미 끝(반열림) · 일반 종료는 종료일까지(isEnrollmentOnRosterOn)
             (coalesce(e.start_date <= (now() at time zone 'Asia/Seoul')::date, true)
               and (e.end_date is null
                    or (coalesce(e.is_transferred, false) and e.end_date > (now() at time zone 'Asia/Seoul')::date)
                    or (not coalesce(e.is_transferred, false) and e.end_date >= (now() at time zone 'Asia/Seoul')::date))) as on_roster_today,
             -- 수업 대상 = 명단 − 휴원(isEnrollmentActiveOn)
             (not coalesce(e.on_hold, false)
               and coalesce(e.start_date <= (now() at time zone 'Asia/Seoul')::date, true)
               and (e.end_date is null
                    or (coalesce(e.is_transferred, false) and e.end_date > (now() at time zone 'Asia/Seoul')::date)
                    or (not coalesce(e.is_transferred, false) and e.end_date >= (now() at time zone 'Asia/Seoul')::date))) as active_today,
             coalesce(c.is_makeup_pool, false) as makeup_pool_class,
             e.withdrawal_reason,
             e.is_transferred,
             e.is_transferred_in
        from assistant.enrollments e
        left join assistant.classes c on c.id = e.class_id
    $v$;
  end if;

  -- 유효 출결 = 학생·반·수업일·교시마다 recorded_at이 가장 늦은 한 줄(같으면 id 큰 쪽) — effectiveAttendanceRecords와 같다(정정은 새 줄로 쌓인다).
  if to_regclass('assistant.attendance_records') is not null then
    execute $v$
      create view assistant.onto_attendance with (security_barrier = true) as
      select distinct on (a.student_id, a.class_id, a.session_date, a.slot_start)
             a.id, a.student_id, a.class_id, a.session_date, a.slot_start, a.status::text as status, a.taught_by, a.recorded_at,
             a.session_units, a.homework_required, a.homework_done, a.note
        from assistant.attendance_records a
       order by a.student_id, a.class_id, a.session_date, a.slot_start, a.recorded_at desc nulls last, a.id desc
    $v$;
  end if;

  -- 반 → 강사 '배정'(담임 = 지금 값 · 교시 담당 = 기간 · 임시 위임 = 기간). 🔴 배정이지 실제 수업 증거가 아니다(실제 = 출결 taught_by).
  if to_regclass('assistant.classes') is not null and to_regclass('assistant.class_schedules') is not null and to_regclass('assistant.class_delegations') is not null then
    execute $v$
      create view assistant.onto_class_teachers with (security_barrier = true) as
      select c.id as class_id, c.class_name, c.subject, c.teacher_id, 'homeroom'::text as role, '담임'::text as role_label,
             null::date as valid_from, null::date as valid_to, c.closed_at as class_closed_on
        from assistant.classes c
       where c.teacher_id is not null
      union all
      select distinct s.class_id, c.class_name, c.subject, s.teacher_id, 'scheduled', '교시 담당', s.valid_from, s.valid_to, c.closed_at
        from assistant.class_schedules s
        join assistant.classes c on c.id = s.class_id
       where s.teacher_id is not null
      union all
      select d.class_id, c.class_name, c.subject, d.delegate_user_id, 'delegated', '임시 위임', d.from_date, d.to_date, c.closed_at
        from assistant.class_delegations d
        join assistant.classes c on c.id = d.class_id
       where d.revoked_at is null
    $v$;
  end if;

  -- ── s2_0038 · 분석용 보기(원장 2026-11-09 "학생이 줄어드는 원인" 답 검토 → 개선) ─────────────────────────────────

  -- 반 한 줄 + 프로그램 · 상태(운영 중 · 종강 · 종강 예정 · 폐지)를 칸으로. 프로그램 = 영어 반은 english_track='eie'면 EiE, 아니면 인재원 영어
  -- (english-track.ts 'EiE가 아닌 전부') · 그 밖은 과목 키. 과목 이름은 학원 설정(tenant_settings operations.subjects)에서.
  if to_regclass('assistant.classes') is not null and to_regclass('assistant.tenant_settings') is not null then
    execute $v$
      create view assistant.onto_classes with (security_barrier = true) as
      with subj as (
        select x ->> 'key' as key, x ->> 'label' as label
          from assistant.tenant_settings ts
          cross join lateral jsonb_array_elements(case when jsonb_typeof(ts.data -> 'operations' -> 'subjects') = 'array' then ts.data -> 'operations' -> 'subjects' else '[]'::jsonb end) x
      )
      select c.id as class_id,
             c.class_name,
             c.subject,
             coalesce((select s.label from subj s where s.key = c.subject limit 1), c.subject) as subject_label,
             case when c.subject = 'english' and c.english_track = 'eie' then 'eie' when c.subject = 'english' then 'injaewon' else c.subject end as program,
             case when c.subject = 'english' and c.english_track = 'eie' then 'EiE' when c.subject = 'english' then '인재원 영어'
                  else coalesce((select s.label from subj s where s.key = c.subject limit 1), c.subject) end as program_label,
             c.teacher_id as homeroom_teacher_id,
             c.is_active,
             c.closed_at as closed_on,
             case when not c.is_active then 'abolished'
                  when c.closed_at is not null and c.closed_at <= (now() at time zone 'Asia/Seoul')::date then 'closed'
                  when c.closed_at is not null then 'closing'
                  else 'running' end as state,
             case when not c.is_active then '폐지'
                  when c.closed_at is not null and c.closed_at <= (now() at time zone 'Asia/Seoul')::date then '종강'
                  when c.closed_at is not null then '종강 예정'
                  else '운영 중' end as state_label,
             coalesce(c.is_makeup_pool, false) as makeup_pool,
             coalesce(c.is_special, false) as is_special,
             (c.created_at at time zone 'Asia/Seoul')::date as created_on
        from assistant.classes c
    $v$;
  end if;

  -- 담임 이력(앱 teacher-as-of.ts buildHomeroomHistoryIndex와 같은 규칙) — 감사 기록의 담임 전이(class_handover_apply · class_update 중
  -- newTeacherId 있는 줄)로 구간을 만든다. 반 = metadata.classId, 없으면 이 지점에서 하나뿐인 반 이름(target_label). 날짜 = effectiveDate,
  -- 없으면 기록 시각의 한국 날짜. 같은 날 여러 번이면 마지막 것. 첫 전이에 previousTeacherId가 있으면 그 앞 구간(시작 모름)도 만든다.
  -- 마지막(끝 없는) 구간이 지금 담임과 다르면 지금 담임이 이긴다(homeroomTeacherOnDate). 전이가 없는 반은 '지금 담임 · 바뀐 기록 없음' 한 줄.
  -- 🔴 원문 키는 newTeacherId · previousTeacherId다(oldTeacherId는 없다 — 2026-11-09 답 검토에서 비서가 빈 칸을 읽었다).
  if to_regclass('assistant.audit_logs') is not null and to_regclass('assistant.classes') is not null then
    execute $v$
      create view assistant.onto_homeroom_history with (security_barrier = true) as
      with uniq as (
        select btrim(class_name) as name, (array_agg(id))[1] as id
          from assistant.classes
         where btrim(coalesce(class_name, '')) <> ''
         group by btrim(class_name)
        having count(*) = 1
      ), raw as (
        select coalesce(case when a.metadata ->> 'classId' ~ '^[0-9a-fA-F-]{36}$' then (a.metadata ->> 'classId')::uuid end,
                        (select u.id from uniq u where u.name = btrim(coalesce(a.target_label, '')))) as class_id,
               case when a.metadata ->> 'effectiveDate' ~ '^\d{4}-\d{2}-\d{2}$' then (a.metadata ->> 'effectiveDate')::date
                    when a.metadata ->> 'effectiveDate' ~ '^\d{4}-\d{2}-\d{2}T' then ((a.metadata ->> 'effectiveDate')::timestamptz at time zone 'Asia/Seoul')::date
                    else (a.created_at at time zone 'Asia/Seoul')::date end as eff,
               (a.metadata ->> 'newTeacherId')::uuid as teacher_id,
               case when a.metadata ->> 'previousTeacherId' ~ '^[0-9a-fA-F-]{36}$' then (a.metadata ->> 'previousTeacherId')::uuid end as previous_teacher_id,
               a.created_at
          from assistant.audit_logs a
         where a.action in ('class_handover_apply', 'class_update')
           and a.metadata ->> 'newTeacherId' ~ '^[0-9a-fA-F-]{36}$'
      ), t as (
        select * from raw where class_id is not null
      ), d as (
        select distinct on (class_id, eff) class_id, eff, teacher_id
          from t
         order by class_id, eff, created_at desc
      ), spans as (
        select d.class_id, d.eff as valid_from, lead(d.eff) over (partition by d.class_id order by d.eff) as valid_to, d.teacher_id,
               row_number() over (partition by d.class_id order by d.eff) as rn
          from d
      ), firstprev as (
        select distinct on (t.class_id) t.class_id, t.previous_teacher_id, t.eff
          from t
          join (select class_id, min(eff) as eff from t group by class_id) f on f.class_id = t.class_id and f.eff = t.eff
         where t.previous_teacher_id is not null
         order by t.class_id, t.created_at
      ), periods as (
        select s.class_id, s.valid_from, s.valid_to,
               case when s.valid_to is null and c.teacher_id is distinct from s.teacher_id then c.teacher_id else s.teacher_id end as teacher_id,
               case when s.valid_to is null and c.teacher_id is distinct from s.teacher_id then 'current_override' else 'handover' end as source
          from spans s
          join assistant.classes c on c.id = s.class_id
        union all
        select f.class_id, null::date, f.eff, f.previous_teacher_id, 'before_first'
          from firstprev f
        union all
        select c.id, null::date, null::date, c.teacher_id, 'no_record'
          from assistant.classes c
         where not exists (select 1 from t where t.class_id = c.id)
      )
      select p.class_id,
             c.class_name,
             c.subject,
             p.teacher_id,
             p.valid_from,
             p.valid_to,
             p.source,
             case p.source when 'handover' then '담임 변경 기록'
                           when 'before_first' then '첫 변경 기록의 이전 담임(시작일 모름)'
                           when 'current_override' then '지금 담임(마지막 변경 기록과 달라 지금 값을 씀)'
                           else '지금 담임 · 바뀐 기록 없음(과거에도 같았는지는 모름)' end as source_label
        from periods p
        join assistant.classes c on c.id = p.class_id
       where p.teacher_id is not null
    $v$;
  end if;

  -- 형제(앱 siblings.ts와 같은 규칙) — 보호자1·2 휴대폰 열쇠(숫자만 · +82→0 · 01X 10~11자리 · 같은 숫자 8자리 채움 번호 제외)가 하나라도 같으면
  -- 'phone' · 학부모 이름(공백 없앤 소문자 2자 이상)이 같고 한쪽이라도 보호자1 휴대폰이 없으면 'name' · 학생 이름(동명이인 접미사 뗀)이
  -- 같으면 같은 아이의 중복 기록이라 형제 아님. 사람이 정한 것(student_siblings.linked)이 이긴다: true = 형제('manual') · false = 자동 판정을 끈 짝.
  -- 한 짝을 양쪽 방향 두 줄로 싣는다(student_id 기준으로 거르면 그 원생의 형제 전부).
  if to_regclass('assistant.students') is not null and to_regclass('assistant.student_siblings') is not null then
    execute $v$
      create view assistant.onto_siblings with (security_barrier = true) as
      with p as (
        select s.id,
               regexp_replace(lower(regexp_replace(coalesce(s.name, ''), '\s+', '', 'g')), '^(.*[가-힣])[a-z]{1,2}$', '\1') as child_key,
               lower(regexp_replace(coalesce(s.parent_name, ''), '\s+', '', 'g')) as parent_key,
               k1.k as phone1,
               k2.k as phone2
          from assistant.students s
          cross join lateral (
            select case when d ~ '^01\d{8,9}$' and right(d, 8) !~ '^(\d)\1{7}$' then d end as k
              from (select case when d0 like '82%' and length(d0) >= 11 then '0' || substr(d0, 3) else d0 end as d
                      from (select regexp_replace(coalesce(s.parent_phone, ''), '\D', '', 'g') as d0) z0) z1
          ) k1
          cross join lateral (
            select case when d ~ '^01\d{8,9}$' and right(d, 8) !~ '^(\d)\1{7}$' then d end as k
              from (select case when d0 like '82%' and length(d0) >= 11 then '0' || substr(d0, 3) else d0 end as d
                      from (select regexp_replace(coalesce(s.parent2_phone, ''), '\D', '', 'g') as d0) z0) z1
          ) k2
      ), keys as (
        select id, phone1 as k from p where phone1 is not null
        union
        select id, phone2 from p where phone2 is not null
      ), phone_pairs as (
        select distinct a.id as a_id, b.id as b_id from keys a join keys b on a.k = b.k and a.id < b.id
      ), name_pairs as (
        select a.id as a_id, b.id as b_id
          from p a join p b on a.parent_key = b.parent_key and a.id < b.id
         where char_length(a.parent_key) >= 2 and (a.phone1 is null or b.phone1 is null)
      ), auto as (
        select x.a_id, x.b_id, x.basis
          from (select a_id, b_id, 'phone'::text as basis from phone_pairs
                union all
                select n.a_id, n.b_id, 'name' from name_pairs n
                 where not exists (select 1 from phone_pairs q where q.a_id = n.a_id and q.b_id = n.b_id)) x
          join p a on a.id = x.a_id
          join p b on b.id = x.b_id
         where not (a.child_key <> '' and a.child_key = b.child_key)
      ), links as (
        select least(l.student_a, l.student_b) as a_id, greatest(l.student_a, l.student_b) as b_id, l.linked
          from assistant.student_siblings l
      ), pairs as (
        select au.a_id, au.b_id, au.basis
          from auto au
         where not exists (select 1 from links l where l.a_id = au.a_id and l.b_id = au.b_id and l.linked = false)
        union all
        select l.a_id, l.b_id, 'manual'
          from links l
         where l.linked and not exists (select 1 from auto au where au.a_id = l.a_id and au.b_id = l.b_id)
      )
      select x.student_id, x.sibling_id, x.basis,
             case x.basis when 'phone' then '보호자 휴대폰 같음' when 'name' then '학부모 이름 같음(연락처 충돌 없음)' else '직원이 형제로 지정' end as basis_label
        from (select a_id as student_id, b_id as sibling_id, basis from pairs
              union all
              select b_id, a_id, basis from pairs) x
    $v$;

    -- 가구 = 형제 관계로 이어진 원생 묶음(이어진 것끼리 전부 · 가장 작은 원생 id가 가구 id). 형제가 없는 원생은 줄이 없다.
    execute $v$
      create view assistant.onto_households with (security_barrier = true) as
      with recursive e as (
        select student_id as a, sibling_id as b from assistant.onto_siblings
      ), r(root, member) as (
        select distinct a, a from e
        union
        select r.root, e.b from r join e on e.a = r.member
      ), h as (
        select member as student_id, (min(root::text))::uuid as household_id from r group by member
      )
      select h.student_id, h.household_id, count(*) over (partition by h.household_id) as household_size
        from h
    $v$;
  end if;

  -- 학생·청구 달 한 줄 = 그 달 수업료 청구가 살아 있는 학생(앱 '지난 기록' history-aywa.ts와 같은 뜻: category tuition · 취소(void)·환불(refunded) 제외 ·
  -- 미납 포함 · 수업 항목(kind 없음·'수업'·'tuition')이 금액 또는 낸 돈 > 0 · 항목 없는 청구는 총액 > 0이면 수업료 한 줄).
  -- eie_billed = 수업명이 [EiE]로 시작하는 줄 · general_billed = 그 밖의 수업 줄. 🔴 프로그램(수학·인재원 영어·과학…)을 수업명으로 가르는 앱 판정
  -- (lesson-program.ts — 강사 표시를 배우는 판정)은 SQL로 옮기지 못했다 → programs_enrolled = 그 달에 걸친 수강의 반 프로그램(onto_classes.program ·
  -- 보강용 반 제외)이고, lesson_names = 수업명 원문. 학원 전체 프로그램별 청구 학생 수는 앱이 계산해 둔 student_history_monthly(source='aywa')를 쓴다.
  if to_regclass('assistant.invoices') is not null and to_regclass('assistant.onto_students') is not null
     and to_regclass('assistant.enrollments') is not null and to_regclass('assistant.classes') is not null then
    execute $v$
      create view assistant.onto_tuition_months with (security_barrier = true) as
      with lines as (
        select i.id as invoice_id, i.student_id, i.period, i.amount_total, x as item
          from assistant.invoices i
          left join lateral jsonb_array_elements(case when jsonb_typeof(i.line_items) = 'array' then i.line_items else '[]'::jsonb end) x on true
         where coalesce(i.category, 'tuition') = 'tuition'
           and i.status::text not in ('void', 'refunded')
           and i.period ~ '^\d{4}-\d{2}$'
      ), judged as (
        select l.student_id, l.period,
               (l.item is null and coalesce(l.amount_total, 0) > 0) as headless,
               case when jsonb_typeof(l.item) = 'object'
                         and coalesce(l.item ->> 'kind', '') in ('', '수업', 'tuition')
                         and (case when jsonb_typeof(l.item -> 'amount') = 'number' then (l.item ->> 'amount')::numeric
                                   when l.item ->> 'amount' ~ '^-?\d+(\.\d+)?$' then (l.item ->> 'amount')::numeric else 0 end > 0
                              or case when jsonb_typeof(l.item -> 'paid') = 'number' then (l.item ->> 'paid')::numeric
                                      when l.item ->> 'paid' ~ '^-?\d+(\.\d+)?$' then (l.item ->> 'paid')::numeric else 0 end > 0)
                    then coalesce(l.item ->> 'description', l.item ->> 'label', l.item ->> 'name', '') end as lesson_name
          from lines l
      ), m as materialized (
        select j.student_id,
               to_date(j.period || '-01', 'YYYY-MM-DD') as month,
               bool_or(j.lesson_name ~* '^\s*\[eie\]') as eie_billed,
               bool_or(j.headless or (j.lesson_name is not null and j.lesson_name !~* '^\s*\[eie\]')) as general_billed,
               array_remove(array_agg(distinct nullif(btrim(j.lesson_name), '')), null) as lesson_names
          from judged j
         group by j.student_id, j.period
      ), enr as materialized (
        -- 🔴 보기끼리 이으면(security_barrier) 줄마다 다시 읽어 수십 초가 걸린다 — 필요한 칸만 먼저 한 번 읽어 둔다(비서 조회 상한 8초).
        select e.student_id, coalesce(e.start_date, date '1900-01-01') as start_date, e.end_date,
               case when c.subject = 'english' and c.english_track = 'eie' then 'eie'
                    when c.subject = 'english' then 'injaewon' else c.subject end as program
          from assistant.enrollments e
          join assistant.classes c on c.id = e.class_id
         where not coalesce(c.is_makeup_pool, false)
      ), st as materialized (
        select id, counted, exit_kind, status_label from assistant.onto_students
      ), progs as materialized (
        -- 그 달에 걸친 수강의 반 프로그램(보강용 반 제외).
        select m.student_id, m.month, array_agg(distinct e.program) as programs
          from m
          join enr e on e.student_id = m.student_id
                    and e.start_date <= (m.month + interval '1 month - 1 day')::date
                    and (e.end_date is null or e.end_date >= m.month)
         group by m.student_id, m.month
      )
      select m.student_id,
             m.month,
             to_char(m.month, 'YYYY-MM') as month_label,
             coalesce(m.eie_billed, false) as eie_billed,
             coalesce(m.general_billed, false) as general_billed,
             m.lesson_names,
             p.programs as programs_enrolled,
             s.counted,
             s.exit_kind,
             s.status_label
        from m
        left join progs p on p.student_id = m.student_id and p.month = m.month
        left join st s on s.id = m.student_id
       where coalesce(m.eie_billed, false) or coalesce(m.general_billed, false)
    $v$;
  end if;

  -- 강사 퇴원율(앱 강사평가가 계산·마감한 값 그대로 — teacher_portfolio_months.payload items의 'churn' 항목). 분모 = 지난달 정규 수업으로
  -- 16일 이상 맡은 학생(그때 담임·교시 담당 모두) · 분자 = 이 달 그 선생님 반·과목을 그만둔 학생(원장이 고른 제외 사유·반 이동·같은 과목 계속 수강 제외).
  -- 🔴 비서가 지금 담임을 과거에 붙여 강사별 퇴원율을 따로 계산하지 않게 — 강사별 퇴원율은 이 보기로.
  if to_regclass('assistant.teacher_portfolio_months') is not null and to_regclass('assistant.users') is not null then
    execute $v$
      create view assistant.onto_teacher_churn with (security_barrier = true) as
      select t.teacher_id,
             u.display_name as teacher_name,
             t.month,
             t.subjects,
             (t.closed_at is not null) as month_closed,
             case when i ->> 'raw' ~ '^-?\d+(\.\d+)?$' then (i ->> 'raw')::numeric end as churn_rate,
             case when i ->> 'base' ~ '^\d+$' then (i ->> 'base')::integer end as base_students,
             case when i ->> 'counted' ~ '^\d+$' then (i ->> 'counted')::integer end as quit_students,
             i ->> 'basis' as basis,
             case when jsonb_typeof(i -> 'detail') = 'array' then i -> 'detail' end as quits,
             case when i ->> 'value' ~ '^-?\d+(\.\d+)?$' then (i ->> 'value')::numeric end as score,
             case when i ->> 'max' ~ '^-?\d+(\.\d+)?$' then (i ->> 'max')::numeric end as score_max
        from assistant.teacher_portfolio_months t
        cross join lateral jsonb_array_elements(case when jsonb_typeof(t.payload -> 'items') = 'array' then t.payload -> 'items' else '[]'::jsonb end) i
        left join assistant.users u on u.id = t.teacher_id
       where i ->> 'id' = 'churn'
    $v$;
  end if;
end $$;

revoke all on function assistant_private.create_ontology_views() from public, anon, authenticated, service_role;
-- 연동 역할 실행권 확인: advice_guard는 트리거 함수(실행권 없이 발화) · create_ontology_views는 refresh_views(보안 정의자)만 부른다 — 둘 다 s2_0031·s2_0036 그대로 거둔 상태를 되풀이할 뿐이고 연동 PC 역할(eywa_sync_agent)의 RLS·질의 경로에 없다.

-- ── §4 지금 다시 만든다(refresh_views가 보기 전부를 지우고 다시 만든 뒤 비서 역할에 읽기만 준다) ─────────────
select assistant_private.refresh_views();

-- ── §5 사후 확인 ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v text;
begin
  foreach v in array array['onto_students', 'onto_enrollments', 'onto_attendance', 'onto_class_teachers',
                           'onto_classes', 'onto_homeroom_history', 'onto_siblings', 'onto_households', 'onto_tuition_months', 'onto_teacher_churn'] loop
    if to_regclass('assistant.' || v) is null then
      raise exception 's2_0038: 보기 assistant.%가 만들어지지 않았습니다', v;
    end if;
    if exists (select 1 from pg_roles where rolname = 'aywa_assistant') and not has_table_privilege('aywa_assistant', 'assistant.' || v, 'select') then
      raise exception 's2_0038: 비서 역할이 assistant.%를 읽을 수 없습니다', v;
    end if;
    if has_table_privilege('anon', 'assistant.' || v, 'select') or has_table_privilege('authenticated', 'assistant.' || v, 'select') then
      raise exception 's2_0038: 로그인·비로그인 사용자가 assistant.%를 읽을 수 있습니다', v;
    end if;
  end loop;
  if (select signature from assistant_private.state where id) is distinct from assistant_private.schema_signature() then
    raise exception 's2_0038: 보기 상태의 생성 규칙 판이 새 값이 아닙니다';
  end if;
  if to_regclass('assistant.assistant_advice') is not null then
    raise exception 's2_0038: 비서 보기에 의견 표가 있습니다';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
