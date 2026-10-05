-- 격리된 로컬 검증 DB 전용(이름이 makeup_ 으로 시작해야 한다). 운영·개발 DB에 실행하지 말 것.
-- Supabase 역할·auth.uid()와, 보강 원장이 참조하는 기존 표의 **필요한 칸만** 합성 정의한다.
-- 칸 이름·타입은 src/lib/db/schema.ts 및 해당 마이그레이션(0001a·0033a·0072a·0134a·0173a·0196a·0316a)과 같게 둔다.
-- 0264a(makeup_reservations)는 실제 파일을 실행기가 그대로 적용한다. 데이터는 전부 합성이다.
do $$ begin
  if current_database() !~ '^makeup_[a-z0-9_]+$' then raise exception 'isolated makeup fixture database required'; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase처럼 public 새 표·함수에 기본 권한이 자동으로 붙게 한다(회수 검증의 전제).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
create extension if not exists btree_gist;

create type public.system_role as enum ('master','admin','manager','teacher','counselor','accountant','viewer','student');
create type public.user_status as enum ('active','inactive','pending');
create type public.attendance_status as enum ('present','absent','late','excused','makeup','early_leave');
create type public.day_of_week as enum ('mon','tue','wed','thu','fri','sat','sun');

create function public.tg_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

create table public.tenants (id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null,
  plan text not null default 'free', created_at timestamptz not null default now());
create table public.users (id uuid primary key, tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null, display_name text not null, system_role public.system_role not null default 'viewer',
  status public.user_status not null default 'active', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create table public.super_admins (id uuid primary key, email text not null unique, display_name text not null,
  granted_at timestamptz not null default now(), granted_by uuid);
create function public.auth_tenant_id() returns uuid language sql stable security definer set search_path = public, auth as $$
  select tenant_id from public.users where id = auth.uid() $$;
create function public.auth_system_role() returns text language sql stable security definer set search_path = public, auth as $$
  select system_role::text from public.users where id = auth.uid() $$;
create function public.is_super_admin(uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.super_admins where id = uid) $$;

create table public.tenant_settings (tenant_id uuid primary key references public.tenants(id) on delete cascade,
  data jsonb not null default '{}'::jsonb, updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now());
-- 0158a·0170a: 수납 메뉴의 읽기 판정(원장 상시 · 개인 예외 > 역할 override > 기본값: 관리자·회계 full · 매니저 readonly · 그 밖 none).
create function public.auth_billing_can_read() returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce((
    select u.system_role::text = 'master' or coalesce(
      (select o ->> 'access' from jsonb_array_elements(coalesce(ts.data -> 'permissions' -> 'userOverrides', '[]'::jsonb)) with ordinality x(o, n)
        where o ->> 'menu' = 'billing' and o ->> 'userId' = u.id::text order by n desc limit 1),
      (select o ->> 'access' from jsonb_array_elements(coalesce(ts.data -> 'permissions' -> 'overrides', '[]'::jsonb)) with ordinality x(o, n)
        where o ->> 'menu' = 'billing' and o ->> 'role' = u.system_role::text order by n desc limit 1),
      case when u.system_role::text in ('admin', 'accountant') then 'full' when u.system_role::text = 'manager' then 'readonly' else 'none' end) <> 'none'
    from public.users u left join public.tenant_settings ts on ts.tenant_id = u.tenant_id where u.id = auth.uid()), false) $$;
create table public.classrooms (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade, name text not null, capacity integer,
  created_at timestamptz not null default now());
create table public.classes (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade, class_name text not null, subject text not null,
  teacher_id uuid references public.users(id) on delete set null,
  classroom_id uuid references public.classrooms(id) on delete set null, is_active boolean not null default true,
  closed_at date, created_at timestamptz not null default now());
create table public.students (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade, name text not null,
  school text, grade text,
  status text not null default 'enrolled', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create unique index classes_tenant_id_id_uq on public.classes (tenant_id, id);
create unique index students_tenant_id_id_uq on public.students (tenant_id, id);
create table public.enrollments (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete restrict, start_date date not null, end_date date,
  on_hold boolean not null default false, attendance_days text[] not null default '{}'::text[],
  is_transferred boolean not null default false, created_at timestamptz not null default now());
create table public.class_schedules (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade, day_of_week public.day_of_week not null,
  start_time time not null, end_time time not null, valid_from date not null, valid_to date,
  teacher_id uuid references public.users(id) on delete set null,
  classroom_id uuid references public.classrooms(id) on delete set null, period_label text,
  slot_teacher_label text, created_at timestamptz not null default now());
create table public.class_delegations (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade, class_id uuid not null,
  delegate_user_id uuid not null references public.users(id) on delete cascade, from_date date not null,
  to_date date not null, reason text, created_at timestamptz not null default now(), revoked_at timestamptz,
  foreign key (tenant_id, class_id) references public.classes (tenant_id, id) on delete cascade);
create table public.attendance_records (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade, session_date date not null,
  slot_start time, status public.attendance_status not null,
  session_units numeric(4,1) constraint attendance_session_units_range check (session_units is null or (session_units > 0 and session_units <= 20)),
  note text,
  recorded_by uuid references public.users(id) on delete restrict, taught_by uuid references public.users(id) on delete set null,
  recorded_at timestamptz not null default now(), supersedes_id uuid);
create index attendance_student_date_idx on public.attendance_records (tenant_id, student_id, session_date);
create table public.lesson_reports (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade, report_date date not null,
  subject text, class_id uuid references public.classes(id) on delete set null,
  makeup_class_id uuid references public.classes(id) on delete set null, makeup boolean not null default false,
  progress text, notes text, teacher_name text, created_by uuid references public.users(id) on delete set null,
  classnote_status text, created_at timestamptz not null default now(),
  unit_key text generated always as (coalesce(class_id::text, subject)) stored);
create unique index lesson_reports_student_date_unit_key on public.lesson_reports (tenant_id, student_id, report_date, unit_key);
-- 0172a: 보고서 작성 계정은 처음 쓴 사람으로 고정된다(UPDATE로 바뀌지 않는다).
create function public.lesson_reports_keep_created_by() returns trigger language plpgsql as $$
begin new.created_by := coalesce(old.created_by, new.created_by); return new; end; $$;
create trigger lesson_reports_keep_created_by_trg before update on public.lesson_reports
  for each row execute function public.lesson_reports_keep_created_by();
create table public.onescreen_daily_sessions (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade, session_date date not null,
  class_id uuid not null references public.classes(id) on delete cascade, subject_progress jsonb not null default '{}',
  updated_by uuid references public.users(id) on delete set null, updated_at timestamptz not null default now());
create table public.audit_logs (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null, actor_name text, action text not null,
  target_type text, target_label text, metadata jsonb, created_at timestamptz not null default now());

-- 청구 회차(0267a 모양 축약) — 원장은 읽기만 한다(수납 확인 대사의 quantity_basis).
create table public.invoices (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict, period text not null,
  status text not null default 'unpaid', amount_total numeric(12,0) not null default 0, line_items jsonb not null);
-- 0004: 학생·청구월마다 청구 1건 · 0102a: 청구·반마다 회차 행 1건.
create unique index invoices_tenant_student_period_idx on public.invoices (tenant_id, student_id, period);
create table public.invoice_session_terms (id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade, subject text not null,
  class_id uuid not null references public.classes(id) on delete cascade, confirmed_sessions numeric(6,1),
  quantity_basis text not null default 'days' check (quantity_basis in ('days', 'attendance_units')),
  unique (tenant_id, invoice_id, class_id));

-- 0335a의 tenant_settings 쓰기 가드(원문 축약 복사) — 보강 설정 가드와 함께 걸렸을 때의 동작을 본다.
create function public.guard_tenant_settings_write() returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select system_role into v_role from public.users where id = auth.uid();
  if v_role = 'master' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception '학원 설정은 원장만 삭제할 수 있습니다'; end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.tenant_settings where tenant_id = new.tenant_id) then return new; end if;
    raise exception '학원 설정 최초 생성은 원장만 가능합니다';
  end if;
  if not coalesce(public.is_super_admin(auth.uid()), false) then raise exception '학원 설정 변경 권한이 없습니다'; end if;
  return new;
end; $$;
create trigger tg_guard_tenant_settings_write before insert or update or delete on public.tenant_settings
  for each row execute function public.guard_tenant_settings_write();

-- 검증 도우미(mt.*) — 실패하면 그 자리에서 예외로 멈춘다. 통과 수는 mt.passed에 쌓인다.
create schema mt;
grant usage on schema mt to anon, authenticated, service_role;
create table mt.passed (name text not null, at timestamptz not null default clock_timestamp());
grant insert, select on mt.passed to anon, authenticated, service_role;
create function mt.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL: %', p_name using errcode = 'XX000'; end if;
  insert into mt.passed(name) values (p_name);
end; $$;
create function mt.eq(p_got anyelement, p_want anyelement, p_name text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'FAIL: % (got %, want %)', p_name, p_got, p_want using errcode = 'XX000';
  end if;
  insert into mt.passed(name) values (p_name);
end; $$;
-- p_code = 기대하는 detail code(예: forbidden) 또는 SQLSTATE(예: 42501·23514). 예외가 안 나면 실패.
create function mt.throws(p_sql text, p_code text, p_name text) returns void language plpgsql as $$
declare v_state text; v_detail text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
    if v_state = p_code or coalesce(v_detail, '') like '%"code": "' || p_code || '"%' then
      insert into mt.passed(name) values (p_name);
      return;
    end if;
    raise exception 'FAIL: % (wanted %, got % / % / %)', p_name, p_code, v_state, v_msg, v_detail using errcode = 'XX000';
  end;
  raise exception 'FAIL: % (no error raised)', p_name using errcode = 'XX000';
end; $$;
create function mt.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '{}' else json_build_object('sub', p_uid)::text end, true);
$$;
