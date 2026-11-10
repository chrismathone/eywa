-- s2_0062 — 신규 콜&상담 여정: 전화·방문·등록 확인 기록 + 변경 이력 (aywa-next 인계본 이식)
-- ✅ 운영 적용 2026-11-11(트랜잭션 ROLLBACK 검증 뒤 적용 · 표·정책 0개·함수·트리거 확인).
-- 인계본 원래 이름 20261103010359_enrollment_journey.sql.
-- 추정 날짜를 만들지 않고 옛 상담 행(enrollment_consultations)도 고치지 않는다 — 확인 근거가 있는 기록만 새 표에 쌓는다.
-- 서버 전용(정책 0개 · admin + tenant_id 필터 — s2_0028과 같은 규약). 상담 열람 범위는 앱이 사용자 클라이언트(RLS)로 먼저 확인한다.
-- 상담을 지우면(신규 콜&상담 삭제) 그 상담의 기록·이력도 함께 지운다(녹음·AI 분석과 같다). 병합은 앱이 지우기 전에 이긴 쪽 상담으로 옮긴다.
-- 🔴 한 번만 실행. 되돌리기: scripts/_oneoff/revert-s2_0062-enrollment-journey.sql
begin;
set local statement_timeout = '60s';

create table public.enrollment_journey_records (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  consultation_id uuid not null references public.enrollment_consultations(id) on delete cascade,
  version integer not null check (version > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  voided boolean not null default false,
  actor_id uuid not null references public.users(id),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index enrollment_journey_consult_idx on public.enrollment_journey_records (tenant_id, consultation_id, id);

create table public.enrollment_journey_revisions (
  record_id uuid not null references public.enrollment_journey_records(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version integer not null,
  document jsonb not null,
  voided boolean not null,
  actor_id uuid not null references public.users(id),
  reason text not null,
  recorded_at timestamptz not null default now(),
  primary key (record_id, version)
);
create index enrollment_journey_revision_tenant_idx on public.enrollment_journey_revisions (tenant_id, record_id, version);

alter table public.enrollment_journey_records enable row level security;
alter table public.enrollment_journey_revisions enable row level security;
revoke all on public.enrollment_journey_records, public.enrollment_journey_revisions from public, anon, authenticated;
grant select, insert, update on public.enrollment_journey_records to service_role;
grant select, insert on public.enrollment_journey_revisions to service_role;

-- 기록 + 이력 한 줄을 한 트랜잭션으로 · version 비교로 동시 수정 덮어쓰기를 막는다.
create function public.save_enrollment_journey(p_tenant uuid, p_actor uuid, p_consultation uuid, p_id uuid, p_expected integer, p_document jsonb, p_voided boolean, p_reason text)
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_version integer; v_day date := nullif(p_document->>'happenedOn','')::date;
v_planned date := nullif(p_document->>'scheduledOn','')::date;
v_done date := nullif(p_document->>'nextDoneOn','')::date;
v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- 담당자는 재직 중인 직원이어야 한다. 단 고칠 때 담당자를 그대로 두면 다시 묻지 않는다(퇴사한 담당자의 옛 기록도 결과 수정·집계 제외가 되게).
  if not exists (select 1 from public.users where id = p_actor and tenant_id = p_tenant and status = 'active')
    or not (exists (select 1 from public.users where id = (p_document->>'ownerId')::uuid and tenant_id = p_tenant and status = 'active'
        and system_role in ('master','admin','manager','teacher','counselor'))
      or (p_expected > 0 and exists (select 1 from public.enrollment_journey_records r where r.id = p_id and r.tenant_id = p_tenant
        and r.document->>'ownerId' = p_document->>'ownerId')))
    then raise exception '담당자 정보를 확인해 주세요'; end if;
  perform id from public.enrollment_consultations where id = p_consultation and tenant_id = p_tenant for share;
  if not found then raise exception '상담 연결을 확인해 주세요'; end if;
  if not coalesce((p_document->>'purpose') in ('new','returning','existing','unknown'), false)
    or not coalesce((p_document->>'kind' = 'call' and p_document->>'status' in ('connected','unanswered'))
    or (p_document->>'kind' = 'visit' and p_document->>'status' in ('scheduled','completed','no_show','cancelled'))
    or (p_document->>'kind' = 'registration' and p_document->>'status' in ('confirmed','cancelled')), false)
    or length(trim(coalesce(p_document->>'evidence',''))) < 2
    then raise exception '결과와 확인 근거를 입력해 주세요'; end if;
  if (p_document->>'status' = 'scheduled' and (v_planned is null or v_day is not null))
    or (p_document->>'status' <> 'scheduled' and v_day is null)
    or (p_document->>'kind' = 'visit' and p_document->>'status' in ('no_show','cancelled') and v_planned is null)
    or v_day > v_today or v_done > v_today
    or (p_document->>'status' = 'no_show' and v_day < v_planned)
    then raise exception '예정일과 실제 확인일을 확인해 주세요'; end if;
  if (nullif(p_document->>'nextAction','') is null) <> (nullif(p_document->>'nextDue','') is null)
    or (v_done is not null and nullif(p_document->>'nextAction','') is null)
    then raise exception '후속 업무와 기한을 함께 입력해 주세요'; end if;
  if p_expected > 0 and length(trim(coalesce(p_reason,''))) = 0 then raise exception '수정 사유를 입력해 주세요'; end if;
  if p_expected = 0 and not p_voided then
    insert into public.enrollment_journey_records (id, tenant_id, consultation_id, version, document, voided, actor_id)
    values (p_id, p_tenant, p_consultation, 1, p_document, false, p_actor)
    on conflict (id) do nothing returning version into v_version;
    -- 같은 요청이 두 번 온 것(이중 전송)이면 이미 저장된 첫 기록 그대로 성공으로 답한다 — 이력은 더 쌓지 않는다.
    if v_version is null and exists (select 1 from public.enrollment_journey_records r where r.id = p_id and r.tenant_id = p_tenant
        and r.consultation_id = p_consultation and r.version = 1 and r.document = p_document and not r.voided) then
      return 1;
    end if;
  elsif p_expected > 0 then
    update public.enrollment_journey_records set version = version + 1, document = p_document, voided = p_voided, actor_id = p_actor, updated_at = now()
    where id = p_id and tenant_id = p_tenant and consultation_id = p_consultation and version = p_expected returning version into v_version;
  end if;
  if v_version is null then raise exception using errcode = '40001', message = '다른 변경이 있습니다. 새로 불러와 주세요'; end if;
  insert into public.enrollment_journey_revisions (record_id, tenant_id, version, document, voided, actor_id, reason)
    values (p_id, p_tenant, v_version, p_document, p_voided, p_actor, coalesce(p_reason,''));
  return v_version;
end;
$$;
revoke all on function public.save_enrollment_journey(uuid,uuid,uuid,uuid,integer,jsonb,boolean,text) from public, anon, authenticated;
grant execute on function public.save_enrollment_journey(uuid,uuid,uuid,uuid,integer,jsonb,boolean,text) to service_role;

notify pgrst, 'reload schema';
commit;
