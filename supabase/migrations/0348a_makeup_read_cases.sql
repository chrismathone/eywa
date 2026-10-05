-- 0348a — 읽기 RPC 1/3: 보강 목록 public.makeup_list_cases
--
-- 새 표에는 직접 SELECT 권한이 없다(0343e) — 읽기 범위는 이 RPC들이 DB에서 강제한다.
--   · 지점 전체: full, 또는 강사가 아닌 readonly · 그 밖(강사·scoped): owner · 지금 담당 반 · 내가 맡은 회차의 건만.
--   · 목록 · 카드 숫자 · 총수는 **같은 행 집합·같은 조건식**에서 나온다(카드 숫자 = 그 카드로 거른 목록의 총수).
--     한 건에 주의 표시가 여러 개 붙을 수 있으므로 카드 숫자를 더해도 총수가 되지 않는다.
--   · 기간 상한이 없다 — 오래된 미처리 건도 숨기지 않는다. 결과는 jsonb 한 값이라 1000행 절단도 없다(페이지 ≤ 100행 + total).
-- 🔴 꺼짐(off)이면 예외로 실패한다 — 빈 목록으로 위장하지 않는다. 호출 실패를 0건으로 읽지 말 것.
-- p_filter: {tab: active(기본: 열림+보류) | open | on_hold | closed | all, flag, eligibility, subject_key, owner_id,
--            student_id, q(학생 이름), page(1부터), page_size(기본 50 · 최대 100)}
-- 반환: {mode, total, page, page_size, rows[], counts{…}, last_success_at}
-- 멱등: create or replace.

-- 범위 안의 케이스와 파생 값(주의 표시 · 다음 일정 · 다음 할 일). 목록과 카드가 같이 쓴다(p_only = 상세가 한 건만 읽을 때).
create or replace function makeup_private.case_rows(a makeup_private.actor_ctx, p_only uuid default null)
returns table (
  id uuid, revision integer, student_id uuid, student_name text, subject_key text, original_class_id uuid,
  original_class_name text, original_date date, reason text, eligibility text, lifecycle text, closure_reason text,
  target_minutes integer, outstanding_minutes integer, committed_minutes integer, reservable_minutes integer,
  owner_id uuid, owner_name text, due_date date, next_session_date date, next_action text, flags text[],
  imported_commitment boolean, updated_at timestamptz
) language sql stable security definer set search_path = public, pg_temp as $$
  with scoped as (
    select c.* from public.makeup_cases c
     where c.tenant_id = a.tenant_id and (p_only is null or c.id = p_only)
       and (makeup_private.can_read_all(a) or makeup_private.in_scope(a, c.id))
  ), facts as (
    select c.id,
      (select min(s.session_date) from public.makeup_allocations al
         join public.makeup_participants p on p.id = al.participant_id and p.status = 'unknown'
         join public.makeup_sessions s on s.id = p.session_id and s.state = 'confirmed'
        where al.case_id = c.id and s.session_date >= a.today) as next_session_date,
      -- 지난 회차인데 참여 미기록, 또는 왔는데 실시 기록을 아직 제출하지 않음.
      exists (select 1 from public.makeup_allocations al
                join public.makeup_participants p on p.id = al.participant_id
                left join public.makeup_fulfillments f on f.participant_id = p.id and f.state <> 'reversed'
               where al.case_id = c.id
                 and ((p.status = 'unknown' and p.session_date < a.today)
                      or (p.status in ('present', 'partial') and coalesce(f.state, 'draft') in ('draft', 'returned')))) as record_missing,
      exists (select 1 from public.makeup_allocations al
                join public.makeup_fulfillments f on f.participant_id = al.participant_id and f.state = 'submitted'
               where al.case_id = c.id) as review_pending,
      -- 열린 대사 · 미처리 반영 작업이 이 건에 닿는가(0344c — 회차 단위·1:N 연결까지. 종결 차단과 같은 판정).
      (exists (select 1 from public.makeup_reconciliation r
                where r.tenant_id = c.tenant_id and r.state = 'open' and makeup_private.recon_touches(r, c.id))
       or exists (select 1 from public.makeup_projection_jobs j
                   where j.tenant_id = c.tenant_id and j.state in ('pending', 'failed') and makeup_private.job_touches(j, c.id))) as recon_open
    from scoped c
  )
  select c.id, c.revision, c.student_id, st.name, c.subject_key, c.original_class_id, cl.class_name, c.original_date,
    c.reason, c.eligibility, c.lifecycle, c.closure_reason, c.target_minutes, c.outstanding_minutes, c.committed_minutes,
    c.outstanding_minutes - c.committed_minutes, c.owner_id, ow.display_name, c.due_date, f.next_session_date,
    case
      when c.lifecycle = 'closed' then 'none'
      when c.lifecycle = 'on_hold' then 'review_hold'
      when c.eligibility = 'pending' then 'review_eligibility'
      when c.owner_id is null then 'assign_owner'
      when f.record_missing then 'record'
      when f.review_pending then 'verify'
      when c.outstanding_minutes - c.committed_minutes > 0 then 'schedule'
      when c.committed_minutes > 0 then 'await_session'
      else 'close' end,
    array_remove(array[
      case when c.lifecycle <> 'closed' and c.eligibility = 'pending' then 'pending' end,
      case when c.lifecycle <> 'closed' and c.owner_id is null then 'unassigned' end,
      case when c.lifecycle = 'open' and c.eligibility = 'approved' and c.committed_minutes = 0
                and c.outstanding_minutes > 0 then 'unscheduled' end,
      case when c.lifecycle <> 'closed' and c.due_date between a.today and a.today + 7 then 'due_soon' end,
      case when c.lifecycle <> 'closed' and c.due_date < a.today then 'overdue' end,
      case when c.lifecycle <> 'closed' and f.record_missing then 'record_missing' end,
      case when c.lifecycle <> 'closed' and f.review_pending then 'review_pending' end,
      case when f.recon_open then 'recon_open' end,
      case when c.lifecycle = 'on_hold' and c.hold_review_at <= a.today then 'hold_review_due' end], null),
    c.imported_commitment, c.updated_at
  from scoped c
  join facts f on f.id = c.id
  join public.students st on st.id = c.student_id
  left join public.classes cl on cl.id = c.original_class_id
  left join public.users ow on ow.id = c.owner_id
$$;

create or replace function public.makeup_list_cases(p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx := makeup_private.actor();
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_tab text := coalesce(makeup_private.p_text(f, 'tab'), 'active');
  v_flag text := makeup_private.p_text(f, 'flag');
  v_elig text := makeup_private.p_text(f, 'eligibility');
  v_subject text := makeup_private.p_text(f, 'subject_key');
  v_owner uuid := makeup_private.p_uuid(f, 'owner_id');
  v_student uuid := makeup_private.p_uuid(f, 'student_id');
  v_q text := makeup_private.p_text(f, 'q');
  v_page integer := greatest(coalesce(makeup_private.p_int(f, 'page'), 1), 1);
  v_size integer := least(greatest(coalesce(makeup_private.p_int(f, 'page_size'), 50), 1), 100);
  v_out jsonb;
begin
  perform makeup_private.require_mode(a, 'read');
  if v_tab not in ('active', 'open', 'on_hold', 'closed', 'all') then
    perform makeup_private.fail('invalid', '목록 조건이 올바르지 않습니다');
  end if;
  with base as (
    -- 탭·주의 표시를 뺀 나머지 조건 — 카드 숫자와 목록이 이 집합을 같이 쓴다.
    select r.* from makeup_private.case_rows(a) r
     where (v_elig is null or r.eligibility = v_elig) and (v_subject is null or r.subject_key = v_subject)
       and (v_owner is null or r.owner_id = v_owner) and (v_student is null or r.student_id = v_student)
       and (v_q is null or r.student_name ilike '%' || replace(replace(v_q, '%', '\%'), '_', '\_') || '%')
  ), picked as (
    select b.* from base b
     where (v_tab = 'all' or (v_tab = 'active' and b.lifecycle <> 'closed') or b.lifecycle = v_tab)
       and (v_flag is null or v_flag = any (b.flags))
  ), page as (
    select p.* from picked p
     order by (p.lifecycle = 'closed'), p.due_date nulls last, p.updated_at desc, p.id
     offset (v_page - 1) * v_size limit v_size
  )
  select jsonb_build_object(
    'mode', a.mode, 'page', v_page, 'page_size', v_size, 'last_success_at', now(),
    'total', (select count(*) from picked),
    'rows', coalesce((select jsonb_agg(to_jsonb(p) order by (p.lifecycle = 'closed'), p.due_date nulls last, p.updated_at desc, p.id)
                        from page p), '[]'::jsonb),
    'counts', (select jsonb_build_object(
        'active', count(*) filter (where b.lifecycle <> 'closed'),
        'open', count(*) filter (where b.lifecycle = 'open'),
        'on_hold', count(*) filter (where b.lifecycle = 'on_hold'),
        'closed', count(*) filter (where b.lifecycle = 'closed'),
        'pending', count(*) filter (where 'pending' = any (b.flags)),
        'unassigned', count(*) filter (where 'unassigned' = any (b.flags)),
        'unscheduled', count(*) filter (where 'unscheduled' = any (b.flags)),
        'due_soon', count(*) filter (where 'due_soon' = any (b.flags)),
        'overdue', count(*) filter (where 'overdue' = any (b.flags)),
        'record_missing', count(*) filter (where 'record_missing' = any (b.flags)),
        'review_pending', count(*) filter (where 'review_pending' = any (b.flags)),
        'recon_open', count(*) filter (where 'recon_open' = any (b.flags) and b.lifecycle <> 'closed'),
        -- 닫힌 건에 뒤늦게 생긴 확인 항목(증거 변경 등) — 닫힌 탭에 숨지 않게 따로 센다.
        'closed_recon_open', count(*) filter (where 'recon_open' = any (b.flags) and b.lifecycle = 'closed'),
        'hold_review_due', count(*) filter (where 'hold_review_due' = any (b.flags))) from base b))
    into v_out;
  return v_out;
end;
$$;

revoke all on function public.makeup_list_cases(jsonb) from public, anon, service_role;
grant execute on function public.makeup_list_cases(jsonb) to authenticated;
revoke all on all functions in schema makeup_private from public, anon, authenticated;
notify pgrst, 'reload schema';
