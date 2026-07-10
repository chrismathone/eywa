-- 0094a: Edutrix 학생 UUID 매핑 + 보고서 원본 id — 이름-only 이식 fan-out/오배정 방지.
-- 배경: import-lesson-reports·edutrix-sync가 students.name exact만 써서 동명이인에게 보고서 복제.
-- Edutrix 내부 키는 reports.student_id(UUID) → eywa students.edutrix_student_id에 저장 후 이 키로만 이관.
-- lesson_reports.edutrix_report_id = Edutrix reports.id (멱등 증분·재이관).

alter table students
  add column if not exists edutrix_student_id text;

-- 테넌트당 Edutrix 학생 1:1 (null 허용 — 부분 유니크, makeedu_id 0057a 패턴).
create unique index if not exists students_tenant_edutrix_student_id_key
  on public.students (tenant_id, edutrix_student_id)
  where edutrix_student_id is not null;

comment on column public.students.edutrix_student_id is
  'Edutrix public.students.id (UUID 문자열). 수업보고서 이관·cron 매칭 키. 이름 매칭 금지.';

alter table lesson_reports
  add column if not exists edutrix_report_id text;

create unique index if not exists lesson_reports_tenant_edutrix_report_id_key
  on public.lesson_reports (tenant_id, edutrix_report_id)
  where edutrix_report_id is not null;

comment on column public.lesson_reports.edutrix_report_id is
  'Edutrix public.reports.id. source=edutrix_import 멱등 키. 없으면 레거시 이름-이관분.';
