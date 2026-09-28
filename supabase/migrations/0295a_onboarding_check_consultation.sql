-- 0295a — 신규생 체크 ↔ 원생상담 연결 (반자동)
--
-- 원장 2026-09-28: *"사용자가 상담 등록할때, 학생을 지정할거 아냐? 그럼 지정된 학생이 90일 관리 학생이면
-- 자동연동되는 방향이 낫겟다. 반자동으로"* → 상담 등록·수정 화면에서 그 학생이 신규생이면 '신규생 관리'
-- 칸(사전 콜·첫 수업 후 콜·1·2·3개월 콜)을 고르게 하고, 저장하면 그 칸이 완료되며 **어느 상담으로 체크했는지**를
-- 이 컬럼에 남긴다. makeedu에서 넘어온 상담은 지금처럼 데스크가 손으로 체크한다(원장 선택 1번 — AI 판정 없음).
--
-- 🔴 **추가만 한다(expand)** — 앱은 이 SQL이 돌기 전에도 산다([[#95]]): 컬럼을 못 쓰면 연결 없이 체크만 한다.
-- 🔑 상담을 지우면 앱이 먼저 그 상담으로 한 체크를 해제하고, FK는 `set null`로 기록 행을 남긴다
--    (처리자·메모를 지우지 않는 0251a의 해제 규약과 같다).
-- ⚠️ `consultation_call_labels`는 같은 날 먼저 시험한 AI 판정안의 표다(main에 올라간 적 없음, 0행) — 걷는다.
set local statement_timeout = '60s';

drop table if exists public.consultation_call_labels;

alter table public.student_onboarding_checks
  add column if not exists consultation_id uuid
    references public.student_consultations(id) on delete set null;

comment on column public.student_onboarding_checks.consultation_id is
  '이 체크를 만든 원생상담(0295a) — 상담 등록·수정 화면에서 신규생 관리 칸을 고른 경우. 손 체크는 null.';

-- 상담 수정·삭제가 "이 상담으로 한 체크"를 찾는다.
create index if not exists student_onboarding_checks_consultation_idx
  on public.student_onboarding_checks (consultation_id) where consultation_id is not null;

notify pgrst, 'reload schema';
