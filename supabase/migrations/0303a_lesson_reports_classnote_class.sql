-- 0303a — 수업보고서 'ClassNote로 보낼 반' (2026-09-29, 원장 A안 — "보낼 곳이 없으면 '선택'").
--
-- 왜: 수학 반별 발송(보고서 설정 '수학 발송 경로')은 보고서의 반 = ClassNote 반 보드로 보낸다. 그런데 보강 보고서는
--     반(class_id)이 비어 있다(0171a — class_id에 넣으면 unit_key가 같은 반 정규 보고서와 겹쳐 서로 덮어쓴다).
--     그래서 "어느 반 보드로 보낼지"를 **따로** 적는다. 기본값 = 그 학생의 메인 수업(보고서가 가장 많이 나간 반 →
--     동률이면 출결이 가장 많은 반, 서버가 정한다) · 정할 수 없으면 강사가 원스크린에서 고른다.
-- 🔴 unit_key(=coalesce(class_id, subject))에 **넣지 않는다** — 발송 대상일 뿐 보고서의 단위가 아니다.
-- 앱은 이 칸이 없어도 산다([[#95]]) — 반별 발송 대상 보강 보고서만 "보낼 반을 저장하지 못했습니다"로 멈추고,
--     워커는 칸이 있는지 확인한 뒤에만 읽는다(없으면 종전대로 1인 보드).

alter table public.lesson_reports
  add column if not exists classnote_class_id uuid references public.classes(id) on delete set null;

comment on column public.lesson_reports.classnote_class_id is
  'ClassNote 반별 발송 대상 반(반 정보 없는 보강 보고서용). unit_key에 절대 넣지 말 것 — 발송 대상일 뿐 보고서 단위가 아니다.';

notify pgrst, 'reload schema';
