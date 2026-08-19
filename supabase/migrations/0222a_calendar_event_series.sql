-- 0222a — 캘린더 반복 일정(시리즈) 지원
--
-- 원장(2026-08-19): *"일정에서도 반복일정기능도 있자나 그것도 추가해줘"*.
--
-- 🔑 구조 결정: 반복 = **등록 시점 실체화**. 서버 액션이 반복 규칙(매일/매주/격주/매월)을 펼쳐
--    행 N개(상한 60회)를 한 번에 insert하고, 같은 `series_id`(uuid)로 묶는다.
--    RRULE(규칙 저장 + 조회 시 가상 전개)은 비채택 — 단건 수정·삭제가 예외(exdate) 관리를
--    요구해 복잡도가 실익을 넘는다. 실체화면 조회·수정·삭제가 전부 기존 행 단위 그대로다.
--    · 단건 수정 = 그 행만 고침(시리즈 불변) / 전체 삭제 = series_id 일괄 delete.
--    · 시리즈 전체 "수정"은 v1 범위 밖(전체 삭제 후 재등록이 우회로).
--
-- ⚠️ 앱은 이 마이그레이션 없이도 죽지 않는다(#95 expand/contract): 조회는 컬럼 부재 시
--    series_id 없는 select로 재시도하고, 비반복 등록은 series_id 키를 아예 안 보낸다.
--    반복 등록만 "0222a 적용 필요" 한글 안내로 거절된다.
--
-- 롤백: drop index if exists calendar_events_tenant_series_idx;
--       alter table public.calendar_events drop column if exists series_id;
set local statement_timeout = '60s';

alter table public.calendar_events
  add column if not exists series_id uuid;

comment on column public.calendar_events.series_id is
  '반복 일정 묶음 — 같은 반복 등록에서 태어난 회차들이 공유(등록 시점 실체화, 0222a). null = 단발 일정. 규칙(RRULE)은 저장하지 않는다.';

-- "반복 전체 삭제"가 유일한 시리즈 단위 접근 — 단발 일정(null)은 인덱스에 안 담는다.
create index if not exists calendar_events_tenant_series_idx
  on public.calendar_events (tenant_id, series_id)
  where series_id is not null;

notify pgrst, 'reload schema';
