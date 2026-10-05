-- 0344c — 대사·반영 작업이 어느 케이스에 닿는가(1:N 연결의 단일 판정) + 참여·대사·작업의 읽기 범위
--
-- 대사 항목과 반영 작업은 케이스 하나에만 묶이지 않는다: 한 참여가 여러 케이스에 걸리고, 회차 단위 항목(강사 부재·시간표 충돌)은
-- 그 회차의 모든 학생·모든 케이스에 닿으며, 관측 실패는 그 학생·그날의 케이스 전부에 닿는다.
-- 🔴 목록의 주의 표시 · 상세 · 종결 차단 · 대사 목록의 범위 · 재확인 명령이 **같은 함수**를 쓴다 — 한 곳에서만 보이고
--    다른 곳에서 숨는 일이 없게.
--   닿는다 = 직접 연결(case_id) · case_ids 배열 · 그 케이스에 배정된 참여(participant_id · participant_ids).
--     참여가 적히지 않은 **회차 단위 항목**(강사 부재·시간표 충돌)만 그 회차의 모든 참여·케이스에 닿는다.
--     참여가 적힌 항목은 그 참여의 케이스에만 닿는다 — 같은 회차의 다른 학생 건을 막지도, 그 건에 보이지도 않는다.
--   *_case_ids = 같은 판정을 케이스 id 목록으로(잠글 대상 · 범위 판정에 쓴다 — 케이스 전체를 훑지 않는다).
--   이 함수들은 행위자를 보지 않는다(잠금·종결 차단용). 읽기 RPC가 내보낼 때는 visible_* 로 **행위자 범위만** 남긴다(0348h).
-- 참여의 읽기 범위(participant_in_scope) = 참여 명단 RPC · 반영 실패 기록 · 증거 조회가 함께 쓴다:
--   지점 전체 읽기 권한 · 내가 맡은 회차 · 지금 담당 반(출결 반/합류 반) · 지금 담당하는 같은 과목 반의 재원 학생.
-- 멱등: create or replace.

create or replace function makeup_private.recon_touches(r public.makeup_reconciliation, p_case uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select r.case_id = p_case
      or p_case = any (r.case_ids)
      or exists (select 1 from public.makeup_allocations al
                   join public.makeup_participants p on p.id = al.participant_id
                  where al.case_id = p_case
                    and (p.id = r.participant_id or (r.participant_id is null and p.session_id = r.session_id)))
$$;

create or replace function makeup_private.job_touches(j public.makeup_projection_jobs, p_case uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select j.case_id = p_case
      or p_case = any (j.case_ids)
      or exists (select 1 from public.makeup_allocations al
                  where al.case_id = p_case and (al.participant_id = j.participant_id or al.participant_id = any (j.participant_ids)))
$$;

create or replace function makeup_private.recon_case_ids(r public.makeup_reconciliation) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array(
    select x from (
      select r.case_id as x where r.case_id is not null
      union select unnest(r.case_ids)
      union select al.case_id from public.makeup_allocations al join public.makeup_participants p on p.id = al.participant_id
             where p.id = r.participant_id or (r.participant_id is null and r.session_id is not null and p.session_id = r.session_id)) q
    order by x), '{}'::uuid[])
$$;

create or replace function makeup_private.job_case_ids(j public.makeup_projection_jobs) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array(
    select x from (
      select j.case_id as x where j.case_id is not null
      union select unnest(j.case_ids)
      union select al.case_id from public.makeup_allocations al
             where al.participant_id = j.participant_id or al.participant_id = any (j.participant_ids)) q
    order by x), '{}'::uuid[])
$$;

create or replace function makeup_private.participant_in_scope(a makeup_private.actor_ctx, p_part uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.makeup_participants p join public.makeup_sessions s on s.id = p.session_id
     where p.id = p_part and p.tenant_id = a.tenant_id
       and (makeup_private.can_read_all(a) or s.teacher_id = a.user_id
            or coalesce(p.anchor_class_id, s.class_id) in (select makeup_private.my_class_ids(a.tenant_id, a.user_id, a.today))
            or makeup_private.teaches_student(a, p.student_id, p.subject_key)))
$$;

-- 대사 항목이 닿는 케이스 중 하나라도 행위자의 범위 안인가(강사 범위의 대사 목록). 어느 케이스에도 닿지 않는
-- 항목(지점 단위)은 지점 전체 읽기 권한만 본다.
create or replace function makeup_private.recon_in_scope(a makeup_private.actor_ctx, r public.makeup_reconciliation) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select makeup_private.can_read_all(a)
      or exists (select 1 from unnest(makeup_private.recon_case_ids(r)) c where makeup_private.in_scope(a, c))
      or (r.participant_id is not null and makeup_private.participant_in_scope(a, r.participant_id))
$$;

create or replace function makeup_private.job_in_scope(a makeup_private.actor_ctx, j public.makeup_projection_jobs) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select makeup_private.can_read_all(a)
      or exists (select 1 from unnest(makeup_private.job_case_ids(j)) c where makeup_private.in_scope(a, c))
      or exists (select 1 from unnest(j.participant_ids || j.participant_id) x
                  where x is not null and makeup_private.participant_in_scope(a, x))
$$;

-- 읽기 RPC가 밖으로 내보내는 id 배열은 행위자의 범위 안 것만 남긴다(같은 회차·같은 학생의 다른 건 번호가 새지 않게).
create or replace function makeup_private.visible_case_ids(a makeup_private.actor_ctx, p_ids uuid[]) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array(select c from unnest(p_ids) c
                         where c is not null and (makeup_private.can_read_all(a) or makeup_private.in_scope(a, c)) order by c), '{}'::uuid[])
$$;

create or replace function makeup_private.visible_participant_ids(a makeup_private.actor_ctx, p_ids uuid[]) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array(select x from unnest(p_ids) x
                         where x is not null and makeup_private.participant_in_scope(a, x) order by x), '{}'::uuid[])
$$;

-- 수납 정보를 읽을 수 있는 계정인가 — 기존 수납 메뉴의 읽기 판정(0158a `auth_billing_can_read`)을 그대로 쓴다.
create or replace function makeup_private.can_read_billing() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.auth_billing_can_read(), false)
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
