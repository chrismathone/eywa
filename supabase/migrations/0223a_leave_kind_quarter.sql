-- 0223a — 휴가 종류에 반반차(quarter, 0.25일) 추가
--
-- 원장(2026-08-19): 기안 화면 휴가 종류에 *"반반차 추가"*. 연차·반차와 같은 축의 종류 하나를
-- 더 여는 것뿐이라 컬럼은 그대로 두고 **check 제약만 넓힌다**(annual·half → +quarter).
-- 차감 일수(0.25)는 앱 순수함수(src/features/leave/request-days.ts countLeaveDays)가 만든다 —
-- DB는 종류 어휘만 잠근다.
--
-- ⚠️ 앱이 먼저 배포돼도 죽지 않는다([[#95]] expand/contract): 이 마이그 적용 전 반반차 상신은
--    23514(leave_forms_kind_valid)로 거절되고, 앱이 그 제약 이름을 잡아 "0223a 적용 필요" 한글
--    안내를 띄운다(문서 행은 파이프라인이 롤백). 기존 annual·half 데이터는 새 제약을 그대로 통과.
--
-- 롤백: 아래 drop 후 check (leave_kind in ('annual','half')) 재생성(quarter 행이 있으면 먼저 정리).
set local statement_timeout = '60s';

alter table public.leave_forms
  drop constraint if exists leave_forms_kind_valid;

alter table public.leave_forms
  add constraint leave_forms_kind_valid
  check (leave_kind in ('annual', 'half', 'quarter'));

comment on column public.leave_forms.leave_kind is
  '휴가 종류 — annual(연차)·half(반차 0.5일)·quarter(반반차 0.25일, 0223a). 라벨·차감 일수는 앱 단일 소스(request-days.ts).';

notify pgrst, 'reload schema';
