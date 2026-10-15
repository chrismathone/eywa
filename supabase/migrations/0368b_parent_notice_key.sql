-- 0368b — 학부모 알림 확인 표식에 **알림 종류** 축 추가 (사용자 2026-10-07 "아이가 지금 차량을 탔습니다")
--
-- 0368a는 '차량 출발' 한 가지라 (날짜·회차)면 충분했다. 등원 **탑승** 알림은 아이마다 따로 뜬다
-- (형제가 같은 차를 타도 각자 다른 정류장에서 다른 시각에 탄다) → (날짜·회차·알림 키)로 넓힌다.
--   notice_key = 'depart'            차량 출발(0368a 기존 줄 — 기본값으로 그대로 이어진다)
--              = 'board:<학생 id>'   그 아이 등원 탑승
--
-- 되돌리기:
--   drop index if exists public.parent_departure_acks_uniq;
--   delete from public.parent_departure_acks where notice_key <> 'depart';
--   alter table public.parent_departure_acks drop column if exists notice_key;
--   create unique index parent_departure_acks_uniq on public.parent_departure_acks (tenant_id, parent_account_id, ran_on, run_id);

set local statement_timeout = '60s';

alter table public.parent_departure_acks
  add column if not exists notice_key text not null default 'depart';

-- 🔴 부분 유니크(WHERE) 금지 — 이 축으로 upsert한다([[#113]]).
drop index if exists public.parent_departure_acks_uniq;
create unique index if not exists parent_departure_acks_uniq
  on public.parent_departure_acks (tenant_id, parent_account_id, ran_on, run_id, notice_key);

notify pgrst, 'reload schema';
