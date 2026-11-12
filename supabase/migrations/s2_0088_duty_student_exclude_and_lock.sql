-- s2_0088 — 업무 완성도: 학생 집계에서 담당 빼기 · 맞춤 잠금 6분 (2026-11-11 · Claude + Codex 합의)
--
-- 왜:
--   ① 원어민 담당 몫은 관리 화면에서 뺀다(원장 2026-11-11). 선생님 · 반 집계는 앱이 줄을 걸러 뺐지만, 학생 집계(`duty_rollup_student`)는 결과에 담당 칸이 없어
--      합친 뒤에는 뺄 수 없다 — 같은 학생의 숫자가 표마다 달랐다. 합치기 전에 빼야 한다.
--   ② 맞춤 잠금이 3분인데 크론은 최대 5분 돈다 — 긴 맞춤 도중 잠금이 풀려 두 번째 맞춤이 끼어들 수 있었다.
-- 무엇:
--   ① `duty_rollup_student_ex` — `duty_rollup_student`(s2_0076)와 같은 본문 + `p_exclude_owners uuid[]`(그 담당의 의무는 세지 않는다). 옛 함수는 그대로 둔다
--      (옛 앱이 부른다 — 앱이 다 넘어간 뒤 따로 치운다).
--   ② `duty_sync_claim` — 잠금 3분 → 6분. 그 밖은 s2_0077 본문 그대로.
-- 연동 역할 실행권 확인: 관리 화면 집계 · 장부 맞춤은 앱 service_role만 부른다 — 연동 PC 질의·RLS 정책이 지나지 않는다.
-- 되돌리기: ① 새 함수를 지운다(앱을 먼저 되돌린다) ② s2_0077의 duty_sync_claim 본문으로.
begin;

create or replace function public.duty_rollup_student_ex(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid, p_kind text, p_class uuid, p_subject text, p_student uuid, p_subject_none boolean, p_owner_none boolean, p_exclude_owners uuid[])
returns table (student_id uuid, class_id uuid, kind text, total bigint, done bigint, due bigint, ontime bigint, late_done bigint, open_late bigint, expired bigint, over7 bigint, last_due timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select r.student_id, r.class_id, r.kind, count(*), sum(r.f_done), sum(r.f_due), sum(r.f_ontime), sum(r.f_late_done), sum(r.f_open_late), sum(r.f_expired), sum(r.f_over7),
         max(r.due_at) filter (where r.f_open_late = 1 or r.f_expired = 1)
    from duties_private.rollup_rows(p_tenant, p_from, p_to, p_subjects, p_periods, p_owner) r
   where (p_kind is null or r.kind = p_kind)
     and (p_class is null or r.class_id = p_class)
     and (p_subject is null or r.subject = p_subject)
     and (not coalesce(p_subject_none, false) or r.subject is null)
     and (not coalesce(p_owner_none, false) or r.owner_id is null)
     and (p_student is null or r.student_id = p_student)
     and (p_exclude_owners is null or r.owner_id is null or not (r.owner_id = any(p_exclude_owners)))
   group by r.student_id, r.class_id, r.kind;
$fn$;

revoke all on function public.duty_rollup_student_ex(uuid, date, date, text[], text[], uuid, text, uuid, text, uuid, boolean, boolean, uuid[]) from public, anon, authenticated;
grant execute on function public.duty_rollup_student_ex(uuid, date, date, text[], text[], uuid, text, uuid, text, uuid, boolean, boolean, uuid[]) to service_role;

create or replace function public.duty_sync_claim(p_tenant uuid, p_force boolean default false, p_stale_minutes int default 30) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_now timestamptz := clock_timestamp();
  v_token uuid := gen_random_uuid();
  v_full boolean;
  v_days date[];
  v_monthly boolean;
  v_got uuid;
begin
  insert into public.duty_settings (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  select (s.last_sync_at is null or s.last_sync_at < v_now - make_interval(mins => p_stale_minutes)) into v_full from public.duty_settings s where s.tenant_id = p_tenant;
  if not p_force and not v_full and not exists (select 1 from public.duty_dirty d where d.tenant_id = p_tenant) then
    return jsonb_build_object('locked', false);
  end if;
  update public.duty_settings set sync_lock_until = v_now + interval '6 minutes', sync_token = v_token, updated_at = v_now
   where tenant_id = p_tenant and (sync_lock_until is null or sync_lock_until < v_now)
   returning tenant_id into v_got;
  if v_got is null then return jsonb_build_object('locked', false); end if;
  -- 지금 보이는(커밋된) 줄 전부에 증표를 단다 — 앞선 맞춤이 죽으며 남긴 줄도 함께 가져온다.
  update public.duty_dirty set claimed = v_token where tenant_id = p_tenant;
  select coalesce(array_agg(distinct d.day) filter (where d.scope = 'daily'), array[]::date[]), coalesce(bool_or(d.scope = 'monthly'), false)
    into v_days, v_monthly from public.duty_dirty d where d.tenant_id = p_tenant and d.claimed = v_token;
  return jsonb_build_object('locked', true, 'token', v_token, 'days', to_jsonb(v_days), 'monthly', v_monthly, 'full', v_full or p_force);
end;
$fn$;

commit;
