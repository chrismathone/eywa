-- #18 검색 색인 — pg_trgm 트라이그램 GIN. 커맨드 팰릿 데이터 검색(학생/수업/상담) 가속.
-- 한국어 부분일치(ILIKE '%q%')용 — tsvector 'simple'은 한국어 부분일치 불가라 트라이그램 채택.
-- 손수 alpha 파일(drizzle 무관). 추가성(확장+색인만, 데이터/스키마 불변) → 저위험.
-- 적용: node --env-file=.env.local 로 raw 실행 (CLAUDE.md "마이그레이션 & 시드").

create extension if not exists pg_trgm;

-- 학생 (이름·학교·학부모명·학부모전화·학생코드)
create index if not exists ix_trgm_students_name on public.students using gin (name gin_trgm_ops);
create index if not exists ix_trgm_students_school on public.students using gin (school gin_trgm_ops);
create index if not exists ix_trgm_students_parent_name on public.students using gin (parent_name gin_trgm_ops);
create index if not exists ix_trgm_students_parent_phone on public.students using gin (parent_phone gin_trgm_ops);
create index if not exists ix_trgm_students_student_code on public.students using gin (student_code gin_trgm_ops);

-- 수업 (반 이름·과목)
create index if not exists ix_trgm_classes_class_name on public.classes using gin (class_name gin_trgm_ops);
create index if not exists ix_trgm_classes_subject on public.classes using gin (subject gin_trgm_ops);

-- 학생상담 (요약)
create index if not exists ix_trgm_student_consultations_summary on public.student_consultations using gin (summary gin_trgm_ops);

-- 등록상담 (예비생명·학부모명·요청)
create index if not exists ix_trgm_enroll_cons_prospect_name on public.enrollment_consultations using gin (prospect_name gin_trgm_ops);
create index if not exists ix_trgm_enroll_cons_parent_name on public.enrollment_consultations using gin (parent_name gin_trgm_ops);
create index if not exists ix_trgm_enroll_cons_parent_request on public.enrollment_consultations using gin (parent_request gin_trgm_ops);
