-- 0086a: 활동 로그 target_label 디테일 — FK만 있어 "누구/무엇"이 빈약한 테이블에 반/시간/날짜를 조인해 붙임. 멱등.
-- 배경(사용자 제보 2026-07-09): "수강 「김재윤」 생성"은 어느 반인지 안 보여 '수업 배정'인지 알 수 없고,
--   "시간표 생성"은 대상이 아예 없다(class_schedules는 이름 컬럼 없이 class_id·요일·교시만 → target_label NULL).
-- 이 정보는 전부 FK(class_id=uuid) 뒤라 표시 레이어(activity.ts)에서 못 푼다 → 트리거에서 classes 조인해 라벨에 굽는다.
--   · enrollments      → "학생명 · 반이름"        (예: "김재윤 · 중2 수학A") = 사실상 수업 배정임을 명시
--   · class_schedules  → "반이름 · 요일 교시/시간"  (예: "중2 수학A · 월 3교시")
--   · attendance_records → "학생명 · MM-DD 출결상태" (예: "홍길동 · 07-09 출석")
-- 0085a log_activity()를 create-or-replace로 교체(refund 예외·noise·redact·트리거부착 전부 보존, 라벨 enrichment만 추가).

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
  redact text[] := array['form_data', 'print_payload', 'ai_summary', 'subject_details',
                         'subject_progress', 'hourly_rate', 'monthly_base',
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
      select s.name into v_label from public.students s where s.id = v_sid::uuid;
    end if;
  end if;
  if v_label is null then
    v_sid := v_ref ->> 'user_id';
    if v_sid is not null and v_sid <> '' then
      select u.display_name into v_label from public.users u where u.id = v_sid::uuid;
    end if;
  end if;

  -- 테이블별 라벨 디테일(FK 조인) — 수강/시간표/출결은 이름만으론 "무엇인지" 부족.
  if tg_table_name = 'enrollments' then
    -- 수강 = 학생을 반에 배정 → "학생명 · 반이름"
    select s.name into v_stud from public.students s where s.id = nullif(v_ref ->> 'student_id', '')::uuid;
    select c.class_name into v_cls from public.classes c where c.id = nullif(v_ref ->> 'class_id', '')::uuid;
    v_label := nullif(concat_ws(' · ', v_stud, v_cls), '');
  elsif tg_table_name = 'class_schedules' then
    -- 시간표 = 반의 요일·교시 → "반이름 · 요일 교시(또는 시작시각)"
    select c.class_name into v_cls from public.classes c where c.id = nullif(v_ref ->> 'class_id', '')::uuid;
    v_when := trim(concat_ws(' ',
      case v_ref ->> 'day_of_week'
        when 'mon' then '월' when 'tue' then '화' when 'wed' then '수' when 'thu' then '목'
        when 'fri' then '금' when 'sat' then '토' when 'sun' then '일' else v_ref ->> 'day_of_week' end,
      coalesce(nullif(v_ref ->> 'period_label', ''), left(v_ref ->> 'start_time', 5))));
    v_label := nullif(concat_ws(' · ', coalesce(v_cls, '시간표'), nullif(v_when, '')), '');
  elsif tg_table_name = 'attendance_records' then
    -- 출결 = 학생·날짜·상태 → "학생명 · MM-DD 출결상태"
    select s.name into v_stud from public.students s where s.id = nullif(v_ref ->> 'student_id', '')::uuid;
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
          -- 환불요청서(form_type='refund_request')의 form_data만 필드별 변경 노출(사무실 요청, 0085a).
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
