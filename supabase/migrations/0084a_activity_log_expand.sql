-- 0084a: 활동 로그 커버리지 확장 — 출결·수업리포트·학생메모·강의실·교재/수강료 카탈로그·견적·공지·휴가·급여·
-- 재등록캠페인·영어레벨·QR접수링크·키오스크 장비까지 트리거 부착(사용자 요청 2026-07-08: "지출 외 기타 필요한 로그").
-- ⚠️ 지출(expenses)은 0081a에서 이미 부착됨 — 이 파일은 나머지 공백을 메운다. 멱등.
--
-- 0083a log_activity()를 create-or-replace로 교체(기존 트리거는 같은 함수 참조라 재부착 불필요):
--   · noise += classnote 발송 파이프라인(기계 상태 전이)·QR usage 카운터·키오스크 last_seen 핑·recorded_at
--     → 키오스크 핑/QR 제출 카운트만 바뀐 UPDATE는 로그 0건(2026-07-07 "의미있는 변경만" 결정 유지).
--   · redact += 급여 금액(payroll_records — activity_log는 admin/manager도 읽는데 급여는 원장 전용)
--     + 공개링크 토큰(share_token/token/token_hash — 로그로 링크 유출 방지) + 대형 blob(attachments/payload).
--     ⚠️ redact는 전 테이블 공용 blocklist — 새 컬럼명이 다른 테이블의 일반 컬럼과 겹치지 않는지 확인하고 추가할 것
--     (현재 'total'은 payroll_records에만 존재. invoices=amount_total, tuition_quotes=total_amount라 안전).
--   · target_label: full_name(english_levels) 추가 + student_id 다음 user_id→직원명 폴백(staff_leaves/payroll_records).

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
  --   타임스탬프 + 오디오 처리 파이프라인 + makeedu 동기화 + classnote 발송 파이프라인(lesson_reports)
  --   + QR 접수 카운터(intake_tokens) + 키오스크 핑(kiosk_devices).
  noise text[] := array['updated_at', 'created_at', 'status_at', 'sync_added_at', 'updated_by',
                        'audio_path', 'audio_size_bytes', 'audio_duration_sec', 'processing_status',
                        'processing_error', 'speaker_labels', 'assemblyai_transcript_id', 'transcription',
                        'makeedu_id', 'makeedu_pushed_at',
                        'classnote_status', 'classnote_error', 'classnote_queued_at', 'classnote_processing_at',
                        'classnote_sent_at', 'classnote_retry_count',
                        'usage_count', 'submission_count', 'last_seen_at', 'last_seen_ip', 'recorded_at'];
  -- redact = 대형/민감 내용("바뀜"만 남기고 원문 미복사) + 급여(원장 전용) + 공개링크 토큰.
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
  return null; -- ⚠️ 감사 실패가 원래 쓰기를 막지 않게(문장 롤백 방지). 절대 re-raise 금지.
end;
$$;
revoke all on function public.log_activity() from public;

-- 신규 부착(0081a와 동일 패턴·멱등). 여전히 제외: attendance_checkins(키오스크 원시 핑)·onescreen_daily_sessions
-- (800ms 자동저장)·consultation_recordings(기계 파이프라인 — 상담 본체가 이미 로그됨)·timetable_snapshots(대형 blob)·
-- makeedu_*(시스템 동기화)·notifications(시스템 발신)·tenant_settings(id 없음 + audit_logs 커버).
do $$
declare
  t text;
  tables text[] := array[
    'attendance_records', 'lesson_reports', 'student_memos', 'classrooms',
    'textbook_catalog', 'tuition_catalog', 'tuition_quotes',
    'notice_popups', 'announcements', 'staff_leaves', 'payroll_records',
    'reenrollment_campaign_targets', 'english_levels', 'intake_tokens', 'kiosk_devices'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists tg_log_activity_id on public.%I', t);
      execute format('drop trigger if exists tg_log_activity_u on public.%I', t);
      execute format('create trigger tg_log_activity_id after insert or delete on public.%I for each row execute function public.log_activity()', t);
      execute format('create trigger tg_log_activity_u after update on public.%I for each row when (old.* is distinct from new.*) execute function public.log_activity()', t);
    end if;
  end loop;
end $$;
