-- 0376a — 원생 형제 짝(원장 2026-10-19 *"학생에게 학부모 이름 또는 전화번호가 일치하는 다른 학생이 있으면 형제로 표시"* ·
-- *"수동 배정도 가능하게 해주고. (수동 이전에 매핑되는 학생 있으면 자동 추천 및 입력)"*).
--
-- 자동 판정(학부모 휴대폰이 같음 · 학부모 이름이 같고 연락처가 부딪히지 않음)은 앱이 볼 때마다 계산한다
-- (`src/features/students/siblings.ts`) — 저장하지 않는다. 이 표는 **사람이 정한 것만** 담는다:
--   linked = true  → 형제로 지정(자동 판정과 상관없이 형제)
--   linked = false → 자동 판정은 형제라 했지만 사람이 '형제 아님'으로 뺀 짝
-- 짝은 한 줄(student_a < student_b) — 어느 쪽 원생 화면에서 저장해도 같은 줄이다.
--
-- 🔴 서버 전용(정책 없음 · 0374a와 같은 방식): 앱이 원생 열람·관리 권한을 본 뒤 관리 키로만 읽고 쓴다.
-- 🔴 같은 학원 원생끼리만(트리거 — 관리 키로 쓰는 경로까지 막는다). 문구는 화면에 그대로 뜰 수 있다.
-- 배포 순서: 앱은 이 표가 없어도 돈다(자동 판정만 보이고 수정 화면의 형제 칸은 숨는다). 적용하면 형제 칸이 열린다.
begin;

create table if not exists public.student_siblings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_a uuid not null references public.students(id) on delete cascade,
  student_b uuid not null references public.students(id) on delete cascade,
  linked boolean not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (student_a, student_b),
  constraint student_siblings_order_chk check (student_a < student_b)
);
create index if not exists student_siblings_b_idx on public.student_siblings (student_b);
create index if not exists student_siblings_tenant_idx on public.student_siblings (tenant_id);
create index if not exists student_siblings_updated_by_idx on public.student_siblings (updated_by);

alter table public.student_siblings enable row level security;
revoke all on public.student_siblings from public, anon, authenticated;
grant all on public.student_siblings to service_role;

create or replace function public.enforce_student_siblings_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from students s where s.id = new.student_a and s.tenant_id = new.tenant_id)
     or not exists (select 1 from students s where s.id = new.student_b and s.tenant_id = new.tenant_id) then
    raise exception '형제는 같은 학원의 원생끼리만 지정할 수 있습니다' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_student_siblings_tenant on public.student_siblings;
create trigger trg_student_siblings_tenant
  before insert or update on public.student_siblings
  for each row execute function public.enforce_student_siblings_tenant();

comment on table public.student_siblings is
  'Sibling pairs set by staff (linked=true) or auto matches turned off (linked=false). Auto matches are computed, not stored. Server-only (no policies by design).';
commit;
