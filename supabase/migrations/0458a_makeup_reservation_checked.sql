-- 보강 예약 — 선생님이 **보강을 실제로 했는지** 체크한 시각·사람 (원장 2026-10-27)
--
-- 원장: *"보강을 실제로 진행했는지도 선생님이 체크할 수 있도록 해야할듯 보강 예약을 누르면 보강을 했다 안했다 체크"* ·
-- *"이런 보강건에 대해서는 보강체크를 하지 않으면 보고서 발송 비활성화 되고 왜 발송안되었는지도 체크할 수 있게"*.
-- 수학은 하루 한 칸이라 정규 출석 한 번에 예약이 이행(status = done · 시수 반영)된다 — 정규 수업 **뒤** 보강(권민서A 10/27
-- 18:20~19:15)은 16:24 출석에 이미 '이행'이었다. 이행(시수)은 그대로 두고, 사람이 확인한 사실을 따로 남긴다.
--
-- 🔑 값:
--   · checked_at = 선생님이 원스크린 보강 표식에서 '보강 했음'을 누른 시각(이때 아직 이행 전이면 함께 이행한다).
--     '보강 못 했음'은 예약을 지운다(보강분 시수를 빼고 결석은 '보강 안 된 결석'으로 돌아간다 — 감사로그 makeup_reserve_check).
--   · null = 아직 확인 안 함 → 그 보강이 든 보고서(정규+보강 · 보강 줄)는 보내지 않는다(원스크린 발송 게이트 + saveAndQueueClassnote).
--   · checked_by = 확인한 사람.
--
-- ⚠️ 앱은 이 칸이 없어도 돈다(fail-soft) — 칸이 없으면 확인을 요구하지 않는다(종전 동작). 적용하는 순간부터 오늘 보낼
--    보강 보고서는 확인을 거쳐야 나간다.
set local statement_timeout = '60s';

alter table public.makeup_reservations
  add column if not exists checked_at timestamptz,
  -- 🔴 FK를 걸지 않는다 — `on delete set null`의 UPDATE는 0349a 트리거(보강관리 연결 예약 직접 수정 거절)가 통과시키는 칸 목록에
  --    없어, 확인 뒤 연결된 예약의 확인자 계정을 지우면 계정 삭제가 실패한다(적대 리뷰 2026-10-27). 기록용 id라 남아도 된다.
  add column if not exists checked_by uuid;

comment on column public.makeup_reservations.checked_at is
  '선생님이 보강을 실제로 했다고 확인한 시각(원스크린 보강 표식 ''보강 했음'') — null이면 그 보강이 든 보고서는 발송하지 않는다(원장 2026-10-27)';
comment on column public.makeup_reservations.checked_by is
  '보강 확인한 사람';

-- 지난 날짜(KST 오늘 전)의 이행된 예약은 확인된 것으로 채운다 — 적용하는 순간 지난 보고서·재발송이 막히지 않게(7일 지나면 강사가 풀 수
-- 없다 — 적대 리뷰 2026-10-27). 오늘·이후 예약과 이행 전 예약은 비워 둔다(선생님이 확인한다).
-- 🔴 보강관리에 연결된 예약은 건드리지 않는다 — 0349a 트리거가 직접 UPDATE를 거절해 이 SQL 전체가 멈춘다(그 지점은 확인을 쓰지 않는다).
update public.makeup_reservations r
   set checked_at = coalesce(r.done_at, r.updated_at, now())
 where r.status = 'done'
   and r.checked_at is null
   and r.makeup_date < (now() at time zone 'Asia/Seoul')::date
   and not exists (
     select 1 from public.makeup_legacy_maps m
      where m.legacy_kind = 'reservation' and m.legacy_id = r.id and m.state = 'active'
   );
