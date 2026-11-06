-- s2_0029 — 등록 전 상담 약속 + 원자적 학생 연결 + 강사 시트 실제 진도 증거 (원장 2026-11-05 *"전부 가져온다"*)
-- ⏳ 운영 미적용. 인계본 원래 이름 s2_0015_intake_care_and_sheet_evidence.sql(별도 fork 번호) → main 다음 빈 번호 s2_0029.
-- 🔴 s2_0028 다음에 적용. 기존 함수 서명(save_student_care)도 유지한다 — 앱은 둘 중 무엇이 있든 돈다(확장 칸이 없으면 옛 칸으로 다시 읽는다).
--
-- ① 약속 대상 = 학생 또는 신규 콜&상담(입학 전). student_id nullable · intake_id 추가 · 둘 중 하나는 있어야 한다.
-- ② 상담이 학생으로 연결되는 순간(enrollment_consultations.student_id null → 값) 같은 트랜잭션에서 그 상담의 약속을 학생에게 잇고
--    이력에 'student_linked'를 남긴다(트리거 · 약속 ID·문서는 그대로).
-- ③ 저장 함수 v2 — 영어 강사 시트 개별 진도(class_sheet_student_marks) · 수학 시트(실제로 나간 수업보고서)도 증거로 받는다.
--    수강 기간 안 · 오늘까지 · 진도가 적힌 기록만(반 전체 계획은 학생의 이행 증거가 아니다).
-- 잠금: enrollment_consultations에 트리거를 거는 동안(SHARE ROW EXCLUSIVE) 뒤의 쓰기가 줄을 선다 → lock_timeout 3초(못 잡으면 실패 — 다시 실행).
-- 되돌리기(앱을 먼저 되돌린 뒤): drop trigger student_care_on_intake_link on public.enrollment_consultations;
--   drop trigger student_care_on_intake_delete on public.enrollment_consultations; drop function public.drop_intake_only_care();
--   drop function public.link_intake_care_student(); drop function public.save_student_care_v2(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb);
--   그리고 s2_0028의 save_student_care 본문을 다시 실행(등록 전 약속 행이 있으면 student_id not null 복구 전에 정리할 것).
-- 🔴 한 번만 실행(add column·create function에 if not exists가 없다 — 다시 실행하면 오류로 멈춘다 · 트랜잭션이라 데이터는 안전).
begin;
set local statement_timeout = '60s';
set local lock_timeout = '3s';
alter table public.student_care_commitments alter column student_id drop not null;
alter table public.student_care_commitments add column intake_id uuid references public.enrollment_consultations(id) on delete set null;
alter table public.student_care_commitments add constraint student_care_target_ck check (student_id is not null or intake_id is not null);
create index student_care_intake_idx on public.student_care_commitments(tenant_id,intake_id,updated_at desc);
alter table public.student_care_events drop constraint student_care_events_kind_check;
alter table public.student_care_events add constraint student_care_events_kind_check check (kind in ('create','revise','acknowledge','evidence','complete','cancel','student_linked','merge_moved'));
-- merge_moved = 신규 콜&상담 병합이 진 쪽 상담의 약속을 이긴 쪽으로 옮김(또는 병합 실패로 되돌림) — 앱 merge-move.ts가 남긴다.

-- 같은 트랜잭션에서 ID·문서를 보존하고 저장 버전과 감사 이력만 추가한다.
create function public.link_intake_care_student() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_record record;
begin
  if old.student_id is null and new.student_id is not null then
    if not exists(select 1 from public.students where id=new.student_id and tenant_id=new.tenant_id) then raise exception '학생 연결을 확인하지 못했습니다'; end if;
    for v_record in
      update public.student_care_commitments set student_id=new.student_id,version=version+1,updated_at=now()
        where tenant_id=new.tenant_id and intake_id=new.id and student_id is null returning *
    loop
      insert into public.student_care_events(tenant_id,commitment_id,version,kind,reason,document)
        values(new.tenant_id,v_record.id,v_record.version,'student_linked','입학상담의 학생 등록 연결',v_record.document);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.link_intake_care_student() from public, anon, authenticated;

-- 입학상담을 지우면(삭제·병합의 진 쪽) 그 상담에만 걸린 등록 전 약속(학생 없음)은 함께 지운다 — 기댈 곳이 없는 약속이다(이력은 cascade).
-- 학생에게 이어진 약속은 남고 입학상담 칸만 비워진다(on delete set null). 병합은 앱이 지우기 전에 이긴 쪽으로 옮긴다(merge-move.ts).
create function public.drop_intake_only_care() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.student_care_commitments where tenant_id=old.tenant_id and intake_id=old.id and student_id is null;
  return old;
end;
$$;
revoke all on function public.drop_intake_only_care() from public, anon, authenticated;
create trigger student_care_on_intake_delete before delete on public.enrollment_consultations
  for each row execute function public.drop_intake_only_care();
create trigger student_care_on_intake_link after update of student_id on public.enrollment_consultations
  for each row execute function public.link_intake_care_student();

create function public.save_student_care_v2(
  p_tenant uuid, p_student uuid, p_intake uuid, p_id uuid, p_actor uuid, p_expected integer,
  p_kind text, p_reason text, p_document jsonb
) returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_intake uuid := p_intake;
  v_student uuid := p_student;
  v_linked uuid;
  v_owner uuid := (p_document->'content'->>'ownerId')::uuid;
  v_source uuid := (p_document->'content'->>'sourceId')::uuid;
  v_state text := p_document->>'state';
  v_due date := (p_document->'content'->>'dueOn')::date;
  v_version integer;
  v_evidence jsonb;
begin
  -- 상담 → 약속 순서로 잠근다. 등록 트리거와 저장이 같은 순서를 사용한다.
  if v_intake is null then
    select intake_id into v_intake from public.student_care_commitments where id=p_id and tenant_id=p_tenant;
  end if;
  if v_intake is not null then
    select student_id into v_linked from public.enrollment_consultations where id=v_intake and tenant_id=p_tenant for update;
    if not found then raise exception '입학상담을 확인하지 못했습니다'; end if;
    if p_intake is not null then
      if p_student is not null and p_student is distinct from v_linked then raise exception using errcode='40001',message='학생 연결이 변경되었습니다'; end if;
      v_student := v_linked;
    elsif p_kind <> 'cancel' and v_student is distinct from v_linked then
      raise exception '입학상담의 학생 연결을 확인해 주세요';
    end if;
    if p_kind <> 'cancel' and v_source is distinct from v_intake then raise exception '이 약속의 입학상담 원본은 변경할 수 없습니다'; end if;
  end if;
  if v_student is null and v_intake is null then raise exception '약속 대상을 확인하지 못했습니다'; end if;
  if (v_student is not null and not exists (select 1 from public.students where id=v_student and tenant_id=p_tenant))
    or not exists (select 1 from public.users where id=p_actor and tenant_id=p_tenant and status='active')
    or not exists (select 1 from public.users where id=v_owner and tenant_id=p_tenant
      and (p_kind not in ('create','revise') or (status='active' and system_role in ('master','admin','manager','teacher','counselor')))) then
    raise exception '학생 또는 담당자 정보를 확인할 수 없습니다';
  end if;
  -- 출처는 만들기·고치기에서만 바뀐다 — 그때만 확인한다(s2_0028과 같은 규칙).
  if p_kind in ('create','revise') and v_source is not null and not exists (select 1 from public.enrollment_consultations where id=v_source and tenant_id=p_tenant and student_id is not distinct from v_student) then
    raise exception '이 학생의 입학상담 기록이 아닙니다';
  end if;
  -- 완료 직전에도 원본 존재·학생 일치를 다시 확인하고 트랜잭션 동안 삭제·변경을 막는다.
  if p_kind in ('evidence', 'complete') then
    if v_student is null then raise exception '학생 등록 후 이행 증거를 연결해 주세요'; end if;
    for v_evidence in select value from jsonb_array_elements(p_document->'evidence') where value->>'revision'=p_document->>'revision' loop
      if v_evidence->>'kind'='consultation' then
        perform id from public.student_consultations where id=(v_evidence->>'recordId')::uuid and tenant_id=p_tenant and student_id=v_student for share;
      elsif v_evidence->>'kind'='lesson_report' then
        perform r.id from public.lesson_reports r where r.id=(v_evidence->>'recordId')::uuid and r.tenant_id=p_tenant and r.student_id=v_student
          and r.revoked_at is null and r.report_date <= (now() at time zone 'Asia/Seoul')::date
          and (r.classnote_status='success' or r.classnote_sent_at is not null or r.edutrix_share_token is not null or r.source='demo_history') for share;
      elsif v_evidence->>'kind'='english_sheet' then
        perform m.id from public.class_sheet_student_marks m join public.classes c on c.id=m.class_id and c.tenant_id=m.tenant_id
          where m.id=(v_evidence->>'recordId')::uuid and m.tenant_id=p_tenant and m.student_id=v_student and c.subject='english'
          and m.mark_date <= (now() at time zone 'Asia/Seoul')::date
          and (nullif(btrim(m.progress_note),'') is not null or nullif(btrim(m.score),'') is not null)
          and exists(select 1 from public.enrollments e where e.tenant_id=p_tenant and e.class_id=m.class_id and e.student_id=v_student
            and e.start_date<=m.mark_date and (e.end_date is null or e.end_date>=m.mark_date)) for share of m,c;
      elsif v_evidence->>'kind'='math_sheet' then
        perform r.id from public.lesson_reports r join public.classes c on c.id=r.class_id and c.tenant_id=r.tenant_id
          where r.id=(v_evidence->>'recordId')::uuid and r.tenant_id=p_tenant and r.student_id=v_student and c.subject='math'
          and r.report_date <= (now() at time zone 'Asia/Seoul')::date and nullif(btrim(r.progress),'') is not null and r.revoked_at is null
          and (r.classnote_status='success' or r.classnote_sent_at is not null or r.edutrix_share_token is not null or r.source='demo_history')
          and exists(select 1 from public.enrollments e where e.tenant_id=p_tenant and e.class_id=r.class_id and e.student_id=v_student
            and e.start_date<=r.report_date and (e.end_date is null or e.end_date>=r.report_date)) for share of r,c;
      else raise exception '지원하지 않는 증거 종류입니다';
      end if;
      if not found then raise exception '증거 원본을 확인하지 못했습니다'; end if;
    end loop;
  end if;
  if p_expected=0 and p_kind='create' then
    insert into public.student_care_commitments(id,tenant_id,student_id,intake_id,owner_id,source_id,due_on,state,version,document)
      values(p_id,p_tenant,v_student,v_intake,v_owner,v_source,v_due,v_state,1,p_document)
      on conflict (id) do nothing returning version into v_version;
  elsif p_expected>0 and p_kind<>'create' then
    -- 출처 칸은 만들기·고치기에서만 바꾼다(출처 상담이 지워져 비워진 뒤 인수·증거·완료가 옛 id를 다시 쓰다 외래키에 막히지 않게).
    update public.student_care_commitments set owner_id=v_owner,source_id=case when p_kind in ('create','revise') then v_source else source_id end,due_on=v_due,state=v_state,
      version=version+1,document=p_document,updated_at=now()
      where id=p_id and tenant_id=p_tenant and student_id is not distinct from v_student and (p_intake is null or intake_id=p_intake) and version=p_expected
      returning version into v_version;
  end if;
  if v_version is null then raise exception using errcode='40001', message='다른 변경이 있습니다. 새로 불러온 뒤 다시 시도해 주세요'; end if;
  insert into public.student_care_events(tenant_id,commitment_id,version,actor_id,kind,reason,document)
    values(p_tenant,p_id,v_version,p_actor,p_kind,p_reason,p_document);
  return v_version;
end;
$$;
revoke all on function public.save_student_care_v2(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_student_care_v2(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb) to service_role;

-- 기존 앱/학생 화면도 같은 검증 경로를 사용한다.
create or replace function public.save_student_care(
  p_tenant uuid, p_student uuid, p_id uuid, p_actor uuid, p_expected integer,
  p_kind text, p_reason text, p_document jsonb
) returns integer language sql security invoker set search_path = public, pg_temp as $$
  select public.save_student_care_v2(p_tenant,p_student,null,p_id,p_actor,p_expected,p_kind,p_reason,p_document);
$$;
revoke all on function public.save_student_care(uuid,uuid,uuid,uuid,integer,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_student_care(uuid,uuid,uuid,uuid,integer,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
