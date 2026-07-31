-- 0081a: 전면 활동 로그(선생님별 책임추적) — "누가·언제·무엇을 어떻게 바꿨나"를 DB 트리거로 자동 포착. 멱등.
-- 기존 audit_logs(사람친화 요약, 큐레이션 18개 액션)와 별개의 **행 단위 원본 추적**:
-- 핵심 테이블의 INSERT/UPDATE/DELETE를 트리거가 자동 기록 → 앱에서 logAction을 빠뜨려도 누락 없음.
-- 사용자 결정 2026-07-07: 의미있는 변경만(초고빈도 onescreen 자동저장·출석 키오스크 핑은 트리거 미부착).
--
-- ⚠️ 안전 제1원칙: 트리거는 **절대 원래 쓰기를 막지 않는다**. 모든 예외를 삼켜(exception→return null)
--    감사 실패가 프로덕션 쓰기 장애가 되지 않게 한다. AFTER 트리거라 반환값은 무시되지만, 예외를
--    re-raise하지 않는 것이 문장 롤백을 막는 핵심.

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid,            -- auth.uid() (null = 시스템/자동화: service_role·스크립트·동기화). FK 없음(삭제돼도 추적 보존).
  actor_name text,          -- 기록 시점 display_name 비정규화(사용자 삭제 후에도 "누가" 유지).
  table_name text not null,
  row_id uuid,              -- 대상 행 id(jsonb 추출 — id 없는 테이블이면 null).
  target_label text,        -- 대상 행의 사람이 읽는 이름(name/title/student_name…) — 뷰어 가독성.
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  changed jsonb,            -- UPDATE: 바뀐 컬럼 {col:{old,new}}만 / INSERT·DELETE: 스냅샷(노이즈·대형블롭 제거).
  created_at timestamptz not null default now()
);
create index if not exists activity_log_tenant_actor_idx on public.activity_log (tenant_id, actor_id, created_at desc);
create index if not exists activity_log_tenant_created_idx on public.activity_log (tenant_id, created_at desc);
create index if not exists activity_log_tenant_table_idx on public.activity_log (tenant_id, table_name, created_at desc);
-- 전역 보관정책(pruning) 배치용 — created_at 단독(⚠️ 후속: N개월 초과 아카이브/삭제 pg_cron. Phase 1은 테이블+뷰까지).
create index if not exists activity_log_created_idx on public.activity_log (created_at);

alter table public.activity_log enable row level security;
-- 읽기 = 사무실(master/admin/manager)만(모두의 변경 = 급여·권한·PII diff 포함이라 민감). auth_system_role/auth_tenant_id(0001a·0072a).
drop policy if exists activity_log_office_read on public.activity_log;
create policy activity_log_office_read on public.activity_log
  for select
  using (
    tenant_id = public.auth_tenant_id()
    and (select public.auth_system_role()) in ('master', 'admin', 'manager')
  );
-- INSERT/UPDATE/DELETE 정책 없음 → 인증 사용자는 직접 못 씀(트리거 security definer만 기록, 로그 위·변조 차단).

-- 범용 트리거: 행 변경을 activity_log에 기록. jsonb 추출로 테이블 무관 동작(id/tenant_id 컬럼명 규약).
create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_ref jsonb;
  v_new jsonb;
  v_old jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_tenant uuid;
  v_row_id uuid;
  v_label text;
  v_key text;
  -- 스킵(무의미 노이즈): 타임스탬프·비정규화 갱신자.
  noise text[] := array['updated_at', 'created_at', 'status_at', 'sync_added_at', 'updated_by'];
  -- 내용 미기록(대형·민감 블롭 — "바뀜"만 표시, 원문 미복사): 이력서/전사/AI/과목상세 + **급여(원장 전용)**.
  -- ⚠️ hourly_rate·monthly_base = users의 급여 컬럼(schema.ts "외부 노출은 master+본인만"). activity_log는
  --    admin/manager도 읽으므로 원문을 남기면 급여가 새어나간다(적대리뷰 HIGH 3렌즈 확인) → 반드시 redact.
  --    새 민감 컬럼을 부착 테이블에 추가하면 여기에도 추가할 것(blocklist 유지책임).
  redact text[] := array['form_data', 'transcription', 'print_payload', 'ai_summary', 'subject_details',
                         'subject_progress', 'hourly_rate', 'monthly_base'];
begin
  if tg_op = 'DELETE' then v_ref := to_jsonb(old); else v_ref := to_jsonb(new); end if;
  v_tenant := nullif(v_ref ->> 'tenant_id', '')::uuid;
  v_row_id := nullif(v_ref ->> 'id', '')::uuid;
  if v_tenant is null then return null; end if; -- 테넌트 없는 행은 스킵(감사 대상 아님).
  -- 대상 이름(사람이 읽는 라벨) — 흔한 이름 컬럼 우선순위.
  v_label := coalesce(v_ref ->> 'name', v_ref ->> 'title', v_ref ->> 'student_name',
                      v_ref ->> 'class_name', v_ref ->> 'book_name', v_ref ->> 'display_name');

  if tg_op = 'UPDATE' then
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any(noise) then continue; end if;
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        if v_key = any(redact) then
          v_changed := v_changed || jsonb_build_object(v_key, jsonb_build_object('redacted', true));
        else
          v_changed := v_changed || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
        end if;
      end if;
    end loop;
    if v_changed = '{}'::jsonb then return null; end if; -- 실질 변경 없음(예: updated_at만) → 미기록.
  else
    -- INSERT/DELETE: 스냅샷(노이즈·대형블롭 키 제거).
    v_changed := v_ref - noise - redact;
  end if;

  if v_actor is not null then
    select display_name into v_actor_name from public.users where id = v_actor;
  end if;

  insert into public.activity_log (tenant_id, actor_id, actor_name, table_name, row_id, target_label, op, changed)
  values (v_tenant, v_actor, v_actor_name, tg_table_name, v_row_id, v_label, tg_op, v_changed);
  return null; -- AFTER 트리거: 반환값 무시.
exception when others then
  return null; -- ⚠️ 감사 실패가 원래 쓰기를 막지 않게(문장 롤백 방지). 절대 re-raise 금지.
end;
$$;
revoke all on function public.log_activity() from public;

-- 트리거 부착(의미있는 변경 테이블만). 제외: onescreen_daily_sessions(800ms 자동저장)·attendance kiosk 핑·
-- tenant_settings(id 컬럼 없음 + saveOwnerSection이 이미 audit_logs로 기록). 멱등(drop→create).
do $$
declare
  t text;
  tables text[] := array[
    'students', 'classes', 'class_schedules', 'enrollments', 'invoices', 'expenses',
    'student_grades', 'exams', 'level_tests', 'student_consultations', 'enrollment_consultations',
    'textbook_orders', 'users', 'academy_documents', 'meeting_minutes', 'grade_goals', 'grade_comments'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists tg_log_activity on public.%I', t);       -- 옛 결합 트리거(멱등)
      execute format('drop trigger if exists tg_log_activity_id on public.%I', t);
      execute format('drop trigger if exists tg_log_activity_u on public.%I', t);
      -- INSERT/DELETE: 조건 없이. UPDATE: 실제로 한 컬럼이라도 바뀐 경우만 함수 호출(무변경 upsert 오버헤드 차단).
      execute format('create trigger tg_log_activity_id after insert or delete on public.%I for each row execute function public.log_activity()', t);
      execute format('create trigger tg_log_activity_u after update on public.%I for each row when (old.* is distinct from new.*) execute function public.log_activity()', t);
    end if;
  end loop;
end $$;
