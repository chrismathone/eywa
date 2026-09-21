-- 0276a — 원장이 지정한 보고서는 발송 기한(오늘 포함 7일)을 넘어도 보낸다
--
-- 원장(2026-09-21, 김지유A 9/11 보고서): *"3건 전부 발송."* → *"앞으로도 내가 예외로 지정하는건은 기한 지난것도 발송."*
-- 7일 규칙(2026-07-28 "학부모가 일주일이 지났는데 이전 보고서를 받는 것도 비합리적")은 **그대로**다.
-- 바뀌는 것은 하나 — 원장이 **건마다** 지정한 행만 그 창 밖에서도 워커가 집는다.
--
-- 🔑 표시는 행에 남긴다(설정 명단이 아니라) — 누가 언제 지정했는지는 감사로그(`classnote_resend`, via=deadline_exempt)가
--    갖고, 이 칸은 워커가 매 폴 읽는 판정 재료다. 지정 경로 = `scripts/_reports/resend-past-deadline.mts`(드라이런 기본).
-- ⚠️ 워커(scripts/_classnote/classnote-core.mjs)는 이 칸이 없으면 예외 절을 빼고 종전대로 돈다 — 적용 순서가 바뀌어도
--    발송이 멈추지 않는다(#95). 앱 화면·발송 콘솔의 7일 판정(`isClassnoteAllowed`)은 손대지 않았다.
-- nullable·기본값 없음 = 카탈로그만 바뀌는 ADD COLUMN(행 재작성 없음). 롤백은 스크립트·기억에만 둔다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.lesson_reports
  add column if not exists classnote_deadline_exempt_at timestamptz;

comment on column public.lesson_reports.classnote_deadline_exempt_at is
  '원장이 지정한 발송 기한 예외(0276a) — 값이 있으면 7일 창 밖이어도 ClassNote 워커가 발송한다. 지정 기록은 감사로그.';
