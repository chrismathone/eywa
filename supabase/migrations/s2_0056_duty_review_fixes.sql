-- s2_0056 — 업무 완성도: 종합 리뷰 반영 — 변경 기록 트리거를 가볍게 · 맞춤 실패 물러서기 · 지난 달 월간 의무 확정 · 자기 업무 면제 금지 (2026-11-11)
--
-- 왜(종합 적대적 리뷰 2026-11-11 — 조각이 합쳐진 뒤의 결함):
--   ① `mark_dirty`(s2_0054)의 2초 신호 판정이 "가져가는 쪽이 없으면 더 적지 않는다" 규칙과 만나 뒤집혔다 — 새 줄이 안 생기면 '최근 2초 안에 적힌 줄'이 늘 없어서
--      **저장 한 줄마다 신호**를 보냈다(앱이 아직 운영에 없어 가져가는 쪽이 없는 지금이 바로 그 상태).
--   ② 줄 단위 트리거가 여러 줄을 한 번에 쓸 때 줄마다 쓰기(서브트랜잭션) · 같은 날 줄을 전부 훑는 검사 · 긴 본문까지 jsonb로 바꾸는 비용을 냈다.
--   ③ 맞춤이 계속 실패하면 화면 요청마다 전체 맞춤을 다시 시도했다.
--   ④ 달이 바뀐 뒤 지난 달의 열린 월간 의무(학생 상담 · 월말평가)는 닫히지도 확정되지도 않아 '7일 이상 지연'과 할 일이 영영 남는다(그 달 안의 기록만 인정하므로 더는 채울 수 없다).
--   ⑤ 전체 권한인 과목 관리자가 자기 반의 지연을 스스로 면제해 등급을 올릴 수 있었다.
-- 무엇:
--   · `mark_dirty` — **한 거래에서 같은 (묶음 · 지점 · 날)은 한 번만** 일한다(거래 안 메모 `duties.dirty_seen` — 나머지 줄은 글자 비교뿐 · 쓰기 없음).
--     신호는 **줄을 실제로 적었고 직전 2초에 적힌 줄이 없을 때만**. 가져가지 않은 줄이 10분 넘게 남아 있으면 더 적지 않는다(종전 1시간 — 가져가는 쪽이 없는 동안 표가 자라지 않게).
--   · 트리거는 **의무 판정에 쓰는 칸이 바뀔 때만** 돈다(`update of …`) — 보고서 본문 자동 저장 · 출결 메모 수정은 트리거를 지나지 않는다.
--   · `duty_sync_finish` — 실패로 끝나면 60초 동안 잠금을 쥔 채 둔다(실패하는 맞춤을 화면마다 곧바로 다시 돌리지 않는다). 그 밖은 s2_0054 본문 그대로.
--   · `duty_escalate` — 기한 뒤 7일이 지난 열린 의무의 미이행 확정을 **월간에도**(말일 + 7일). 건별(신규생 관리)은 종전대로 열린 채 지연. 그 밖은 s2_0050 본문 그대로.
--     (s2_0044가 '일간만'으로 좁힌 까닭은 신규생 관리가 곧바로 확정되던 것 — 월간은 그 달이 끝나고 한 주 뒤면 더는 채울 수 없다. 앱 크론이 다음 달 첫 7일 동안 지난 달을 한 번 더 맞춘다.)
--   · `duty_note_add` — 본인 담당 의무는 면제할 수 없다(확인 · 사유는 된다). 그 밖은 s2_0052 본문 그대로.
-- 되돌리기: mark_dirty · 트리거 · duty_sync_finish는 s2_0054, duty_escalate는 s2_0050, duty_note_add는 s2_0052 본문으로.
begin;

create or replace function duties_private.mark_dirty() returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_rows jsonb[] := array[]::jsonb[];
  v_row jsonb;
  v_val text;
  v_day date;
  v_tenant uuid;
  v_key text;
  v_seen text;
  v_recent boolean;
  v_n int;
  i int;
begin
  begin
    if tg_op <> 'DELETE' then v_rows := v_rows || to_jsonb(new); end if;
    if tg_op <> 'INSERT' then v_rows := v_rows || to_jsonb(old); end if;
    foreach v_row in array v_rows loop
      if v_row->>'tenant_id' is null then continue; end if;
      v_tenant := (v_row->>'tenant_id')::uuid;
      for i in 1 .. tg_nargs - 1 loop
        if tg_argv[i] = 'now' then v_day := (now() at time zone 'Asia/Seoul')::date;
        else
          v_val := v_row->>tg_argv[i];
          if v_val is null then continue; end if;
          v_day := case when length(v_val) = 10 then v_val::date else (v_val::timestamptz at time zone 'Asia/Seoul')::date end;
        end if;
        if tg_argv[0] = 'monthly' then v_day := date_trunc('month', v_day)::date; end if;
        -- 이 거래에서 이미 적은 (묶음 · 지점 · 날)이면 아무것도 하지 않는다 — 여러 줄을 한 번에 쓰는 저장이 줄마다 쓰기를 내지 않게.
        v_key := tg_argv[0] || '|' || v_tenant::text || '|' || v_day::text || ',';
        v_seen := coalesce(current_setting('duties.dirty_seen', true), '');
        if position(v_key in v_seen) > 0 then continue; end if;
        perform set_config('duties.dirty_seen', v_seen || v_key, true);
        v_recent := exists (select 1 from public.duty_dirty d
                             where d.tenant_id = v_tenant and d.scope = tg_argv[0] and d.day = v_day
                               and d.created_at > clock_timestamp() - interval '2 seconds');
        insert into public.duty_dirty (tenant_id, scope, day)
        select v_tenant, tg_argv[0], v_day
         where not exists (select 1 from public.duty_dirty d
                            where d.tenant_id = v_tenant and d.scope = tg_argv[0] and d.day = v_day
                              and d.claimed is null -- 가져간 줄은 곧 지워진다 — 그 줄을 믿고 건너뛰면 맞추는 도중의 저장이 묻힌다
                              and d.created_at < clock_timestamp() - interval '10 minutes');
        get diagnostics v_n = row_count;
        -- 신호는 줄을 실제로 적었을 때만(가져가는 쪽이 없어 건너뛴 저장은 알릴 화면도 없다) · 같은 날은 2초에 한 번.
        if v_n > 0 and not v_recent then
          begin
            perform realtime.send(jsonb_build_object('scope', tg_argv[0]), 'changed', 'duties:' || v_tenant::text, false);
          exception when others then null;
          end;
        end if;
      end loop;
    end loop;
  exception when others then
    null; -- 저장을 막지 않는다 — 놓친 변경은 크론이 맞춘다.
  end;
  return null;
end;
$fn$;
revoke all on function duties_private.mark_dirty() from public, anon, authenticated;

drop trigger if exists trg_duty_dirty on public.attendance_records;
create trigger trg_duty_dirty after insert or delete or update of session_date, status, student_id, class_id on public.attendance_records for each row execute function duties_private.mark_dirty('daily', 'session_date');
drop trigger if exists trg_duty_dirty on public.lesson_reports;
create trigger trg_duty_dirty after insert or delete or update of report_date, covers_date, classnote_status, classnote_sent_at, revoked_at, student_id, class_id, makeup_class_id on public.lesson_reports for each row execute function duties_private.mark_dirty('daily', 'report_date', 'covers_date');
drop trigger if exists trg_duty_dirty on public.classnote_class_posts;
create trigger trg_duty_dirty after insert or delete or update of posted_on, board_name, post_count on public.classnote_class_posts for each row execute function duties_private.mark_dirty('daily', 'posted_on');
drop trigger if exists trg_duty_dirty on public.student_consultations;
create trigger trg_duty_dirty after insert or delete or update of consulted_at, counselor_id, student_id, processing_status on public.student_consultations for each row execute function duties_private.mark_dirty('monthly', 'consulted_at');
drop trigger if exists trg_duty_dirty on public.student_onboarding_checks;
create trigger trg_duty_dirty after insert or delete or update of done_on, item_key, student_id, subject on public.student_onboarding_checks for each row execute function duties_private.mark_dirty('monthly', 'now');
drop trigger if exists trg_duty_dirty on public.student_grades;
create trigger trg_duty_dirty after insert or delete or update of taken_on, student_id, subject, exam_slot, exam_name, no_exam on public.student_grades for each row execute function duties_private.mark_dirty('monthly', 'taken_on');

create or replace function public.duty_sync_finish(p_tenant uuid, p_token uuid, p_ok boolean, p_full boolean) returns boolean
language plpgsql security definer set search_path = public
as $fn$
declare
  v_got uuid;
  v_n int := 0;
begin
  -- 실패면 잠금을 60초 더 쥔다(증표는 비운다) — 실패하는 맞춤을 열린 화면마다 곧바로 다시 돌리지 않는다.
  update public.duty_settings set sync_lock_until = case when p_ok then null else now() + interval '60 seconds' end, sync_token = null,
         last_sync_at = case when p_ok and p_full then now() else last_sync_at end, updated_at = now()
   where tenant_id = p_tenant and sync_token = p_token
   returning tenant_id into v_got;
  if v_got is null then return false; end if;
  if p_ok then
    delete from public.duty_dirty where tenant_id = p_tenant and claimed = p_token;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      begin
        perform realtime.send(jsonb_build_object('scope', 'synced'), 'changed', 'duties:' || p_tenant::text, false);
      exception when others then null;
      end;
    end if;
  else update public.duty_dirty set claimed = null where tenant_id = p_tenant and claimed = p_token;
  end if;
  return true;
end;
$fn$;

create or replace function public.duty_escalate(p_tenant uuid, p_manager_days int default 3, p_owner_days int default 7, p_expire_days int default 7) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_now timestamptz := now();
  v_opened int := 0;
  v_closed int := 0;
  v_task uuid;
  g record;
  v_body text;
  v_title text;
  v_english boolean;
  v_active boolean;
  v_on boolean := false;
  v_live timestamptz := '-infinity';
begin
  select coalesce(s.late_tasks_on, false), coalesce(s.live_from, '-infinity'::timestamptz) into v_on, v_live from public.duty_settings s where s.tenant_id = p_tenant;
  v_on := coalesce(v_on, false); v_live := coalesce(v_live, '-infinity'::timestamptz);

  update public.duty_items set status = 'void', void_reason = 'expired', updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and period in ('daily', 'monthly') and due_at + make_interval(days => p_expire_days) < v_now;

  update public.duty_items set escalation = 1, escalated_at = coalesce(escalated_at, v_now), updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 1 and due_at < v_now;
  update public.duty_items set escalation = 2, updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 2 and due_at + make_interval(days => p_manager_days) < v_now;
  update public.duty_items set escalation = 3, updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 3 and due_at + make_interval(days => p_owner_days) < v_now;

  if v_on then
    for g in
      select d.owner_id, d.kind, d.period, (case when d.period = 'case' then '' else d.cycle end) as grp_cycle,
             count(*) as n, min(d.due_at) as first_due,
             md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || (case when d.period = 'case' then '' else d.cycle end))::uuid as subject,
             array_agg(d.id) as ids
        from public.duty_items d
       where d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now and d.due_at >= v_live
       group by d.owner_id, d.kind, d.period, (case when d.period = 'case' then '' else d.cycle end)
    loop
      -- 본문: 학생마다 한 줄. 건별은 "이름 — 항목 · 항목", 그 밖은 "이름 · 반".
      select string_agg(line, chr(10) order by line) into v_body from (
        select st.name || case when g.period = 'case'
                                 then ' — ' || string_agg(duties_private.cycle_label(d.kind, d.cycle), ' · ' order by d.due_at)
                                 else coalesce(' · ' || min(c.class_name), '') end as line
          from public.duty_items d join public.students st on st.id = d.student_id left join public.classes c on c.id = d.class_id
         where d.id = any(g.ids)
         group by st.id, st.name
      ) lines;
      select bool_or(d.subject = 'english') into v_english from public.duty_items d where d.id = any(g.ids);
      select exists (select 1 from public.users u where u.id = g.owner_id and u.tenant_id = p_tenant and u.status = 'active') into v_active;
      v_title := duties_private.kind_label(g.kind) || ' 기한 초과 ' || g.n || '건'
        || case when g.period = 'daily' then ' · ' || to_char(g.grp_cycle::date, 'MM/DD') when g.period = 'monthly' then ' · ' || g.grp_cycle else '' end;
      v_task := staff_tasks_private.open_task(
        p_tenant, 'duty_late', g.subject, '',
        v_title,
        left(coalesce(v_body, ''), 1200),
        case when g.kind in ('attendance', 'report_write', 'report_send', 'video_check') then (case when coalesce(v_english, false) then '/ecs' else '/onescreen' end)
             when g.kind in ('counsel_monthly', 'newcomer_call') then '/consultations/new'
             when g.kind = 'exam_monthly' then '/exams/input' else null end,
        g.first_due + interval '1 day',
        case when g.owner_id is null or not v_active then staff_tasks_private.master_ids(p_tenant) else array[g.owner_id] end,
        null);
      update public.duty_items set task_id = v_task, updated_at = v_now where id = any(g.ids) and task_id is distinct from v_task;
      v_opened := v_opened + 1;
    end loop;
  end if;

  for g in
    select t.id, t.subject_id,
           exists (select 1 from public.duty_items d where d.task_id = t.id and d.status = 'done') as any_done,
           exists (select 1 from public.duty_items d where d.task_id = t.id and d.void_reason = 'expired') as any_expired
      from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'duty_late' and t.status = 'open'
       and not exists (
         select 1 from public.duty_items d
          where v_on and d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now and d.due_at >= v_live
            and md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || (case when d.period = 'case' then '' else d.cycle end))::uuid = t.subject_id)
  loop
    v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'duty_late', g.subject_id, '',
      case when not v_on then 'cancelled' when g.any_done then 'done' when g.any_expired then 'expired' else 'cancelled' end,
      case when not v_on then 'late_tasks_off' when g.any_done then 'duties_resolved' when g.any_expired then 'duties_expired' else 'duties_moved_or_void' end, null);
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

create or replace function public.duty_note_add(p_tenant uuid, p_ids uuid[], p_action text, p_note text, p_actor uuid, p_subjects text[]) returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  v_ids uuid[];
  v_note text := btrim(coalesce(p_note, ''));
  v_n int;
begin
  if p_action not in ('ack', 'reason', 'waive') then raise exception '알 수 없는 처리입니다.'; end if;
  if p_action in ('reason', 'waive') and v_note = '' then raise exception '사유를 적어 주세요.'; end if;
  if char_length(v_note) > 500 then raise exception '사유는 500자까지 적을 수 있습니다.'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_ids, '{}')) x;
  if v_ids is null or cardinality(v_ids) > 500 then raise exception '한 번에 처리할 수 있는 항목은 1~500건입니다.'; end if;
  -- 대상을 잠근 채 센다 — 범위 밖 · 이미 끝난 것이 하나라도 섞이면 아무것도 하지 않는다(화면이 낡았다).
  select count(*) into v_n from (
    select 1 from public.duty_items d
     where d.tenant_id = p_tenant and d.id = any(v_ids)
       and (p_subjects is null or d.subject = any(p_subjects))
       and (d.status = 'open' or (d.status = 'void' and d.void_reason = 'expired'))
     for update) t;
  if v_n <> cardinality(v_ids) then raise exception '이미 처리됐거나 볼 수 없는 항목이 섞여 있습니다. 화면을 새로 고친 뒤 다시 해 주세요.'; end if;
  -- 자기 업무는 스스로 면제하지 못한다(면제는 집계에서 그 의무를 지운다 — 자기 지연을 지워 등급을 올리는 길을 막는다). 확인 · 사유는 남길 수 있다.
  if p_action = 'waive' and exists (select 1 from public.duty_items d where d.tenant_id = p_tenant and d.id = any(v_ids) and d.owner_id = p_actor) then
    raise exception '본인 담당 업무는 면제할 수 없습니다. 다른 관리자에게 요청해 주세요.';
  end if;
  insert into public.duty_notes (tenant_id, duty_id, action, note, actor_id)
  select p_tenant, x, p_action, v_note, (select u.id from public.users u where u.id = p_actor and u.tenant_id = p_tenant) from unnest(v_ids) x;
  if p_action = 'waive' then
    update public.duty_items set status = 'void', void_reason = 'waived', task_id = null, updated_at = now()
     where tenant_id = p_tenant and id = any(v_ids);
  end if;
  return v_n;
end;
$fn$;

commit;
