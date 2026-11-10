-- s2_0081_knowledge_review_rules.sql — 관찰 기록: 본인 관찰의 자기 확인 금지 · 검토자는 상태·검토 의견만 + 최신 버전 조회 함수 · 2026-11-11
-- ✅ 운영 적용 2026-11-11(거래 안 ROLLBACK 시험 뒤 적용 · 자기 확인·검토자 본문 수정 거절과 최신 버전 조회 확인).
--
-- 원장 승인(Claude·Codex 합의안 B-5·B-6): 업무 문서·조직 OKR과 같은 규칙을 관찰에도.
--  ① 관찰을 쓴 본인은 그 관찰을 '확인됨'으로 저장하지 못한다 — 검토 권한이 있어도 '검토 요청'까지만(원장 역할 예외 없음).
--  ② 검토자(작성자가 아닌 사람)는 남의 관찰 본문을 못 고친다 — 상태(state)와 검토 의견(reviewNote)만 바꾼다.
--  ③ 검토 의견은 검토자만 적는다(작성자가 자기 관찰의 검토 의견을 바꾸지 못한다).
-- 앱 = src/features/academy-knowledge/records.ts validateTransition(같은 규칙 · 한글 안내) — DB는 마지막 방어선.
-- s2_0066의 트리거 함수를 같은 이름으로 다시 정의한다(트리거는 그대로 · 기존 검사 전부 유지 + 위 세 가지).
-- + academy_knowledge_latest: 기록마다 최신 버전 한 줄만 돌려준다(화면이 모든 버전을 읽어 내려보내던 것 → 이력은 열 때 따로 읽는다).
-- 되돌리기 = scripts/_oneoff/revert-s2_0081-knowledge-review-rules.sql
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
  if new.document->>'kind'='observation' then
    if new.actor_id=new.author_id then
      if new.document->>'state'='confirmed' then raise exception '본인 관찰은 다른 검토자가 확인합니다'; end if;
      if coalesce(new.document->>'reviewNote','')<>coalesce(prior.document->>'reviewNote','') then raise exception '검토 의견은 검토자가 작성합니다'; end if;
    elsif prior.id is null or (prior.document-'state'-'reviewNote')<>(new.document-'state'-'reviewNote') then
      raise exception '검토자는 관찰 내용을 고칠 수 없습니다. 상태와 검토 의견만 남겨 주세요';
    end if;
  end if;
  return new;
end $$;
-- (실행권은 그대로 — create or replace는 s2_0066에서 거둔 권한을 유지한다)

-- p_student를 주면 그 학생이 한 번이라도 대상이던 기록만 훑는다(학생 통합보기 — 지점 전체를 매번 훑지 않게 · 인덱스 academy_knowledge_student_idx).
-- 🔴 돌려주는 줄은 여전히 **그 기록의 최신 버전**이다 — 최신 버전의 대상이 그 학생인지는 부르는 쪽이 한 번 더 거른다
--    (대상 학생을 바꾼 후속 조치의 옛 버전을 그 학생의 지금 기록으로 내주지 않게).
create function public.academy_knowledge_latest(p_tenant uuid, p_author uuid default null, p_student uuid default null)
returns setof public.academy_knowledge_records language sql stable security invoker set search_path = '' as $$
  select distinct on (r.record_id) r.*
  from public.academy_knowledge_records r
  where r.tenant_id = p_tenant and (p_author is null or r.author_id = p_author)
    and (p_student is null or r.record_id in (
      select c.record_id from public.academy_knowledge_records c
      where c.tenant_id = p_tenant and c.document->>'studentId' = p_student::text))
  order by r.record_id, r.version desc
$$;
revoke all on function public.academy_knowledge_latest(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.academy_knowledge_latest(uuid, uuid, uuid) to service_role;
notify pgrst, 'reload schema';
