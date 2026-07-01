-- "지난 동기화가 새로 추가한 항목" 표시용 컬럼을 나머지 동기화 도메인으로 확장(students는 0061a).
-- 각 importer가 신규 insert 시 now()로 세팅, 다음 동기화 성공 시작에 tenant 단위로 NULL 클리어
-- → 목록 ↻ 동기화 배지가 "다음 동기화까지만" 유지된다. 매칭 백필/기존 upsert에는 세팅하지 않는다.
-- (수업 classes는 sync가 신규 반을 insert하지 않으므로[ijw 정본] 대상에서 제외.)
-- RLS는 각 테이블 정책을 그대로 상속(신규 정책 불필요).
alter table enrollment_consultations add column if not exists sync_added_at timestamptz;
alter table invoices              add column if not exists sync_added_at timestamptz;
alter table student_consultations add column if not exists sync_added_at timestamptz;
alter table textbook_catalog      add column if not exists sync_added_at timestamptz;

-- PostgREST 스키마 캐시 리로드(신규 컬럼을 REST/supabase-js에서 즉시 조회 가능하게).
notify pgrst, 'reload schema';
