-- 0083a: 활동 로그 "누구" 개선 — target_label을 폭넓게 뽑고, 이름 컬럼이 없는 테이블은 student_id→학생명 조회. 멱등.
-- 배경(사용자 제보): "등록상담 수정"이 누구인지 안 보임 — enrollment_consultations는 학생이 아니라 prospect_name에
-- 이름이 있는데 트리거 coalesce에 없었음. 일부 테이블(상담/성적/수납/레벨테스트)은 이름 컬럼 없이 student_id 링크만.
-- 0081a log_activity()를 create-or-replace로 교체(트리거 재부착 불필요 — 같은 함수를 참조).

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
  -- noise = 무의미/기계 자동필드(사람 편집 아님) → 이것만 바뀐 UPDATE는 로그 안 남김.
  --   타임스탬프 + 오디오 처리 파이프라인(업로드→전사→분석, AssemblyAI 웹훅) + makeedu 동기화 필드.
  noise text[] := array['updated_at', 'created_at', 'status_at', 'sync_added_at', 'updated_by',
                        'audio_path', 'audio_size_bytes', 'audio_duration_sec', 'processing_status',
                        'processing_error', 'speaker_labels', 'assemblyai_transcript_id', 'transcription',
                        'makeedu_id', 'makeedu_pushed_at'];
  -- redact = 대형/민감 내용(사람 편집이라 "바뀜"은 남기되 원문 미복사) + 급여(원장 전용).
  redact text[] := array['form_data', 'print_payload', 'ai_summary', 'subject_details',
                         'subject_progress', 'hourly_rate', 'monthly_base'];
begin
  if tg_op = 'DELETE' then v_ref := to_jsonb(old); else v_ref := to_jsonb(new); end if;
  v_tenant := nullif(v_ref ->> 'tenant_id', '')::uuid;
  v_row_id := nullif(v_ref ->> 'id', '')::uuid;
  if v_tenant is null then return null; end if;

  -- 대상 이름(사람이 읽는 라벨): 흔한 이름 컬럼 폭넓게 → 없으면 student_id로 학생명 조회.
  v_label := coalesce(
    v_ref ->> 'name', v_ref ->> 'prospect_name', v_ref ->> 'student_name',
    v_ref ->> 'class_name', v_ref ->> 'title', v_ref ->> 'book_name',
    v_ref ->> 'display_name', v_ref ->> 'parent_name'
  );
  if v_label is null then
    v_sid := v_ref ->> 'student_id';
    if v_sid is not null and v_sid <> '' then
      select s.name into v_label from public.students s where s.id = v_sid::uuid;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any(noise) then continue; end if;
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        if v_key = any(redact) then
          v_changed := v_changed || jsonb_build_object(v_key, jsonb_build_object('redacted', true));
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
  return null;
end;
$$;

-- 기존 로그(target_label null) 백필 — 이름 컬럼 있는 테이블 + student_id 링크 테이블.
update public.activity_log a set target_label = ec.prospect_name
  from public.enrollment_consultations ec
  where a.table_name = 'enrollment_consultations' and a.row_id = ec.id
    and a.target_label is null and ec.prospect_name is not null;
update public.activity_log a set target_label = e.name
  from public.exams e where a.table_name = 'exams' and a.row_id = e.id and a.target_label is null;
update public.activity_log a set target_label = x.title
  from public.expenses x where a.table_name = 'expenses' and a.row_id = x.id and a.target_label is null;
-- student_id 링크 테이블(상담/성적/수납/레벨테스트/코멘트/목표) → 학생명(테이블별 단순 조인).
update public.activity_log a set target_label = s.name
  from public.student_consultations t join public.students s on s.id = t.student_id
  where a.table_name = 'student_consultations' and a.row_id = t.id and a.target_label is null;
update public.activity_log a set target_label = s.name
  from public.student_grades t join public.students s on s.id = t.student_id
  where a.table_name = 'student_grades' and a.row_id = t.id and a.target_label is null;
update public.activity_log a set target_label = s.name
  from public.invoices t join public.students s on s.id = t.student_id
  where a.table_name = 'invoices' and a.row_id = t.id and a.target_label is null;
update public.activity_log a set target_label = s.name
  from public.level_tests t join public.students s on s.id = t.student_id
  where a.table_name = 'level_tests' and a.row_id = t.id and a.target_label is null;
update public.activity_log a set target_label = s.name
  from public.grade_comments t join public.students s on s.id = t.student_id
  where a.table_name = 'grade_comments' and a.row_id = t.id and a.target_label is null;
update public.activity_log a set target_label = s.name
  from public.grade_goals t join public.students s on s.id = t.student_id
  where a.table_name = 'grade_goals' and a.row_id = t.id and a.target_label is null;
update public.activity_log a set target_label = s.name
  from public.enrollments t join public.students s on s.id = t.student_id
  where a.table_name = 'enrollments' and a.row_id = t.id and a.target_label is null;
