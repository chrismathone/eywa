-- s2_0065_work_records.sql — 업무 작성센터: 내 계정으로 쓰는 업무 서식(주간 업무보고·기획안·연수·인수인계·개선 제안·일반) · 2026-11-11
-- ✅ 운영 적용 2026-11-11(거래 안 ROLLBACK 시험 뒤 적용 · 표·정책 0개·함수 실행권 확인).
--
-- aywa-next(20261102083644_native_work_records.sql)에서 옮겼다. 화면 = /work-records(전엔 시안 · 예시 값).
-- 🔴 읽기·쓰기 정책을 두지 않는다 — 서버(service_role)만 읽고 쓴다(s2_0027과 같은 규약: admin 클라이언트 + tenant_id 필터).
--    권한(역할·권한 '업무 작성센터' work_records · 검토 = 원장·관리자·매니저 + 그 권한 '전체')은 앱이 가르고,
--    저장 함수가 작성자 본인·검토 규칙·버전·같은 요청 재시도를 한 번 더 지킨다.
-- 바꾼 점(aywa-next 대비): ① 확인 완료 문서는 작성자가 다시 고치지 못한다(검토자가 본 적 없는 본문에 확인 의견이 남지 않게)
--    ② 본인 문서는 본인이 확인하지 못한다(조직·OKR과 같은 규칙) ③ 문서 크기 한도 40,000 → 64,000바이트(한글 3바이트 — 앱 한도 15,700자가 다 들어가게).
-- 되돌리기 = scripts/_oneoff/revert-s2_0065-work-records.sql
create table public.academy_work_records (
  id uuid primary key,tenant_id uuid not null references public.tenants(id),author_id uuid not null references public.users(id),
  version integer not null default 1,document jsonb not null,updated_at timestamptz not null default now(),created_at timestamptz not null default now(),
  check(version>0),check(document->>'state' in ('draft','submitted','reviewed','cancelled'))
);
create index academy_work_records_tenant_author on public.academy_work_records(tenant_id,author_id,updated_at desc);
create table public.academy_work_record_events (
  request_id uuid primary key,tenant_id uuid not null references public.tenants(id),record_id uuid not null references public.academy_work_records(id),actor_id uuid not null references public.users(id),version integer not null,document jsonb not null,request jsonb not null,created_at timestamptz not null default now()
);
alter table public.academy_work_records enable row level security;
alter table public.academy_work_record_events enable row level security;
revoke all on public.academy_work_records,public.academy_work_record_events from anon,authenticated;
grant select,insert,update on public.academy_work_records to service_role;
grant select,insert on public.academy_work_record_events to service_role;
create function public.save_academy_work_record(p_tenant uuid,p_actor uuid,p_request uuid,p_id uuid,p_expected integer,p_review boolean,p_document jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.academy_work_records; prior public.academy_work_record_events; role_name text; n integer; payload jsonb;
begin
  select system_role into role_name from public.users where id=p_actor and tenant_id=p_tenant and status='active';
  if role_name is null or role_name not in ('master','admin','manager','teacher','counselor','accountant') then raise exception 'access_denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  payload:=jsonb_build_object('id',p_id,'expected',p_expected,'review',p_review,'document',p_document);
  select * into prior from public.academy_work_record_events where request_id=p_request;
  if prior.request_id is not null then
    if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.request<>payload then raise exception 'request_conflict'; end if;
    return jsonb_build_object('id',p_id,'version',prior.version);
  end if;
  select * into old from public.academy_work_records where id=p_id for update;
  if old.id is not null and old.tenant_id<>p_tenant then raise exception 'access_denied'; end if;
  if coalesce(old.version,0)<>p_expected then raise exception 'version_conflict'; end if;
  if p_review then
    if role_name not in ('master','admin','manager') or old.id is null or old.author_id=p_actor or old.document->>'state'<>'submitted' or p_document->>'state' not in ('reviewed','draft') or coalesce(length(trim(p_document->>'reviewNote')),0)<1 or (old.document-'state'-'reviewNote')<>(p_document-'state'-'reviewNote') then raise exception 'access_denied'; end if;
  else
    if (old.id is not null and (old.author_id<>p_actor or old.document->>'state'='reviewed')) or p_document->>'state' not in ('draft','submitted','cancelled') or coalesce(p_document->>'reviewNote','')<>coalesce(old.document->>'reviewNote','') then raise exception 'access_denied'; end if;
    if old.id is not null and old.document->>'template'<>p_document->>'template' then raise exception 'invalid_document'; end if;
  end if;
  if coalesce(length(trim(p_document->>'title')),0)<2 or octet_length(p_document::text)>64000 then raise exception 'invalid_document'; end if;
  if p_document->>'state'='submitted' and (coalesce(length(trim(p_document->>'plan')),0)=0 or coalesce(length(trim(p_document->>'action')),0)=0 or coalesce(length(trim(p_document->>'result')),0)=0) then raise exception 'invalid_document'; end if;
  n:=p_expected+1;
  insert into public.academy_work_records(id,tenant_id,author_id,version,document) values(p_id,p_tenant,p_actor,n,p_document)
    on conflict(id) do update set document=excluded.document,version=excluded.version,updated_at=now();
  insert into public.academy_work_record_events(request_id,tenant_id,record_id,actor_id,version,document,request) values(p_request,p_tenant,p_id,p_actor,n,p_document,payload);
  return jsonb_build_object('id',p_id,'version',n);
end; $$;
revoke all on function public.save_academy_work_record(uuid,uuid,uuid,uuid,integer,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.save_academy_work_record(uuid,uuid,uuid,uuid,integer,boolean,jsonb) to service_role;

notify pgrst, 'reload schema';
