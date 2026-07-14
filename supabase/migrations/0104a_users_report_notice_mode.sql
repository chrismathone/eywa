-- 0104a — 강사별 AI 멘트 공지 모드 오버라이드
-- report.noticeMode(학원 기본, tenant_settings)를 강사 개인이 덮어쓸 수 있게 users에 nullable 컬럼 추가.
-- null = 학원 기본 따름. 'A'=단일 문단, 'B'=2문단 분리.
-- 소비: generateReportComment(강사값 > 학원기본 > 'A'). 쓰기: setMyNoticeMode(본인 행만, admin client).
-- RLS 무변경: 읽기는 본인 users 행 self-select(기존 정책), 쓰기는 service_role(admin client)로 user.id 스코프.

alter table public.users
  add column if not exists report_notice_mode text
  check (report_notice_mode is null or report_notice_mode in ('A', 'B'));
