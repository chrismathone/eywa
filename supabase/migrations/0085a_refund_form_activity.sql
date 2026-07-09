-- 0085a: 환불요청서 서식 내용을 활동 로그에 필드별로 노출(사용자 요청 2026-07-09). 멱등.
-- 배경: 환불요청서·이력서 등 폼 문서 내용은 academy_documents.form_data(jsonb) 한 컬럼에 통째로 들어가고,
--   0081a~0084a는 form_data를 redact(내용 미기록, "바뀜"만)했다 → "환불요청서 「홍길동」 수정"까지는 남지만
--   환불금액·차감내역 등 개별 필드 변경 이력이 안 남았다.
-- 결정: **환불요청서(form_type='refund_request')의 form_data만** redact 해제해 필드별 old→new를 기록.
--   이력서(staff_resume)·전사·급여(hourly_rate/monthly_base 등)·토큰 등 다른 민감 컬럼은 redact 유지(누수 방지).
--   ⚠️ 트레이드오프: 환불요청서의 계좌번호 등은 이제 사무실(master/admin/manager) 활동 로그에서 보인다(사용자 승인).
-- 표시(한글 필드명 매핑)는 앱(src/features/audit/activity.ts refundFormChanges + refund-request.ts refundFieldList)이 담당.
-- 0084a(activity_log 커버리지 확장) log_activity()를 create-or-replace로 교체 — noise/redact/target_label/트리거부착은
--   0084a와 동일하게 보존하고, redact 분기에 form_data(refund_request) 예외만 추가(트리거 재부착 불필요, 같은 함수 참조).

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

  if tg_op = 'UPDATE' then
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any(noise) then continue; end if;
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        if v_key = any(redact) then
          -- 환불요청서(form_type='refund_request')의 form_data만 필드별 변경 노출(사무실 요청, 2026-07-09).
          -- 이력서 등 다른 폼/전사/급여/토큰 민감 컬럼은 redact 유지.
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
    -- INSERT/DELETE: 스냅샷(노이즈·대형블롭 제거). form_data는 뷰어가 표시하지 않으므로(머리말만) 계속 제외 =
    --   계좌번호 등 민감 원문을 불필요하게 저장하지 않는다(UPDATE diff에서만 노출).
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
