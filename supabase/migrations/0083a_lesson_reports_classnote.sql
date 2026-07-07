-- 0083a: lesson_reports ClassNote 발송 큐 + 과목별 dedup (Edutrix 발송 이식 P3).
-- 발송단위=과목별. 강사가 원스크린에서 "ClassNote 발송" → status=queued → 로컬 워커가 폴링·게시.
-- ⚠️ edutrix 2026-05~06 과거보고서 오발송 사고 → too_old 가드(전 달 1일 이후만)는 앱단(classnote-guard.ts)에서.

-- subject: 과목별 1행 식별(현재는 progress 텍스트에만 과목명). nullable — 레거시 임포트행은 null.
alter table lesson_reports add column if not exists subject text;

-- (student, date, subject) 1행 강제 — DB 제약으로 레이스 방지(액션 로직만으론 동시요청에 중복 생성 가능).
-- ⚠️ 전체 유니크(부분 WHERE 아님): Supabase .upsert(onConflict)는 부분 인덱스를 타겟 못 잡는다.
-- nulls distinct(기본)라 subject=null(레거시 임포트 3523행)은 서로 충돌 안 함 → 자동 제외. 실 유효는 non-null subject.
drop index if exists lesson_reports_student_date_subject_key;
create unique index if not exists lesson_reports_student_date_subject_key
  on lesson_reports (tenant_id, student_id, report_date, subject);

-- ClassNote 발송 상태머신. NULL = "ClassNote 미요청"(기존/일반 행 기본). 명시 상태만 요청 시.
alter table lesson_reports add column if not exists classnote_status text;        -- queued/processing/success/failed/too_old
alter table lesson_reports add column if not exists classnote_error text;
alter table lesson_reports add column if not exists classnote_queued_at timestamptz;
alter table lesson_reports add column if not exists classnote_processing_at timestamptz; -- stale 복구 기준(>10분 → 재큐잉)
alter table lesson_reports add column if not exists classnote_sent_at timestamptz;
-- retry_count: NOT NULL DEFAULT 0(상수 default라 메타데이터만, 재작성 없음).
alter table lesson_reports add column if not exists classnote_retry_count int not null default 0;

-- queued 폴링 워커용 부분 인덱스(쿼리 모양 일치: status='queued' ORDER BY queued_at).
create index if not exists lesson_reports_classnote_queued_idx
  on lesson_reports (tenant_id, classnote_queued_at, id)
  where classnote_status = 'queued';
