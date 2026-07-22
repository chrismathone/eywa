-- 0134a: 회차 **이월(carryover)** 기록 — "결석분을 다음 달 보강으로 받아가는" 흐름(원장 2026-07-22).
--
-- 배경(원장 규칙): 보강은 **실제 수업한 달**로 차수가 간다. 5월 8회 예정·1회 결석이면 5월은 7회가 최대치,
--   6월은 8회 + 5월 보강 1회 = 9회분을 받아간다.
-- 그런데 청구서는 그대로 두므로(5월 8회분 이미 수납) 6월 청구는 8회다 → 급여 상한 `min(실측, 청구)`가
--   6월 9회째를 8로 깎아 **강사가 1회 손해**를 본다(학생은 16 청구/16 수업으로 정상 → 손해는 강사 쪽에만).
--
-- ⚠️ 원장 제약(불변): **"더한 수업이 절대 급여에 포함되어서는 안 된다 — 학원의 명백한 손해."**
--   그래서 급여 상한을 올릴 수 있는 **유일한 근거는 '기록된 이월'**이다(= 학원이 이미 받은 돈).
--   기록 없는 초과 수업은 지금처럼 상한에 잘린다. 이로써 `총지급 ≤ 총수납`이 구조적으로 보장된다.
--
-- 이 마이그레이션은 **기록만** 추가한다(1단계). 급여 상한이 실제로 이월을 소비하는 것은 2단계이며
-- 그때는 돈 산식 변경이라 골든마스터 게이트를 다시 통과해야 한다.
-- 롤백 = alter table ... drop column carryover_out, drop column carryover_in.

-- ⚠️ 컷오버(26.06→26.07) 예외: 6월은 eywa에 `invoice_session_terms` 행이 **0건**이라 넘길 원본이 없다.
--   그래서 `carryover_in`은 대응 `carryover_out` 행을 **DB 제약으로 요구하지 않는다**(요구하면 컷오버가 막힘).
--   구조적 가드를 못 거는 대신 **감사기록(carryover_by/at/note)을 필수 보완장치**로 둔다 —
--   급여 상한을 올리는 크레딧은 전부 "누가·언제·왜"가 남는다. 컷오버 이후 달은 UI가 이전 달 부족분을 상한으로 검사한다.
alter table public.invoice_session_terms
  add column if not exists carryover_out integer not null default 0,
  add column if not exists carryover_in integer not null default 0,
  add column if not exists carryover_by uuid references public.users (id),
  add column if not exists carryover_at timestamptz,
  add column if not exists carryover_note text;

comment on column public.invoice_session_terms.carryover_out is
  '이 달 미달분(청구>실측) 중 **다음 달로 넘긴** 회차. 0=이월 없음(소멸). 넘길 수 있는 최대치는 그 달 부족분(0134a).';
comment on column public.invoice_session_terms.carryover_in is
  '전 달에서 **받아온** 회차. 급여 상한을 이만큼 올릴 근거(= 이미 수납된 돈). 기록 없는 초과분은 지급 금지(0134a).';
comment on column public.invoice_session_terms.carryover_note is
  '이월 사유(감사). 컷오버처럼 원본 행이 없는 주입은 여기에 근거를 남긴다(0134a).';

-- 음수 금지 — 이월이 급여 상한을 올리는 근거라 음수는 곧 잘못된 지급 허가가 된다.
alter table public.invoice_session_terms
  drop constraint if exists invoice_session_terms_carryover_nonneg;
alter table public.invoice_session_terms
  add constraint invoice_session_terms_carryover_nonneg
  check (carryover_out >= 0 and carryover_in >= 0);
