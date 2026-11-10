-- 되돌리기: s2_0039_academy_assistant_analysis_views.sql — 앱을 먼저 되돌린 뒤 실행한다(새 앱은 의견 표의 새 칸에 쓴다).
-- 보기 생성 함수·생성 규칙 판(rules-v1)·의견 지킴 트리거를 s2_0031·s2_0036 본문으로 되돌리고, 새 칸을 지운 뒤 보기를 다시 만든다.
-- ⚠️ 새 칸(대상 명단·실행 지표·실행일)에 쌓인 값은 사라진다.
begin;
set local lock_timeout = '5s';

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
    || '|rules-v1'
  )
$$;

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
end $$;

create or replace function assistant_private.advice_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.tenant_id, new.message_id, new.thread_id, new.item_no, new.asked_by)
       is distinct from (old.tenant_id, old.message_id, old.thread_id, old.item_no, old.asked_by) then
    raise exception '비서 의견의 지점·답·순번·묻는 사람은 바꿀 수 없습니다' using errcode = '42501';
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
  -- 처리 시각은 DB 시계로 — 앱이 status_at을 바꿔 보내면(처리했다는 표시 · 낙관적 잠금의 새 값) 그 값 대신 now()
  -- (서버마다 시계가 달라도 처리 순서가 맞게 · 다음 단계가 이 시각으로 '처리 뒤 측정'을 가른다 · 적대 리뷰 2026-11-09).
  if tg_op = 'UPDATE' and new.status_at is distinct from old.status_at then
    new.status_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function assistant_private.advice_guard(), assistant_private.create_ontology_views() from public, anon, authenticated, service_role;

alter table public.assistant_advice drop constraint if exists assistant_advice_target_kind_check;
alter table public.assistant_advice drop constraint if exists assistant_advice_target_pair;
alter table public.assistant_advice drop constraint if exists assistant_advice_exec_check_shape;
alter table public.assistant_advice
  drop column if exists target_kind,
  drop column if exists target_ids,
  drop column if exists exec_check,
  drop column if exists acted_on;

select assistant_private.refresh_views();

commit;

notify pgrst, 'reload schema';
