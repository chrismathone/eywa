-- s2_0068_prep_brief_job_at.sql — 상담 준비 브리프 생성 작업의 시작 시각 · 2026-11-11
--
-- 원장 2026-11-11 *"검수 끝나면 코덱스와 협의해서 바로 고쳐"* — 브리프 적대적 검수(Claude·Codex 합의)에서 나온 운영 결함 둘:
--   ① 'generating'에 멈추면 빠져나갈 길이 없었다(진행바는 화면을 연 뒤 240초를 세는데 '다시 작성' 단추는 생성 중엔 안 그려지고,
--      상태가 저절로 풀리지도 않는다).
--   ② 늦게 끝난 옛 작업이 새 결과를 덮을 수 있었다(저장에 작업 비교가 없다).
-- → 작업을 시작할 때 이 칸에 시각을 적고, 끝날 때 **같은 시각일 때만** 결과·상태를 쓴다(아니면 오래된 작업 — 버린다).
--   화면은 이 시각 기준 240초가 지나면 '다시 작성'을 보이고, 서버는 그때만 새 작업으로 갈아탄다.
-- 추가만(칸 하나 · 기본값 없음 · 기존 행 null). 앱보다 먼저 적용한다(#95 — 새 앱이 이 칸을 읽고 쓴다). 옛 앱은 이 칸을 모른다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0068-prep-brief-job-at.sql(앱을 먼저 되돌린 뒤).

begin;
set local lock_timeout = '5s';

alter table public.enrollment_consultations
  add column if not exists prep_brief_job_at timestamptz;

comment on column public.enrollment_consultations.prep_brief_job_at is
  '사전 브리프 생성 작업의 시작 시각(generating일 때). 끝날 때 같은 값일 때만 결과·상태를 쓴다(오래된 작업이 새 결과를 덮지 않게) · 240초 지나면 다시 작성 허용. s2_0068';

notify pgrst, 'reload schema';
commit;
