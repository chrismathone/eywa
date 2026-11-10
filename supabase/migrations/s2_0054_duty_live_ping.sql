-- s2_0054 — 업무 완성도: 저장하는 순간 열려 있는 화면에 알린다(실시간 신호) (2026-11-10)
--
-- 왜: 원장 2026-11-10 *"출결이나 상담 같은건 실시간 반영되게 해줘"* · *"할 수 있잖아? 굳이 기간마다 반영할 필요가 있나?"* — s2_0051로 장부는 읽는 순간 맞춰지지만,
--   열어 둔 화면은 30~60초마다 다시 받을 때까지 그대로였다.
-- 무엇: 변경 기록 트리거(`duties_private.mark_dirty`)가 변경 기록을 적으면서 **지점 채널(`duties:<지점 id>`)에 '바뀌었다' 신호**를 보낸다(Supabase 실시간 `realtime.send`).
--   화면('내 업무' 줄 · 관리자 화면)은 그 신호를 받으면 바로 다시 받는다 — 다시 받는 길이 읽기 전 맞춤(`flushDuties`)을 지나므로 숫자가 곧바로 바뀐다.
--   신호에는 **내용이 없다**(어느 묶음이 바뀌었는지뿐 — daily/monthly). 학생 · 반 · 사람 · 값은 싣지 않는다(공개 채널).
--   같은 날의 신호는 2초에 한 번만(여러 줄을 한꺼번에 저장해도 한 번).
-- 🔴 저장을 막지 않는다 — 신호는 변경 기록 블록 안에서 **따로 한 번 더 감싼다**(실시간이 막혀도 저장도 되고 변경 기록도 남는다 — 화면은 주기 갱신으로 따라온다).
-- 맞춤이 끝나면(`duty_sync_finish` 성공 · 지운 변경 기록이 있을 때) 같은 채널에 한 번 더 알린다 — 여러 화면이 한꺼번에 받으러 와도 맞추는 것은 하나뿐이라, 나머지는 그때 새 값을 받는다.
-- 그 밖(변경 기록 · 1시간 규칙)은 s2_0051 본문 그대로. 되돌리기: s2_0051의 mark_dirty 본문으로.
-- 연동 역할 실행권 확인: mark_dirty는 트리거 함수 자체(보안 정의자) — 트리거 발화는 쓰는 역할의 실행권을 보지 않는다. 운영 확인 2026-11-10: 트리거 설치 뒤 연동 PC 발송 성공 69건.
begin;

create or replace function duties_private.mark_dirty() returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_rows jsonb[] := array[]::jsonb[];
  v_row jsonb;
  v_val text;
  v_day date;
  v_seen date[] := array[]::date[];
  v_tenant uuid;
  v_ping boolean;
  i int;
begin
  begin
    if tg_op <> 'DELETE' then v_rows := v_rows || to_jsonb(new); end if;
    if tg_op <> 'INSERT' then v_rows := v_rows || to_jsonb(old); end if;
    foreach v_row in array v_rows loop
      if v_row->>'tenant_id' is null then continue; end if;
      v_tenant := (v_row->>'tenant_id')::uuid;
      for i in 1 .. tg_nargs - 1 loop
        if tg_argv[i] = 'now' then v_day := (now() at time zone 'Asia/Seoul')::date;
        else
          v_val := v_row->>tg_argv[i];
          if v_val is null then continue; end if;
          v_day := case when length(v_val) = 10 then v_val::date else (v_val::timestamptz at time zone 'Asia/Seoul')::date end;
        end if;
        if tg_argv[0] = 'monthly' then v_day := date_trunc('month', v_day)::date; end if;
        if v_day = any(v_seen) then continue; end if; -- 바뀌기 전·후가 같은 날이면 한 줄만
        v_seen := v_seen || v_day;
        -- 신호는 같은 날에 2초에 한 번만(방금 적힌 줄이 있으면 이미 보냈다).
        v_ping := not exists (select 1 from public.duty_dirty d
                               where d.tenant_id = v_tenant and d.scope = tg_argv[0] and d.day = v_day
                                 and d.created_at > clock_timestamp() - interval '2 seconds');
        insert into public.duty_dirty (tenant_id, scope, day)
        select v_tenant, tg_argv[0], v_day
         where not exists (select 1 from public.duty_dirty d
                            where d.tenant_id = v_tenant and d.scope = tg_argv[0] and d.day = v_day
                              and d.claimed is null -- 가져간 줄은 곧 지워진다 — 그 줄을 믿고 건너뛰면 맞추는 도중의 저장이 묻힌다
                              and d.created_at < clock_timestamp() - interval '1 hour');
        if v_ping then
          -- 신호만 따로 감싼다 — 실시간이 막혀도 위의 변경 기록은 남아야 한다(같은 블록이면 함께 되돌려진다).
          begin
            perform realtime.send(jsonb_build_object('scope', tg_argv[0]), 'changed', 'duties:' || v_tenant::text, false);
          exception when others then null;
          end;
        end if;
      end loop;
    end loop;
  exception when others then
    null; -- 저장을 막지 않는다 — 놓친 변경은 크론이 맞춘다.
  end;
  return null;
end;
$fn$;
revoke all on function duties_private.mark_dirty() from public, anon, authenticated;

-- 맞춤이 끝났다(s2_0051 본문 + 성공하면 같은 채널에 한 번 더 알린다) — 맞춤 잠금에 져서 맞추기 전 장부를 받은 화면들이 그때 새 값을 받는다.
create or replace function public.duty_sync_finish(p_tenant uuid, p_token uuid, p_ok boolean, p_full boolean) returns boolean
language plpgsql security definer set search_path = public
as $fn$
declare
  v_got uuid;
  v_n int := 0;
begin
  update public.duty_settings set sync_lock_until = null, sync_token = null,
         last_sync_at = case when p_ok and p_full then now() else last_sync_at end, updated_at = now()
   where tenant_id = p_tenant and sync_token = p_token
   returning tenant_id into v_got;
  if v_got is null then return false; end if;
  if p_ok then
    delete from public.duty_dirty where tenant_id = p_tenant and claimed = p_token;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      begin
        perform realtime.send(jsonb_build_object('scope', 'synced'), 'changed', 'duties:' || p_tenant::text, false);
      exception when others then null;
      end;
    end if;
  else update public.duty_dirty set claimed = null where tenant_id = p_tenant and claimed = p_token;
  end if;
  return true;
end;
$fn$;

commit;
