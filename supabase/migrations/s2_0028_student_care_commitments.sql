-- s2_0028 — 상담 약속·인계 저장 표 (원장 2026-11-05 *"전부 가져온다"* — AX 인계본의 '상담 약속·인계'를 main에 이식)
-- ⏳ 운영 미적용. 인계본 원래 이름 s2_0014_student_care_commitments.sql(별도 fork 번호) → main 다음 빈 번호 s2_0028.
--
-- 흐름: 입학상담 요구 → 학원이 한 약속(목표일·담당자) → 담당자 인수 확인 → 실제 기록(상담·수업보고서)으로 이행 증거 → 관리자 완료 확인.
-- 서버 전용: 브라우저 읽기/쓰기 정책 0개는 의도적이다(s2_0027과 같은 규약 — admin 클라이언트 + tenant_id 필터).
--   메뉴(신규생 관리·원생목록·원생상담)·담당자·학생 범위는 앱(`src/features/student-care/server/access.ts`)이 가른다.
-- 변경과 감사 이력을 같은 트랜잭션으로 저장하며 version 비교로 동시 수정 덮어쓰기를 막는다.
-- 앱은 표·함수가 없는 옛 스키마에서도 원생 화면·신규생 체크리스트를 그대로 제공한다(약속 조회는 '준비 안 됨' 안내 — #95).
-- 🔴 한 번만 실행(create table·function에 if not exists가 없다 — 다시 실행하면 오류로 멈춘다 · 트랜잭션이라 데이터는 안전).
-- 다음 파일: s2_0029(등록 전 약속 · 학생 연결 트리거 · 강사 시트 증거) — 이 파일 뒤에 적용.
-- 되돌리기(앱을 먼저 되돌린 뒤 · 적힌 약속이 함께 사라진다):
--   drop function public.save_student_care(uuid,uuid,uuid,uuid,integer,text,text,jsonb);
--   drop table public.student_care_events; drop table public.student_care_commitments;
begin;
set local statement_timeout = '60s';

create table public.student_care_commitments (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  owner_id uuid not null references public.users(id),
  -- 출처 입학상담이 지워지면(삭제·병합) 약속은 남고 출처만 비운다(병합은 앱이 지우기 전에 이긴 쪽 상담으로 옮긴다 — merge-move.ts).
  source_id uuid references public.enrollment_consultations(id) on delete set null,
  due_on date not null,
  state text not null check (state in ('open', 'completed', 'cancelled')),
  version integer not null check (version > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index student_care_open_idx on public.student_care_commitments (tenant_id, state, due_on, id);
create index student_care_student_idx on public.student_care_commitments (tenant_id, student_id, updated_at desc);
create index student_care_owner_idx on public.student_care_commitments (tenant_id, owner_id, state);
alter table public.student_care_commitments enable row level security;
revoke all on public.student_care_commitments from anon, authenticated;
grant all on public.student_care_commitments to service_role;

create table public.student_care_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  commitment_id uuid not null,
  version integer not null,
  actor_id uuid references public.users(id) on delete set null,
  kind text not null check (kind in ('create', 'revise', 'acknowledge', 'evidence', 'complete', 'cancel')),
  reason text,
  document jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, commitment_id) references public.student_care_commitments(tenant_id, id) on delete cascade,
  unique (tenant_id, commitment_id, version)
);
alter table public.student_care_events enable row level security;
revoke all on public.student_care_events from anon, authenticated;
grant all on public.student_care_events to service_role;
grant usage, select on sequence public.student_care_events_id_seq to service_role;

create function public.save_student_care(
  p_tenant uuid, p_student uuid, p_id uuid, p_actor uuid, p_expected integer,
  p_kind text, p_reason text, p_document jsonb
) returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_owner uuid := (p_document->'content'->>'ownerId')::uuid;
  v_source uuid := (p_document->'content'->>'sourceId')::uuid;
  v_state text := p_document->>'state';
  v_due date := (p_document->'content'->>'dueOn')::date;
  v_version integer;
  v_evidence jsonb;
begin
  if not exists (select 1 from public.students where id=p_student and tenant_id=p_tenant)
    or not exists (select 1 from public.users where id=p_actor and tenant_id=p_tenant and status='active')
    or not exists (select 1 from public.users where id=v_owner and tenant_id=p_tenant
      and (p_kind not in ('create','revise') or (status='active' and system_role in ('master','admin','manager','teacher','counselor')))) then
    raise exception '학생 또는 담당자 정보를 확인할 수 없습니다';
  end if;
  -- 출처는 만들기·고치기에서만 바뀐다 — 그때만 확인한다(출처 상담이 나중에 지워져도 인수·증거·완료가 막히지 않게).
  if p_kind in ('create','revise') and v_source is not null and not exists (select 1 from public.enrollment_consultations where id=v_source and tenant_id=p_tenant and student_id=p_student) then
    raise exception '이 학생의 입학상담 기록이 아닙니다';
  end if;
  -- 완료 직전에도 원본 존재·학생 일치를 다시 확인하고 트랜잭션 동안 삭제·변경을 막는다.
  if p_kind in ('evidence', 'complete') then
    for v_evidence in select value from jsonb_array_elements(p_document->'evidence') where value->>'revision'=p_document->>'revision' loop
      if v_evidence->>'kind'='consultation' then
        perform id from public.student_consultations where id=(v_evidence->>'recordId')::uuid and tenant_id=p_tenant and student_id=p_student for share;
      elsif v_evidence->>'kind'='lesson_report' then
        -- 수업보고서 증거 = 실제로 나간 보고서만(회수·미발송 초안·미래 날짜 제외 — 수학 시트 증거와 같은 조건).
        perform r.id from public.lesson_reports r where r.id=(v_evidence->>'recordId')::uuid and r.tenant_id=p_tenant and r.student_id=p_student
          and r.revoked_at is null and r.report_date <= (now() at time zone 'Asia/Seoul')::date
          and (r.classnote_status='success' or r.classnote_sent_at is not null or r.edutrix_share_token is not null or r.source='demo_history') for share;
      else raise exception '지원하지 않는 증거 종류입니다';
      end if;
      if not found then raise exception '증거 원본을 확인하지 못했습니다'; end if;
    end loop;
  end if;
  if p_expected=0 and p_kind='create' then
    insert into public.student_care_commitments(id,tenant_id,student_id,owner_id,source_id,due_on,state,version,document)
      values(p_id,p_tenant,p_student,v_owner,v_source,v_due,v_state,1,p_document)
      on conflict (id) do nothing returning version into v_version;
  elsif p_expected>0 and p_kind<>'create' then
    -- 출처 칸은 만들기·고치기에서만 바꾼다(출처 상담이 지워져 비워진 뒤 인수·증거·완료가 옛 id를 다시 쓰다 외래키에 막히지 않게).
    update public.student_care_commitments set owner_id=v_owner,source_id=case when p_kind in ('create','revise') then v_source else source_id end,due_on=v_due,state=v_state,
      version=version+1,document=p_document,updated_at=now()
      where id=p_id and tenant_id=p_tenant and student_id=p_student and version=p_expected
      returning version into v_version;
  end if;
  if v_version is null then raise exception using errcode='40001', message='다른 변경이 있습니다. 새로 불러온 뒤 다시 시도해 주세요'; end if;
  insert into public.student_care_events(tenant_id,commitment_id,version,actor_id,kind,reason,document)
    values(p_tenant,p_id,v_version,p_actor,p_kind,p_reason,p_document);
  return v_version;
end;
$$;
revoke all on function public.save_student_care(uuid,uuid,uuid,uuid,integer,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_student_care(uuid,uuid,uuid,uuid,integer,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
