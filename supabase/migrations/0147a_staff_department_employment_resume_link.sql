-- 0147a — 직원 부서·근무형태 컬럼 + 이력서→직원 연결
--
-- 원장 지시(2026-07-28): ① 이력서 저장 시 직원 등록까지 한 번에, ② 구글시트 직원명부 최초 이관,
-- ③ 직원목록 대시보드(근무형태별·부서별 집계). 근무형태·부서는 지금까지 이력서 form_data 안에만
-- 있어 users 집계가 불가했다 — users에 승격한다(이력서·시트 임포트가 채우는 소스).
--
-- department: 근무부서 단일 필드(원장 지정 선택지 — 영어과/수학과/EIE/경영지원팀/개발팀/아르바이트).
--   ⚠️ 선택지는 코드 상수(RESUME_DEPARTMENTS, src/features/staff/resume.ts)가 소스 — 이력서 폼과
--   시트 '소속부서' 열과 같은 축. 운영 enum(과목/학년/직급)과 달리 이력서·인사 전용이라 tenant_settings
--   미편입(소비처가 늘면 설정화 재검토).
-- employment_type: '정규직'|'아르바이트'|'프리랜서' (이력서 EMPLOYMENT_TYPES와 동일). null=미입력.
--
-- academy_documents.staff_user_id: 이력서(form_type='staff_resume') ↔ users 연결. 지금까지 이름
-- 문자열로 사람이 맞추던 것을 FK로 고정 — 이력서 저장 시 직원 등록/기존 직원 연결의 기반.
-- on delete set null: 직원 삭제 시 이력서는 문서로 보존(연결만 해제).

alter table public.users
  add column if not exists department text,
  add column if not exists employment_type text;

comment on column public.users.department is
  '근무부서(이력서/직원명부 시트와 같은 축 — 선택지는 코드 RESUME_DEPARTMENTS). null=미입력.';
comment on column public.users.employment_type is
  '근무형태: 정규직|아르바이트|프리랜서 (이력서 EMPLOYMENT_TYPES). null=미입력.';

alter table public.academy_documents
  add column if not exists staff_user_id uuid references public.users(id) on delete set null;

comment on column public.academy_documents.staff_user_id is
  '직원 이력서(form_type=staff_resume)가 가리키는 직원(users.id). 이력서 저장 시 직원 등록/연결로 설정.';

create index if not exists academy_documents_staff_user_idx
  on public.academy_documents (staff_user_id) where staff_user_id is not null;
