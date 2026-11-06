-- 되돌리기: s2_0031_academy_assistant.sql(학원 비서 DB 쪽) — 보기·묶기·갱신 함수·전용 역할을 걷는다.
-- 🔴 앱을 먼저 되돌리거나(비서 버튼이 없는 판) env ASSISTANT_DATABASE_URL을 지운 뒤에 돌린다 — 앱이 살아 있으면 질문이 연결 실패로 끝난다.
-- 대화 기록 표(assistant_threads · assistant_messages)는 원장의 대화라 남긴다. 지우려면 맨 아래 주석 두 줄을 따로 돌린다.
begin;
set local lock_timeout = '5s';

-- s2_0031이 PUBLIC 실행권을 회수한 public 보안 정의자 함수(적대 리뷰 1번) — 기록해 둔 목록대로만 되살린다(스키마를 지우기 전에).
do $$
declare
  r record;
begin
  if to_regclass('assistant_private.revoked_public_execute') is not null then
    for r in select fn from assistant_private.revoked_public_execute loop
      execute format('grant execute on function %s to public', r.fn);
    end loop;
  end if;
end $$;

drop function if exists public.assistant_refresh_views_if_stale();
drop function if exists public.assistant_issue_binding(uuid);
drop schema if exists assistant cascade;
drop schema if exists assistant_private cascade;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aywa_assistant') then
    -- 열린 연결이 있으면 역할을 지울 수 없다 — 끊는다.
    perform pg_terminate_backend(pid) from pg_stat_activity where usename = 'aywa_assistant';
    drop role aywa_assistant;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname in ('assistant', 'assistant_private')) then raise exception '되돌리기 확인: 스키마가 남았습니다'; end if;
  if exists (select 1 from pg_roles where rolname = 'aywa_assistant') then raise exception '되돌리기 확인: 역할이 남았습니다'; end if;
end $$;

notify pgrst, 'reload schema';
commit;

-- (선택) 대화 기록까지 지울 때만:
-- drop table if exists public.assistant_messages;
-- drop table if exists public.assistant_threads;
