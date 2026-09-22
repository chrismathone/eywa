-- 0277a — 연차 조정의 **사유를 선택 입력으로**
--
-- 원장 2026-09-21: *"연차관리에 사유없어도 조정기록 되게해줘"*
--
-- 0252a는 사유를 필수로 잠가 뒀다(*"사유 없는 연차 증감은 나중에 아무도 설명하지 못한다"*). 그 걱정 자체는
-- 여전히 맞지만, **적을 말이 없어 조정을 아예 못 하는** 쪽이 더 나쁘다는 것이 원장 판단이다. 그래서 칸은
-- 그대로 두고 **비울 수 있게** 제약만 푼다 — 누가·언제·얼마를 바꿨는지는 행과 감사로그에 그대로 남는다.
--
-- 🔑 컬럼은 여전히 `not null`이고 앱이 **빈 문자열**을 넣는다 — null과 ''이라는 두 가지 "없음"을 만들면
--    조회·표시가 자리마다 갈린다(0252a가 `reason text not null`로 둔 뜻은 지킨다).
-- ⚠️ 앱이 먼저 배포돼도 죽지 않는다([[#95]]): 사유를 적은 저장은 종전대로 통과하고, **빈 사유만** 23514로
--    거절된다 — 그 창에서는 서버가 그 오류를 "0277a를 적용하면 사유 없이 저장됩니다"라는 한글로 옮긴다.
-- ⚠️ 번호는 0272a로 태어났다가 같은 번호를 쓰는 수학 마이그레이션(0272a_math_learning_journey)과 겹쳐
--    비어 있는 0277a로 옮겼다(d5ed9da0의 정리와 같은 이유 — 번호는 병합 직전에 확정한다).
--
-- 롤백(되돌리려면 빈 사유를 먼저 메워야 한다):
--   update public.leave_adjustments set reason = '(사유 없음)' where btrim(reason) = '';
--   alter table public.leave_adjustments
--     add constraint leave_adjustments_reason_present check (btrim(reason) <> '');
set local statement_timeout = '60s';

alter table public.leave_adjustments
  drop constraint if exists leave_adjustments_reason_present;

comment on column public.leave_adjustments.reason is
  '조정 사유 — 0277a에서 **선택**으로 풀었다(원장 2026-09-21). 비우면 빈 문자열로 남는다(null을 쓰지 않는다).';

notify pgrst, 'reload schema';
