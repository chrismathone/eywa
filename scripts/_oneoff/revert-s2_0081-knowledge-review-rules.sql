-- s2_0081 되돌리기 — 관찰 기록 트리거 함수를 s2_0066 원래 모양으로 돌리고(자기 확인·검토자 본문 수정 제한이 풀린다) 최신 버전 조회 함수를 뺀다.
-- 🔴 적용 SQL이 아니다. 앱을 s2_0081 이전 판으로 되돌린 **뒤에만**(새 앱은 academy_knowledge_latest를 부른다), 원장 승인 뒤 손으로 실행한다.
begin;
create or replace function public.guard_academy_knowledge_record() returns trigger language plpgsql set search_path=public,pg_temp as $$
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
drop function if exists public.academy_knowledge_latest(uuid, uuid, uuid);
commit;
notify pgrst, 'reload schema';
