-- 보강 예약 — 보고서를 정규 보고서와 **함께**(합침) 보낼지 **따로**(분리) 보낼지 (원장 2026-10-22)
--
-- 원장: *"사전에 보강 예약할때 '보강 추가'와 동일하게 보고서를 함께 발송할지 따로 발송할지 코드를 맞출것"*.
-- '+ 보강 학생 추가'는 그날 정규 수업이 있으면 합침(정규+보강 · 보고서 1건)/분리(보강 보고서 따로 · 2건)를 묻는다
-- (makeup-confirm-dialog.tsx ③). 예약은 그 질문 없이 정규 줄에 조용히 합쳐졌다(전주율 10/22 — 원스크린에 표식도 없었다).
--
-- 🔑 값:
--   · 'merge'    = 그날 정규 보고서에 합친다 — 원스크린 정규 줄이 '정규+보강'(제목 "(정규+보강)")으로 선다.
--   · 'separate' = 보강 보고서를 따로 — 원스크린에 '(보강)' 줄이 따로 선다(앵커 = 이 예약의 반).
--   · null       = 묻지 않은 예약(이 칸 전의 예약 · 보강일이 그 학생의 정규 수업일이 아닌 예약). 정규 수업일이면 'merge'로 읽는다
--                  (이 칸 전의 예약이 실제로 그렇게 돌았다 — 시수가 정규 칸에 합쳐졌다).
-- 시수는 어느 쪽이든 그 반 그날 칸 하나에 얹는다(보강 추가의 분리도 같다 — 정규 칸에 시수, 보고서만 따로).
--
-- ⚠️ 앱은 이 SQL 적용 **뒤에** 배포한다([[#95]]). 그래도 원스크린 조회는 이 칸이 없으면 칸 없이 다시 읽는다(fail-soft).
set local statement_timeout = '60s';

alter table public.makeup_reservations
  add column if not exists report_mode text
  constraint makeup_reservations_report_mode_chk check (report_mode is null or report_mode in ('merge', 'separate'));

comment on column public.makeup_reservations.report_mode is
  '보고서 발송 방식 — merge(정규와 합침 · 정규+보강 1건) / separate(보강 보고서 따로) / null(묻지 않음 — 정규 수업일이면 merge로 읽는다)';
