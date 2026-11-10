-- s2_0066_academy_knowledge_records.sql — 현장 관찰·후속 조치·OKR·운영 보완 자료(학교 학생 수·재무상태·콘텐츠 성과·업무 시간) · 2026-11-11
--
-- aywa-next(20261102170801_academy_ontology_records.sql)에서 옮겼다. 화면 = /work-records/knowledge · 통합 지식그래프.
-- 기록은 버전을 쌓기만 한다(수정·삭제 = 트리거가 거절 · 보완은 새 버전). 작성자·유형은 처음 값에서 바뀌지 않는다.
-- 🔴 읽기·쓰기 정책을 두지 않는다 — 서버(service_role)만 읽고 쓴다. 권한은 앱(업무 작성센터 권한 · 검토 = 경영 분석·지식그래프 권한 '전체').
-- 되돌리기 = scripts/_oneoff/revert-s2_0066-academy-knowledge-records.sql
create table public.academy_knowledge_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  record_id uuid not null,
  version integer not null check(version > 0),
  author_id uuid not null references public.users(id),
  actor_id uuid not null references public.users(id),
  model_version text not null default 'aywa-ontology-2.0',
  document jsonb not null check(jsonb_typeof(document)='object' and document->>'kind' in ('observation','action','okr','population','balance','content','staffing')),
  recorded_at timestamptz not null default now(),
  unique(tenant_id,record_id,version)
);
create index academy_knowledge_student_idx on public.academy_knowledge_records(tenant_id,(document->>'studentId'),record_id,version desc);
create index academy_knowledge_author_idx on public.academy_knowledge_records(tenant_id,author_id,record_id,version desc);
alter table public.academy_knowledge_records enable row level security;
revoke all on public.academy_knowledge_records from public,anon,authenticated,service_role;
grant select,insert on public.academy_knowledge_records to service_role;
create function public.guard_academy_knowledge_record() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare prior public.academy_knowledge_records; sid uuid; uid uuid;
begin
  if TG_OP <> 'INSERT' then raise exception '기록은 새 버전으로 보완해 주세요'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||new.record_id::text,0));
  select * into prior from public.academy_knowledge_records where tenant_id=new.tenant_id and record_id=new.record_id order by version desc limit 1;
  if new.version<>coalesce(prior.version,0)+1 then raise exception 'knowledge_version_conflict'; end if;
  if prior.id is not null and (prior.author_id<>new.author_id or prior.document->>'kind'<>new.document->>'kind') then raise exception '기록자와 유형을 변경할 수 없습니다'; end if;
  if not exists(select 1 from public.users where id=new.author_id and tenant_id=new.tenant_id) or not exists(select 1 from public.users where id=new.actor_id and tenant_id=new.tenant_id) then raise exception '기록자 소속을 확인해 주세요'; end if;
  sid=nullif(new.document->>'studentId','')::uuid;
  if sid is not null and not exists(select 1 from public.students where id=sid and tenant_id=new.tenant_id and not coalesce(is_test,false)) then raise exception '대상 학생을 확인해 주세요'; end if;
  uid=nullif(new.document->>'ownerId','')::uuid;
  if uid is not null and not exists(select 1 from public.users where id=uid and tenant_id=new.tenant_id) then raise exception '담당자를 확인해 주세요'; end if;
  return new;
end $$;
revoke all on function public.guard_academy_knowledge_record() from public,anon,authenticated;
create trigger academy_knowledge_append_only before insert or update or delete on public.academy_knowledge_records for each row execute function public.guard_academy_knowledge_record();
comment on table public.academy_knowledge_records is 'Versioned native ontology observations/actions/OKRs/context. Server authorization and tenant scope required. No workbook example records.';

notify pgrst, 'reload schema';
