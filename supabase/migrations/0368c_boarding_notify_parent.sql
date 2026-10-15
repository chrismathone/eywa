-- 0368c — 탑승 기록의 **학부모 알림 여부** (사용자 2026-10-07 "저장은 전송이랑 같은 기능인데 알람 푸시를 끄고 디비에 저장만")
--
-- 셔틀 '오늘 등하원' 등원 줄에 [전송]과 [저장] 두 문이 있다:
--   [전송] = 기록 + 학부모에게 "아이가 지금 차량을 탔습니다" 알림(0368b)  → notify_parent = true
--   [저장] = 기록만, 알림 없음                                           → notify_parent = false
-- 🔑 기본값 true — 이 칸이 생기기 전 기록과 하원 [전송]은 종전대로 알림 대상이다(하원 기록은 애초에 탑승 알림이 아니다).
-- 🔑 같은 줄을 다시 [전송]하면 덮어써 true가 된다(recordBoarding이 매번 이 칸을 같이 보낸다).
--
-- 되돌리기:
--   alter table public.shuttle_boardings drop column if exists notify_parent;

set local statement_timeout = '60s';

alter table public.shuttle_boardings
  add column if not exists notify_parent boolean not null default true;

comment on column public.shuttle_boardings.notify_parent is
  '학부모 탑승 알림 대상인가(0368c) — [전송]=true · [저장]=false(기록만).';

notify pgrst, 'reload schema';
