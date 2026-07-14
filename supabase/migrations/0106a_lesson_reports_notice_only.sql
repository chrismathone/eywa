-- 0106a: lesson_reports.notice_only — 리포트카드 '공지사항 모드' 전용 플래그.
-- true면 학부모 카드가 헤더 + '학부모 전달 내용'(notes/멘트)만 렌더(학생정보·진도·평가·추이·첨부 숨김),
-- 제목 "[공지사항] 작성일". 진도·점수 등 구조화 필드는 저장 단계에서 null로 강제(saveLessonReport 가드).
-- ⚠️ 이름 혼동 주의 — 무관한 3가지:
--    · users.report_notice_mode(0104a) = 강사 AI 멘트 모드(단일 A / 2문단 B)
--    · classnote_notices(0099a)         = 반 공지 자유텍스트 별도 테이블
--    이 컬럼은 lesson_reports 행 단위 '멘트만 발송' 렌더 플래그로 위 둘과 무관.
-- 안전성: 상수 default(false)라 PG11+ 메타데이터-온리 변경(테이블 재작성 없음). injaewon 프로덕션 + edutrix 대량행 안전.

ALTER TABLE public.lesson_reports
  ADD COLUMN IF NOT EXISTS notice_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lesson_reports.notice_only IS
  '공지사항 모드: true면 리포트카드가 헤더+학부모전달(notes)만 렌더. 진도/점수는 저장 시 null 강제. per-report 플래그(0106a).';
