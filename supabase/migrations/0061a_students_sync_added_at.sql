-- "지난 동기화가 새로 추가한 학생" 표시용 컬럼 (학생목록의 ↻ 동기화 배지).
-- makeedu 동기화가 학생을 **신규 insert할 때만** now()로 세팅한다. 그리고 다음 동기화가 성공하면
-- 그 실행 시작에 (tenant 단위로) 전부 NULL로 클리어한 뒤 새 insert에 다시 세팅한다
-- → 라벨이 "다음 동기화까지만" 유지되고, 다음 동기화 성공 시 사라진다.
-- 매칭 백필(기존 ijw 학생에 makeedu_id 연결)에는 세팅하지 않는다 = "추가된 항목"만 대상.
-- RLS는 students 테이블 정책을 그대로 상속(신규 정책 불필요).
alter table students add column if not exists sync_added_at timestamptz;

-- PostgREST 스키마 캐시 리로드(신규 컬럼을 REST/supabase-js에서 즉시 조회 가능하게).
notify pgrst, 'reload schema';
