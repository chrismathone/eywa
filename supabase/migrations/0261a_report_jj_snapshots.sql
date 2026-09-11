-- 0261a — 영어 보고서에 실린 **인재원 자료의 동결본**(보고서 한 장당 한 행)
--
-- 사용자 2026-09-11: *"템플릿에도 시험 친 결과지, 학습분석지 이렇게 넣을 수 있게 … 사용자가 직접 넣는 게 아니라
-- 우리가 위치에 넣을 거라고 지정해 놓으면 백에서 돌아서 들어가는 게 맞음"*.
-- 영어 템플릿 글(`lesson_reports.notes`) 안의 `[시험결과지]`·`[학습분석지]` 줄 자리에 학부모 카드(/r·PDF·ClassNote 캡처)가
-- 그림을 그린다. 그 그림의 재료가 이 표다 — **보고서를 저장할 때** 서버가 인재원 5번 입구(하루치)로 받아 둔다.
--
-- 🔑 인재원 데이터를 eywa에 복제·동기화하는 표가 **아니다**(그건 결정 로그가 금지한다). 인재원 설명서 ⑤가 요구하는
--    "보내는 순간 받은 JSON을 보고서와 함께 저장" 그 자체다 — 나중에 /r을 열어도 같은 그림이 보이고, 인재원이
--    꺼져 있어도 이미 보낸 보고서는 그대로 열린다. 보고서를 다시 저장할 때만 새로 받고, 보낸 뒤엔 보고서가 잠겨 그대로다.
-- 🔴 읽기·쓰기 정책을 두지 않는다 — 서버(service_role)만 읽고 쓴다([[#104]] 규약: admin 클라이언트 + tenant_id 명시 필터).
--    학부모 공개 /r도 서버가 admin으로 읽는다. 정책 0개는 **의도적**이다([[#92]]).
-- 🔴 유니크에 WHERE를 붙이지 않는다([[#113]]) — 기본키가 곧 upsert 축이다.
-- ⚠️ 앱은 이 표가 **없어도 돌아간다**([[#95]]) — 저장은 그림 없이 성공하고, 카드는 그림 자리를 비운다.
--    원스크린 첫 화면·/r의 lesson_reports 조회에는 이 표를 섞지 않는다(따로 읽는다).
--
-- 롤백: drop table if exists public.report_jj_snapshots;
set local statement_timeout = '60s';

create table if not exists public.report_jj_snapshots (
  -- 보고서 한 장 = 한 행. 보고서를 지우면 함께 지운다.
  lesson_report_id uuid primary key references public.lesson_reports(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 받을 때의 인재원 짝(학생 짝이 나중에 바뀌어도 이 보고서가 누구 자료였는지 남는다).
  ijw_student_id text not null,
  report_date date not null,
  -- { v:1, date, ijwId, fetchedAt, study, exams[] } — 모양은 src/features/ijw/snapshot.ts 한 곳.
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

comment on table public.report_jj_snapshots is
  '영어 보고서에 실린 인재원 자료 동결본(보고서당 1행, 저장 때 받음). 복제·동기화 표 아님. 서버 전용(정책 0개 = 의도). 0261a';

create index if not exists report_jj_snapshots_tenant_idx
  on public.report_jj_snapshots (tenant_id, report_date);

alter table public.report_jj_snapshots enable row level security;

notify pgrst, 'reload schema';
