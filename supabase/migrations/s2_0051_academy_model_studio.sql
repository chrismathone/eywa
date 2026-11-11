-- s2_0051_academy_model_studio.sql — 스키마 스튜디오: 항목 정의·연결 점검 기준·근거 있는 참고 연결의 버전 기록 · 2026-11-11
-- ✅ 운영 적용 2026-11-11(거래 안 ROLLBACK 시험 뒤 적용 · 표·정책 0개·트리거 확인).
--
-- aywa-next(20261103070829_academy_model_studio.sql)에서 옮겼다. 화면 = /dashboard/management/knowledge('엑셀 뼈대·스키마' · '지식그래프' · '보완 점검').
-- 쌓기만 한다(수정·삭제 = 트리거가 거절). 🔴 읽기·쓰기 정책을 두지 않는다 — 서버(service_role)만 읽고 쓴다.
-- 바꾼 점(aywa-next 대비): 쓰는 사람을 DB가 '원장 역할'로 묶지 않는다 — main은 역할·권한 '경영 분석·지식그래프'(management) '전체'를
--    원장이 다른 역할에도 열 수 있어서, 앱 게이트(그 권한 '전체')가 판정하고 DB는 같은 지점의 재직 직원인지만 본다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0051-academy-model-studio.sql

create table public.academy_model_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  key text not null check (length(key) between 1 and 240),
  version integer not null check (version > 0),
  document jsonb not null check (jsonb_typeof(document)='object' and document->>'kind' in ('field','expectation','link')),
  actor_id uuid not null references public.users(id),
  recorded_at timestamptz not null default now(),
  unique (tenant_id,key,version)
);
alter table public.academy_model_versions enable row level security;
revoke all on public.academy_model_versions from public, anon, authenticated, service_role;
grant select,insert on public.academy_model_versions to service_role;

create function public.guard_academy_model_version() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare previous_version integer; previous_kind text;
begin
  if tg_op<>'INSERT' then raise exception '변경 이력은 새 버전으로 저장해 주세요'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||new.key,0));
  select version,document->>'kind' into previous_version,previous_kind
    from public.academy_model_versions where tenant_id=new.tenant_id and key=new.key order by version desc limit 1;
  if new.version<>coalesce(previous_version,0)+1 then raise exception 'model_version_conflict'; end if;
  if previous_kind is not null and previous_kind<>new.document->>'kind' then raise exception '기록 유형을 확인해 주세요'; end if;
  if not exists(select 1 from public.users where id=new.actor_id and tenant_id=new.tenant_id and status='active') then
    raise exception '모델을 수정할 권한을 확인해 주세요';
  end if;
  if new.document->>'kind'='link' and
    (new.document->>'from' not like new.tenant_id::text||':%' or new.document->>'to' not like new.tenant_id::text||':%' or new.document->>'from'=new.document->>'to') then
    raise exception '같은 학원의 서로 다른 기록을 연결해 주세요';
  end if;
  return new;
end $$;
revoke all on function public.guard_academy_model_version() from public,anon,authenticated;
grant execute on function public.guard_academy_model_version() to service_role;
create trigger academy_model_version_guard before insert or update or delete on public.academy_model_versions
for each row execute function public.guard_academy_model_version();

notify pgrst, 'reload schema';
