-- 0361a — 콜&상담 '소개한 사람'(강사평가 3단계 · 원생 소개, 원장 2026-10-13 결정 7)
--
-- 원장: *"누구 소개로 왔다"가 인정된 경우에만* · *"상담만 받아도 인정"* · *"1건당 5점"*.
-- 상담 경로('지인 소개'·'재원생 추천')만으로는 **누가** 소개했는지 모른다 — 침산 상담 2,244건 중 소개 언급 804건,
-- 이름이 붙은 201건 가운데 실제 원생·직원 이름과 맞는 것은 18건(약 9%)이었다. 그래서 글로 잇지 않고 **고르는 칸**을 둔다.
--
-- ① referrer_student_id — 소개한 원생. 강사평가는 그 원생의 **상담일 담임**(여러 과목이면 담임 전원)에게 1건을 준다.
-- ② referrer_staff_id   — 직원이 직접 소개했으면 그 직원.
-- ③ referrer_name       — 글로 받은 소개자 이름(QR 상담 신청서 — 공개 화면이라 원생 목록을 내려줄 수 없다).
--    직원이 콜&상담에서 ①·②로 **연결해야** 인정된다(글만으로는 세지 않는다 — 자동 확정 금지).
--
-- 🔴 ①·② 중 하나만(둘 다면 누구 몫인지 모른다). 같은 학원 사람만(트리거 — 관리 클라이언트로 쓰는 경로도 막는다).
-- 🔴 배포 순서 = **이 마이그레이션이 먼저, 앱 코드는 나중**(#95). 칸이 없는 동안 앱이 읽으면 그 화면이 죽는다.

alter table public.enrollment_consultations
  add column if not exists referrer_student_id uuid references public.students(id) on delete set null,
  add column if not exists referrer_staff_id   uuid references public.users(id) on delete set null,
  add column if not exists referrer_name       text;

comment on column public.enrollment_consultations.referrer_student_id is
  '소개한 원생(강사평가 원생 소개 — 상담일 담임에게 1건). referrer_staff_id와 동시에 둘 수 없다.';
comment on column public.enrollment_consultations.referrer_staff_id is
  '직원이 직접 소개했으면 그 직원(강사평가 원생 소개 — 그 직원에게 1건).';
comment on column public.enrollment_consultations.referrer_name is
  '글로 받은 소개자 이름(QR 신청서 등). 연결(referrer_student_id·referrer_staff_id) 전에는 세지 않는다.';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'ec_referrer_one_chk') then
    alter table public.enrollment_consultations
      add constraint ec_referrer_one_chk check (num_nonnulls(referrer_student_id, referrer_staff_id) <= 1);
  end if;
end
$do$;

-- 같은 학원 사람만 — 관리 클라이언트(RLS 우회)로 쓰는 경로까지 막는다. 문구는 화면에 그대로 뜰 수 있다(한글 · 역할 이름 없음).
create or replace function public.enforce_consultation_referrer_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.referrer_student_id is not null
     and not exists (select 1 from students s where s.id = new.referrer_student_id and s.tenant_id = new.tenant_id) then
    raise exception '소개한 원생은 같은 학원의 원생만 고를 수 있습니다' using errcode = '23514';
  end if;
  if new.referrer_staff_id is not null
     and not exists (select 1 from users u where u.id = new.referrer_staff_id and u.tenant_id = new.tenant_id) then
    raise exception '소개한 직원은 같은 학원의 직원만 고를 수 있습니다' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_consultation_referrer_tenant on public.enrollment_consultations;
create trigger trg_consultation_referrer_tenant
  before insert or update of referrer_student_id, referrer_staff_id, tenant_id on public.enrollment_consultations
  for each row execute function public.enforce_consultation_referrer_tenant();

-- 강사평가 집계가 '소개가 있는 상담'만 읽는다.
create index if not exists ec_tenant_referrer_idx
  on public.enrollment_consultations (tenant_id)
  where referrer_student_id is not null or referrer_staff_id is not null;
