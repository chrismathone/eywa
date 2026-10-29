-- s2_0010 — 오늘수학 내보내기 스냅샷: 새로 만들 때 만료 1시간 지난 것을 지운다 (2026-10-29)
--
-- 왜: 원장 *"쓸데 없는 메모리 사용처 전부 확인하고 메모리 확보"* — DB 메모리 부족 정지(10-29 19:02~19:10) 조사에서
--     `tm_sync_private.pages`가 360MB(DB의 1/3)였다. 스냅샷은 15분 뒤 만료되고 만료분은 아무도 읽지 않는데(`tm_sync_snapshot_page`가
--     expires_at>지금만 읽는다) 지우는 곳이 없어 하루 300개 넘게 쌓였다. 10-29 손 정리: 만료 1시간 지난 289개 삭제 + VACUUM FULL →
--     360MB → 29MB(목록 백업 D:\tmp\tm-sync-cleanup\).
-- 무엇: `tm_sync_create_snapshot` 안 insert 바로 앞에 그 연결의 만료 1시간 지난 스냅샷 삭제 한 줄(페이지는 FK cascade).
--     본문은 운영 함수 그대로(그 줄 1건 확인 뒤 치환 · 0369a·s2_0009와 같은 방식). 1시간 여유 = 진행 중인 가져가기를 끊지 않게.
-- 되돌리기 = scripts/_oneoff/revert-s2_0010-tm-sync-prune-expired-snapshots.sql

do $$
declare
  definition text;
  needle text := 'insert into tm_sync_private.snapshots(id,binding_id,manifest,expires_at)';
  prune text := 'delete from tm_sync_private.snapshots where binding_id=p_binding_id and expires_at < ts - interval ''1 hour''; ';
begin
  select pg_get_functiondef('public.tm_sync_create_snapshot(uuid)'::regprocedure) into definition;
  if position(prune in definition) > 0 then raise notice 's2_0010: 이미 적용됨'; return; end if;
  if (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 then
    raise exception 's2_0010: tm_sync_create_snapshot에서 바꿀 줄이 하나가 아닙니다';
  end if;
  execute replace(definition, needle, prune || needle);
end $$;
