-- s2_0067_organization_okr.sql — 조직·OKR: 담당자 본인이 쓰는 목표·핵심결과·실행·날짜 있는 점검, 관리자의 피드백 · 2026-11-11
--
-- aywa-next(20261103042753_organization_okr.sql)에서 옮겼다. 화면 = /organization/okr(전엔 시안 · 예시 값).
-- 🔴 읽기·쓰기 정책을 두지 않는다 — 서버(service_role)만 읽고 쓴다. 권한(역할·권한 '조직·OKR' okr)은 앱이 가르고,
--    저장 함수가 담당자 본인·범위(조직·팀은 원장·관리자·매니저)·상위 목표 기간·버전을 한 번 더 지킨다. 모든 변경은 revisions에 남는다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0067-organization-okr.sql

create table public.organization_okr (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 owner_id uuid not null references public.users(id), parent_id uuid,
 version integer not null check(version>0), document jsonb not null,
 review jsonb, updated_at timestamptz not null default now(),
 unique(tenant_id,id), foreign key(tenant_id,parent_id) references public.organization_okr(tenant_id,id),
 check(jsonb_typeof(document)='object'), check(id is distinct from parent_id)
);
create index organization_okr_owner_idx on public.organization_okr(tenant_id,owner_id,id);
create index organization_okr_parent_idx on public.organization_okr(tenant_id,parent_id);
create table public.organization_okr_revisions (
 record_id uuid not null references public.organization_okr(id),tenant_id uuid not null references public.tenants(id),
 version integer not null, actor_id uuid not null references public.users(id), action text not null,
 document jsonb not null, review jsonb, recorded_at timestamptz not null default now(),primary key(record_id,version)
);
create index organization_okr_revisions_tenant_idx on public.organization_okr_revisions(tenant_id,record_id,version);
alter table public.organization_okr enable row level security;
alter table public.organization_okr_revisions enable row level security;
revoke all on public.organization_okr,public.organization_okr_revisions from public,anon,authenticated;
grant select,insert,update on public.organization_okr to service_role;
grant select,insert on public.organization_okr_revisions to service_role;

create function public.save_organization_okr(p_tenant uuid,p_actor uuid,p_id uuid,p_expected integer,p_action text,p_document jsonb,p_note text,p_verdict text)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare old public.organization_okr; par public.organization_okr; v_role text; v_version integer; v_doc jsonb; v_review jsonb; v_parent uuid; v_scope text;
begin
 select system_role::text into v_role from public.users where id=p_actor and tenant_id=p_tenant and status='active';
 if v_role is null or v_role not in ('master','admin','manager','teacher','counselor','accountant') then raise exception '작성 권한을 확인해 주세요'; end if;
 -- Serializes only this tenant's OKR writes, including parent period/closing checks.
 perform pg_advisory_xact_lock(hashtextextended('organization_okr:'||p_tenant::text,0));
 select * into old from public.organization_okr where id=p_id and tenant_id=p_tenant for update;
 if (old.id is null and p_expected<>0) or (old.id is not null and old.version<>p_expected) then raise exception using errcode='40001',message='다른 변경이 있습니다. 새로 불러와 주세요'; end if;
 if p_action='review' then
   if old.id is null or old.owner_id=p_actor or v_role not in ('master','admin','manager') or length(trim(coalesce(p_note,'')))<2 or p_verdict not in ('acknowledged','revise','support') then raise exception '다른 담당자의 목표에 피드백을 작성해 주세요'; end if;
   v_doc:=old.document;v_parent:=old.parent_id;
   v_review:=jsonb_build_object('note',p_note,'verdict',p_verdict,'reviewerId',p_actor,'at',now(),'version',old.version);
 elsif p_action='save' then
   v_doc:=p_document; v_scope:=v_doc->>'scope'; v_parent:=nullif(v_doc->>'parentId','')::uuid;v_review:=old.review;
   if (v_doc->>'ownerId')::uuid is distinct from p_actor or (old.id is not null and (old.owner_id<>p_actor or v_scope<>old.document->>'scope')) then raise exception '담당자 본인만 목표를 작성할 수 있습니다'; end if;
   if v_scope is null or v_scope not in ('organization','team','individual') or (v_scope<>'individual' and v_role not in ('master','admin','manager')) then raise exception '목표 범위를 확인해 주세요'; end if;
   if v_doc->>'from' is null or v_doc->>'through' is null or (v_doc->>'from')::date > (v_doc->>'through')::date or coalesce(jsonb_array_length(v_doc->'krs'),0) not between 1 and 8 or coalesce(v_doc->>'state','') not in ('draft','active','closed','archived') then raise exception '목표 기간과 핵심결과를 확인해 주세요'; end if;
   if v_parent is not null then
     select * into par from public.organization_okr where tenant_id=p_tenant and id=v_parent;
     if par.id is null or par.document->>'state'<>'active' or v_scope='organization' or (v_scope='team' and par.document->>'scope'<>'organization') or par.document->>'scope'='individual' or (v_doc->>'from')::date<(par.document->>'from')::date or (v_doc->>'through')::date>(par.document->>'through')::date then raise exception '상위 목표와 기간을 확인해 주세요'; end if;
   end if;
   if exists(select 1 from public.organization_okr c where c.tenant_id=p_tenant and c.parent_id=p_id and c.document->>'state' not in ('closed','archived') and (v_doc->>'state'<>'active' or (c.document->>'from')::date<(v_doc->>'from')::date or (c.document->>'through')::date>(v_doc->>'through')::date)) then raise exception '하위 목표가 진행 중입니다. 먼저 하위 목표를 점검해 주세요'; end if;
 else raise exception '요청을 확인해 주세요'; end if;
 if old.id is null then
   insert into public.organization_okr(id,tenant_id,owner_id,parent_id,version,document) values(p_id,p_tenant,p_actor,v_parent,1,v_doc) returning version into v_version;
 else
   update public.organization_okr set version=version+1,document=v_doc,parent_id=v_parent,review=v_review,updated_at=now() where id=p_id and tenant_id=p_tenant returning version into v_version;
 end if;
 insert into public.organization_okr_revisions(record_id,tenant_id,version,actor_id,action,document,review) values(p_id,p_tenant,v_version,p_actor,p_action,v_doc,v_review);
 return v_version;
end;
$$;
revoke all on function public.save_organization_okr(uuid,uuid,uuid,integer,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.save_organization_okr(uuid,uuid,uuid,integer,text,jsonb,text,text) to service_role;
notify pgrst,'reload schema';
