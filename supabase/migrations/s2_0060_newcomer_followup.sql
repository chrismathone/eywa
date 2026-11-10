-- s2_0060 — 신규생 90일 정착 관리: 담임 적응 피드백 · 관리자 확인 · 후속 조치 기록 (aywa-next 인계본 이식)
-- ✅ 운영 적용 2026-11-11(트랜잭션 ROLLBACK 검증 뒤 적용 · 표·정책 0개·함수·트리거 확인).
-- 인계본 원래 이름 20261102142519_newcomer_followup.sql + 20261102143744_newcomer_feedback_response.sql(response 칸)을 한 파일로.
-- 인계본의 학생 단위 담당 표(student_onboarding_assignments)는 옮기지 않는다 — 인계본이 과목별 담당 표(s2_0061)로 옮겨 간 옛 표이고 이 DB엔 옮길 기록이 없다.
--
-- 서버 전용: 브라우저 읽기/쓰기 정책 0개는 의도적이다(s2_0028과 같은 규약 — admin 클라이언트 + tenant_id 필터).
--   메뉴(신규생 관리)·담당 반·과목 범위는 앱(`src/features/newcomers/server/followup-query.ts` · `followup-actions.ts`)이 가른다.
-- 학생이 지워지면(테스트 학생 정리) 기록도 함께 지운다(on delete cascade — s2_0028과 같다). 병합은 소프트 퇴원이라 기록이 남는다.
-- 🔴 한 번만 실행(create에 if not exists가 없다 — 다시 실행하면 오류로 멈춘다 · 트랜잭션이라 데이터는 안전).
-- 되돌리기: scripts/_oneoff/revert-s2_0060-newcomer-followup.sql (s2_0061을 먼저 되돌린 뒤)
begin;
set local statement_timeout = '60s';

create table public.student_onboarding_feedback (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject text not null check (length(subject) between 1 and 60),
  stage text not null check (stage in ('d7','d30','d60','d90')),
  author_id uuid not null references public.users(id),
  condition text not null check (condition in ('good','watch','help')),
  summary text not null check (length(btrim(summary)) between 5 and 2000),
  response text not null default '' check (length(response) <= 1500),
  next_action text not null default '' check (length(next_action) <= 1000),
  next_due date,
  created_at timestamptz not null default now(),
  review_state text not null default 'pending' check (review_state in ('pending','confirmed','revision')),
  review_note text not null default '' check (length(review_note) <= 1500),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  followup_result text not null default '' check (length(followup_result) <= 1500),
  followup_at timestamptz,
  followup_by uuid references public.users(id),
  version integer not null default 1 check (version > 0),
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default now(),
  check ((length(btrim(next_action)) > 0) = (next_due is not null)),
  check ((review_state = 'pending' and reviewed_by is null and reviewed_at is null)
    or (review_state <> 'pending' and reviewed_by is not null and reviewed_at is not null and length(btrim(review_note)) >= 2)),
  check ((followup_at is null and followup_by is null and followup_result = '')
    or (followup_at is not null and followup_by is not null and length(btrim(followup_result)) >= 2 and length(btrim(next_action)) > 0))
);
create index onboarding_feedback_student on public.student_onboarding_feedback (tenant_id, student_id, created_at desc, id);
create index onboarding_feedback_open on public.student_onboarding_feedback (tenant_id, review_state)
  where review_state <> 'confirmed' or (next_action <> '' and followup_at is null);

-- 변경 이력(넣기·고치기마다 한 줄) — 트리거가 같은 트랜잭션에서 쓴다.
create table public.student_onboarding_followup_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  entity_id text not null,
  scope text not null,
  document jsonb not null,
  actor_id uuid not null references public.users(id),
  created_at timestamptz not null default now()
);
create index onboarding_events_student on public.student_onboarding_followup_events (tenant_id, student_id, created_at desc);

alter table public.student_onboarding_feedback enable row level security;
alter table public.student_onboarding_followup_events enable row level security;
revoke all on public.student_onboarding_feedback, public.student_onboarding_followup_events from public, anon, authenticated;
grant select, insert, update on public.student_onboarding_feedback to service_role;
grant select, insert on public.student_onboarding_followup_events to service_role;
grant usage, select on sequence public.student_onboarding_followup_events_id_seq to service_role;

-- 같은 지점의 학생·직원인지, 범위·버전이 바르게 바뀌는지 — 서버 액션의 판정과 별개로 DB가 한 번 더 막는다.
create function public.validate_onboarding_followup() returns trigger language plpgsql set search_path = '' as $$
declare record_json jsonb := to_jsonb(new); key text; person_id uuid;
begin
  if not exists (select 1 from public.students where id = new.student_id and tenant_id = new.tenant_id) then
    raise exception '학생 소속을 확인해 주세요' using errcode = '23514';
  end if;
  foreach key in array array['manager_id','author_id','updated_by','reviewed_by','followup_by'] loop
    person_id := (record_json->>key)::uuid;
    if person_id is not null and not exists (select 1 from public.users where id = person_id and tenant_id = new.tenant_id) then
      raise exception '직원 소속을 확인해 주세요' using errcode = '23514';
    end if;
  end loop;
  if tg_op = 'UPDATE' and (new.tenant_id <> old.tenant_id or new.student_id <> old.student_id or new.version <> old.version + 1) then
    raise exception '다른 변경이 있습니다. 새로 불러와 주세요' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create function public.audit_onboarding_followup() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.student_onboarding_followup_events (tenant_id, student_id, entity_id, scope, document, actor_id)
  values (new.tenant_id, new.student_id, coalesce(to_jsonb(new)->>'id', new.student_id::text), tg_table_name, to_jsonb(new), new.updated_by);
  return new;
end $$;
revoke all on function public.validate_onboarding_followup(), public.audit_onboarding_followup() from public, anon, authenticated;
grant execute on function public.validate_onboarding_followup(), public.audit_onboarding_followup() to service_role;

create trigger onboarding_feedback_validate before insert or update on public.student_onboarding_feedback
  for each row execute function public.validate_onboarding_followup();
create trigger onboarding_feedback_audit after insert or update on public.student_onboarding_feedback
  for each row execute function public.audit_onboarding_followup();

notify pgrst, 'reload schema';
commit;
