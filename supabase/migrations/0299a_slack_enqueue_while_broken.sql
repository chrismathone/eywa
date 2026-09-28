-- 0299a — 슬랙 인박스 트리거: 연결이 '끊김'(broken)인 동안에도 사건을 쌓는다 (2026-09-28, grok 2차 검토).
--
-- 왜: 0298a 트리거는 `status = 'active'`일 때만 인박스에 넣었다. 토큰이 폐기돼 발송기가 연결을 broken으로 바꾸면
--     원장이 새 토큰을 넣을 때까지의 출결·결재가 **인박스에도 아웃박스에도 없어** 영영 빠졌다.
--     이제 토큰이 등록돼 있기만 하면(bot_token <> '') 쌓고, 발송기는 broken 동안 보내지 않다가 새 토큰이 저장되면
--     쌓인 것부터 보낸다(대상별로 4건 이상이면 묶음 한 통 · 방해금지 중이면 아침 요약).
-- 🔴 원본 쓰기를 막지 않는 것은 그대로(예외 삼킴). 연결 해제(토큰 비움)면 쌓지 않는다.
-- 멱등: create or replace.

create or replace function public.slack_enqueue_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := tg_argv[0];
  v_key text := to_jsonb(new) ->> tg_argv[1];
begin
  begin
    if v_key is not null
      and exists (
        select 1 from public.slack_rules r
        where r.tenant_id = new.tenant_id and r.enabled and r.source = v_source and v_key = any (r.type_keys)
      )
      and exists (
        select 1 from public.slack_connections c
        where c.tenant_id = new.tenant_id and c.bot_token <> ''
      )
      and exists (
        select 1 from public.tenant_licenses l
        where l.tenant_id = new.tenant_id and l.feature = 'slack' and l.is_active
          and (l.expires_at is null or l.expires_at > now())
      )
    then
      insert into public.slack_inbox (tenant_id, source, source_id)
      values (new.tenant_id, v_source, new.id)
      on conflict do nothing;
    end if;
  exception when others then
    null; -- 🔴 슬랙 연동 문제로 원본 쓰기를 막지 않는다
  end;
  return new;
end;
$$;
revoke all on function public.slack_enqueue_event() from public, anon, authenticated;
