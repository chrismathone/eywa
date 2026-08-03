-- 0173a — 반 임시 위임(결근 대체 수업) (2026-08-03).
--
-- 배경(원장 2026-08-03): *"강사가 특별한 일이 있어서 결근을 하게 되면, 다른 강사의 수업에 임시로 학생을
-- 보내 수업을 받게 하는 일이 있다"* → **실제로 가르친 대체 강사**가 그 학생들 수업보고서를 써야 한다.
--
-- 기존 두 경로가 왜 부족한가:
--  ① '+ 보강 학생 추가'(outOfClass) — 되긴 하지만 보강 행은 반이 없어(class_id NULL) **반 목록·필터에
--     안 잡히고 한 명씩 이름으로 검색**해 넣어야 한다. 반 하나가 통째로 오면 15명을 손으로 찾는 셈이고,
--     과목도 대체 강사 담당 과목으로만 열린다.
--  ② 관리자 '직접 작성·발송' — 표 모드가 아니라 1인 폼이고 화면 초안 복원이 없다(원장: "임시저장이 없어 불편").
--  ③ 인수인계(classes.pending_teacher_*) — **영구 교체** 전제라 하루 결근에 쓰면 시간표·급여 분배까지
--     따라가고 되돌리는 걸 잊으면 조용히 틀어진다.
--
-- → 그래서 **반을 기간 동안 대체 강사의 로스터에 얹는다.** 그러면 표 모드·임시저장·일괄 입력·첨부가
--    전부 기존 원스크린 파이프라인을 그대로 타서 새로 만들 화면이 없다(로스터 한 곳만 넓히면 된다).
--
-- 🔴 담임(`classes.teacher_id`)은 **건드리지 않는다** — 그게 인수인계와의 결정적 차이다. 담임을 바꾸면
--    시간표·급여 splits·ECS 스코프·작성률 귀속이 전부 따라 움직이고, 되돌릴 때 그 전부를 되돌려야 한다.
--    위임은 "이 기간 이 반을 누가 더 볼 수 있는가"만 더한다(원 담임은 그대로 유효).
--
-- 🔒 RLS: SELECT만 정책을 둔다(테넌트 내 읽기 — "누가 어느 반을 대신 맡는가"는 시간표 수준 정보).
--    **INSERT/UPDATE/DELETE 정책은 일부러 없다** → authenticated 토큰의 PostgREST 직접 쓰기가 구조적으로
--    불가능하고, 쓰기는 서버 액션이 앱 게이트(반 쓰기 권한 OR 그 반 담임 본인)를 통과한 뒤 admin client로만
--    한다(#77 — 한 레코드의 모든 표면이 공용 게이트를 지나게).
--    ⚠️ `auth_menu_access('classes')`를 여기 쓰지 말 것 — 그 함수의 DEFAULTS jsonb에는 billing·
--    expense_requests·staff·textbook_requests 4행만 있어 'classes'는 **master 빼고 전원 'none'**을 돌려준다
--    (관리자가 통째로 잠긴다). 역할 판정은 앱의 accessLevelTenant(role,"classes") 단일 소스에 둔다.
--
-- 롤백: drop table public.class_delegations cascade; (앱 배포 전이면 무해 — 없으면 로스터가 담당 반만 싣는다)

create table if not exists public.class_delegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null,
  -- 이 기간 이 반을 대신 맡는 강사. 담임(classes.teacher_id)은 불변 — 위임은 얹기지 교체가 아니다.
  delegate_user_id uuid not null references public.users(id) on delete cascade,
  -- 포함 구간 [from_date, to_date] — 하루 위임이면 두 값이 같다(UI 기본값).
  from_date date not null,
  to_date date not null,
  reason text check (char_length(reason) <= 200),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- 해제 = 행 삭제가 아니라 revoked_at 기록(누가 언제 대신 맡았는지는 감사 대상 — 지우면 사라진다).
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete set null,
  constraint class_delegations_range_ck check (to_date >= from_date)
);

-- 교차 테넌트 참조 봉쇄 — classes (tenant_id, id) unique는 0157a가 이미 만들어 둔다(멱등 재보장).
create unique index if not exists classes_tenant_id_id_uq on public.classes (tenant_id, id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_delegations_class_fk') then
    alter table public.class_delegations
      add constraint class_delegations_class_fk
      foreign key (tenant_id, class_id) references public.classes (tenant_id, id) on delete cascade;
  end if;
end $$;

comment on table public.class_delegations is
  '반 임시 위임(결근 대체) — 이 기간 이 반이 대체 강사의 원스크린 로스터에도 실린다. '
  '담임(classes.teacher_id)은 불변(영구 교체는 인수인계 pending_teacher_*가 담당). '
  '⚠️ 쓰기 정책 없음 = PostgREST 직접 쓰기 불가. 쓰기는 서버 액션(반 쓰기 권한 OR 담임 본인) → admin client.';

-- 로스터가 매 요청 도는 조회: "오늘 나에게 위임된 반" (tenant + 대체강사 + 날짜창).
create index if not exists class_delegations_for_delegate_idx
  on public.class_delegations (tenant_id, delegate_user_id, from_date, to_date)
  where revoked_at is null;

-- 반 상세/원 담임 화면: "이 반이 지금 누구에게 위임돼 있나".
create index if not exists class_delegations_for_class_idx
  on public.class_delegations (tenant_id, class_id, from_date, to_date)
  where revoked_at is null;

alter table public.class_delegations enable row level security;

-- 읽기 = 같은 학원. "누가 어느 반을 대신 맡는가"는 시간표 수준 정보라 강사도 본다
-- (대체 강사 본인은 자기 위임을 봐야 하고, 원 담임은 자기 반이 위임됐음을 화면에서 알아야 한다).
drop policy if exists class_delegations_tenant_read on public.class_delegations;
create policy class_delegations_tenant_read on public.class_delegations
  for select
  using (tenant_id = (select public.auth_tenant_id()));
