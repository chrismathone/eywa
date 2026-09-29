-- 0303a: security definer 트리거의 교차 조회에 **같은 학원(tenant_id) 조건**을 더한다 (보안 감사 2026-09-29)
--
-- 목적: 아래 세 트리거 함수는 security definer라 RLS를 우회한다. 그런데 NEW 행이 가리키는 다른 표 행
--   (학생·반·직원·수강)을 id만으로 조회하고 tenant_id를 확인하지 않았다. FK는 "그 id가 존재한다"만 보장하고
--   "같은 학원이다"는 보장하지 않는다.
--
-- 공격 시나리오:
--   · A 학원 사용자가 자기 학원 행(출결·수강·보고서 등)의 student_id/class_id/user_id에 **B 학원 행의 UUID**를 넣는다
--     → log_activity가 B 학원 학생 이름·반 이름·직원 이름을 조회해 **A 학원 활동 로그**에 target_label로 실어 준다(교차 누출).
--   · 수업 보고서·학부모 공지의 class_id / targets[].studentId / created_by에 B 학원 UUID를 넣고 발송 실패로 만든다
--     → B 학원 강사(또는 임의 사용자)에게 알림이 들어가고(알림 행은 A 학원 tenant_id로 찍힘), B 학원 학생 이름이 A 쪽 알림 본문에 실린다.
--
-- 변경: 각 함수의 **최신 정의를 그대로 복사**하고, 교차 조회에 `and <별칭>.tenant_id = <행의 학원>`만 더했다.
--   알림 수신자(반 담당 강사·발송자)는 같은 학원 사용자일 때만 받는다. 문구·수신자 규칙·예외 삼킴 등 나머지는 한 글자도 안 바꿨다.
--   · log_activity            ← 0120a_activity_redact_salary_policy.sql
--   · notify_report_send_failed ← 0153a_test_student_flag_notify_skip.sql (0144a를 덮은 최신판 — 0153a의 사유 문구 그대로)
--   · notify_notice_send_failed ← 0144a_notify_notice_send_failed.sql
--   ⚠️ log_activity의 행위자 이름 조회(auth.uid() → users)는 조건을 걸지 않았다 — NEW가 가리키는 값이 아니라
--      로그인한 본인이라 위조 경로가 아니고, 다른 학원 소속 계정(총괄 등)이 작업할 때 이름이 비는 변화를 피하려고.
--
-- 앱 배포와 독립: 순수 강화다(컬럼·시그니처·트리거 부착 불변, create or replace만). 앱 코드는 이 함수들을 직접 부르지 않는다.
--   정상 데이터(같은 학원끼리 가리키는 행)에서는 결과가 같다.
-- 되돌리기: 별도 요청.
-- 멱등: create or replace (트리거 부착·함수 주석·권한은 그대로 유지된다).

-- 1) 활동 로그 ------------------------------------------------------------------
create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_ref jsonb;
  v_new jsonb;
  v_old jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_tenant uuid;
  v_row_id uuid;
  v_label text;
  v_sid text;
  v_key text;
  v_stud text;   -- 조인 결과: 학생명
  v_cls text;    -- 조인 결과: 반이름
  v_when text;   -- 요일·교시/시간 또는 날짜·출결 등 부가 라벨
  -- noise = 무의미/기계 자동필드(사람 편집 아님) → 이것만 바뀐 UPDATE는 로그 안 남김.
  noise text[] := array['updated_at', 'created_at', 'status_at', 'sync_added_at', 'updated_by',
                        'audio_path', 'audio_size_bytes', 'audio_duration_sec', 'processing_status',
                        'processing_error', 'speaker_labels', 'assemblyai_transcript_id', 'transcription',
                        'makeedu_id', 'makeedu_pushed_at',
                        'classnote_status', 'classnote_error', 'classnote_queued_at', 'classnote_processing_at',
                        'classnote_sent_at', 'classnote_retry_count',
                        'usage_count', 'submission_count', 'last_seen_at', 'last_seen_ip', 'recorded_at'];
  -- redact = 대형/민감 내용("바뀜"만 남기고 원문 미복사) + 급여(원장 전용) + 공개링크 토큰.
  --   ⚠️ form_data는 아래 UPDATE 분기에서 환불요청서만 예외적으로 원본 기록(그 외 폼=이력서 등은 redact 유지).
  --   ⚠️ 급여 컬럼 추가 시 여기에도 추가(0120a: salary_type·commission_rate).
  redact text[] := array['form_data', 'print_payload', 'ai_summary', 'subject_details',
                         'subject_progress', 'hourly_rate', 'monthly_base', 'salary_type', 'commission_rate',
                         'base_amount', 'hours_worked', 'hourly_amount', 'bonus', 'deduction', 'total',
                         'share_token', 'token', 'token_hash', 'attachments', 'payload'];
begin
  if tg_op = 'DELETE' then v_ref := to_jsonb(old); else v_ref := to_jsonb(new); end if;
  v_tenant := nullif(v_ref ->> 'tenant_id', '')::uuid;
  v_row_id := nullif(v_ref ->> 'id', '')::uuid;
  if v_tenant is null then return null; end if;

  -- 대상 이름(사람이 읽는 라벨): 흔한 이름 컬럼 폭넓게 → student_id→학생명 → user_id→직원명.
  v_label := coalesce(
    v_ref ->> 'name', v_ref ->> 'prospect_name', v_ref ->> 'student_name',
    v_ref ->> 'class_name', v_ref ->> 'title', v_ref ->> 'book_name',
    v_ref ->> 'display_name', v_ref ->> 'parent_name', v_ref ->> 'full_name'
  );
  if v_label is null then
    v_sid := v_ref ->> 'student_id';
    if v_sid is not null and v_sid <> '' then
      select s.name into v_label from public.students s where s.id = v_sid::uuid and s.tenant_id = v_tenant;
    end if;
  end if;
  if v_label is null then
    v_sid := v_ref ->> 'user_id';
    if v_sid is not null and v_sid <> '' then
      select u.display_name into v_label from public.users u where u.id = v_sid::uuid and u.tenant_id = v_tenant;
    end if;
  end if;

  -- 테이블별 라벨 디테일(FK 조인) — 수강/시간표/출결은 이름만으론 "무엇인지" 부족.
  if tg_table_name = 'enrollments' then
    select s.name into v_stud from public.students s where s.id = nullif(v_ref ->> 'student_id', '')::uuid and s.tenant_id = v_tenant;
    select c.class_name into v_cls from public.classes c where c.id = nullif(v_ref ->> 'class_id', '')::uuid and c.tenant_id = v_tenant;
    v_label := nullif(concat_ws(' · ', v_stud, v_cls), '');
  elsif tg_table_name = 'class_schedules' then
    select c.class_name into v_cls from public.classes c where c.id = nullif(v_ref ->> 'class_id', '')::uuid and c.tenant_id = v_tenant;
    v_when := trim(concat_ws(' ',
      case v_ref ->> 'day_of_week'
        when 'mon' then '월' when 'tue' then '화' when 'wed' then '수' when 'thu' then '목'
        when 'fri' then '금' when 'sat' then '토' when 'sun' then '일' else v_ref ->> 'day_of_week' end,
      coalesce(nullif(v_ref ->> 'period_label', ''), left(v_ref ->> 'start_time', 5))));
    v_label := nullif(concat_ws(' · ', coalesce(v_cls, '시간표'), nullif(v_when, '')), '');
  elsif tg_table_name = 'attendance_records' then
    select s.name into v_stud from public.students s where s.id = nullif(v_ref ->> 'student_id', '')::uuid and s.tenant_id = v_tenant;
    v_when := trim(concat_ws(' ',
      to_char(nullif(v_ref ->> 'session_date', '')::date, 'MM-DD'),
      case v_ref ->> 'status'
        when 'present' then '출석' when 'absent' then '결석' when 'late' then '지각'
        when 'excused' then '인정결석' when 'makeup' then '보강' when 'early_leave' then '조퇴'
        else v_ref ->> 'status' end));
    v_label := nullif(concat_ws(' · ', v_stud, nullif(v_when, '')), '');
  end if;

  if tg_op = 'UPDATE' then
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any(noise) then continue; end if;
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        if v_key = any(redact) then
          if v_key = 'form_data' and coalesce(v_new ->> 'form_type', '') = 'refund_request' then
            v_changed := v_changed || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
          else
            v_changed := v_changed || jsonb_build_object(v_key, jsonb_build_object('redacted', true));
          end if;
        else
          v_changed := v_changed || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
        end if;
      end if;
    end loop;
    if v_changed = '{}'::jsonb then return null; end if;
  else
    v_changed := v_ref - noise - redact;
  end if;

  if v_actor is not null then
    select display_name into v_actor_name from public.users where id = v_actor;
  end if;

  insert into public.activity_log (tenant_id, actor_id, actor_name, table_name, row_id, target_label, op, changed)
  values (v_tenant, v_actor, v_actor_name, tg_table_name, v_row_id, v_label, tg_op, v_changed);
  return null;
exception when others then
  return null; -- ⚠️ 감사 실패가 원래 쓰기를 막지 않게(문장 롤백 방지). 절대 re-raise 금지.
end;
$$;
revoke all on function public.log_activity() from public;

-- 2) 수업 보고서 발송 실패 알림 -------------------------------------------------
create or replace function public.notify_report_send_failed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_student text;
  v_hint text;
begin
  -- 🔴 테스트 학생(0153a)은 알리지 않는다 — 학부모가 없어 실패가 정상이라 매번 오탐이 된다.
  if exists (select 1 from public.students s where s.id = NEW.student_id and s.tenant_id = NEW.tenant_id and s.is_test) then
    return NEW;
  end if;

  -- 수신자 ① 반 담당 강사
  select c.teacher_id into v_recipient
  from public.classes c
  where c.id = NEW.class_id and c.tenant_id = NEW.tenant_id and c.teacher_id is not null
    and exists (select 1 from public.users tu where tu.id = c.teacher_id and tu.tenant_id = NEW.tenant_id);

  -- 수신자 ② 보고서에 적힌 강사 이름과 일치하는 재직 강사(반 연결이 끊긴 옛 행 대비)
  if v_recipient is null and coalesce(NEW.teacher_name, '') <> '' then
    select u.id into v_recipient
    from public.users u
    where u.tenant_id = NEW.tenant_id
      and u.status = 'active'
      and u.display_name = NEW.teacher_name
    limit 1;
  end if;

  select s.name into v_student from public.students s where s.id = NEW.student_id and s.tenant_id = NEW.tenant_id;

  v_hint := case
    when coalesce(NEW.classnote_error, '') ilike '%학생 없음%'
      then '학부모가 ClassNote 알림장에 연결되어 있지 않습니다 — 학부모를 초대한 뒤 다시 발송하세요.'
    when coalesce(NEW.classnote_error, '') = '' then '사유가 기록되지 않았습니다 — 발송 콘솔에서 확인하세요.'
    else NEW.classnote_error
  end;

  if v_recipient is null then
    insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
    select NEW.tenant_id, u.id, 'report_send_failed', '수업 보고서 발송 실패',
           coalesce(v_student, '학생') || ' · ' || to_char(NEW.report_date, 'MM-DD') || ' — ' || v_hint,
           '/lesson-reports', null
    from public.users u
    where u.tenant_id = NEW.tenant_id and u.status = 'active' and u.system_role = 'master';
  else
    insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
    values (NEW.tenant_id, v_recipient, 'report_send_failed', '수업 보고서 발송 실패',
            coalesce(v_student, '학생') || ' · ' || to_char(NEW.report_date, 'MM-DD') || ' — ' || v_hint,
            '/lesson-reports', null);
  end if;

  return NEW;
exception
  -- best-effort — 알림 insert가 실패해도 발송 상태 기록(본 UPDATE)을 막지 않는다(0143a 원칙 유지).
  when others then
    return NEW;
end;
$$;

-- 3) 학부모 공지 발송 실패 알림 -------------------------------------------------
create or replace function public.notify_notice_send_failed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fails jsonb;
  v_n int;
  v_all text;   -- 실패 학생 전체 목록(발송자·master용)
  v_hint text;  -- 대표 사유
  v_mixed boolean;
  v_by_teacher jsonb; -- [{tid, names}] — 담당 강사별 "그 강사의 실패 학생" 목록
begin
  if jsonb_typeof(NEW.results) <> 'array' then return NEW; end if;

  -- 실패 타깃 추출 — **`ok` 키가 있고 false인 것만**(회수·수정 결과 오탐 방지, 헤더 주석 참조).
  select coalesce(jsonb_agg(jsonb_build_object(
           'sid',  nullif((select tt->>'studentId' from jsonb_array_elements(NEW.targets) tt
                            where tt->>'board' = r->>'board' limit 1), ''),
           'name', coalesce((select tt->>'studentName' from jsonb_array_elements(NEW.targets) tt
                              where tt->>'board' = r->>'board' limit 1), r->>'board'),
           'note', r->>'note')), '[]'::jsonb)
    into v_fails
  from jsonb_array_elements(NEW.results) r
  where r ? 'ok' and (r->>'ok')::boolean is not true;

  v_n := jsonb_array_length(v_fails);
  if v_n = 0 then return NEW; end if;

  select string_agg(distinct f->>'name', ', '),
         public.classnote_failure_hint(min(f->>'note')),
         count(distinct coalesce(f->>'note', '')) > 1
    into v_all, v_hint, v_mixed
  from jsonb_array_elements(v_fails) f;

  -- ① 담당 강사 — **자기 학생만** 담아 보낸다(남의 학생 이름을 굳이 뿌리지 않는다). 수신자당 1건.
  --    ⚠️ 학생이 두 반(다른 강사)을 들으면 양쪽 다 담당이므로 둘 다 받는다(초대할 수 있는 사람이 둘).
  select coalesce(jsonb_agg(jsonb_build_object('tid', q.teacher_id, 'names', q.names)), '[]'::jsonb)
    into v_by_teacher
  from (
    select c.teacher_id, string_agg(distinct f->>'name', ', ') as names
    from jsonb_array_elements(v_fails) f
    join public.enrollments e on e.student_id = (f->>'sid')::uuid and e.end_date is null and e.tenant_id = NEW.tenant_id
    join public.classes c on c.id = e.class_id and c.teacher_id is not null and c.tenant_id = NEW.tenant_id
    where f->>'sid' is not null
      and exists (select 1 from public.users tu where tu.id = c.teacher_id and tu.tenant_id = NEW.tenant_id)
    group by c.teacher_id
  ) q;

  insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
  select NEW.tenant_id, (x->>'tid')::uuid, 'notice_send_failed', '학부모 공지 발송 실패',
         (x->>'names') || ' — ' || v_hint, '/lesson-reports?tab=notice', null
  from jsonb_array_elements(v_by_teacher) x;

  -- ② 발송자 — 자기가 보낸 공지가 덜 나갔다는 사실(전체 목록). 이미 담당으로 받은 사람이면 생략.
  if NEW.created_by is not null
     and exists (select 1 from public.users cu where cu.id = NEW.created_by and cu.tenant_id = NEW.tenant_id)
     and not exists (select 1 from jsonb_array_elements(v_by_teacher) x where (x->>'tid')::uuid = NEW.created_by) then
    insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
    values (NEW.tenant_id, NEW.created_by, 'notice_send_failed', '학부모 공지 발송 실패',
            v_all || ' — ' || v_hint || case when v_mixed then ' (사유 여러 건)' else '' end,
            '/lesson-reports?tab=notice', null);
  end if;

  -- ③ 아무에게도 못 보냈으면 master 폴백(알림이 사라지지 않게).
  if jsonb_array_length(v_by_teacher) = 0 and (NEW.created_by is null
      or not exists (select 1 from public.users cu where cu.id = NEW.created_by and cu.tenant_id = NEW.tenant_id)) then
    insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
    select NEW.tenant_id, u.id, 'notice_send_failed', '학부모 공지 발송 실패',
           v_all || ' — ' || v_hint, '/lesson-reports?tab=notice', null
    from public.users u
    where u.tenant_id = NEW.tenant_id and u.status = 'active' and u.system_role = 'master';
  end if;

  return NEW;
exception
  when others then return NEW; -- best-effort: 알림이 공지 상태 기록을 막지 않는다
end;
$$;
