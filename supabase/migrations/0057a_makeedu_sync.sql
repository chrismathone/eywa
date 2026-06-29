-- 0057a: makeedu 동기화 외부키 — makeedu(school.makeedu.co.kr, 인재원) → eywa 단방향 동기화의 멱등 매칭 앵커.
-- makeedu의 모든 목록에 안정적 고유 No가 있어, 그 값을 eywa 신규 외부키 컬럼에 저장해 makeedu_id로 멱등 upsert한다.
-- 동기화 7대상 중 5개에 외부키 신설(나머지 2개는 기존 자연키 재사용):
--   · students            ← 원생고유번호(예 09327)   ⚠️ student_code와 분리(ijw studentCode 충돌 방지)
--   · classes             ← 수업 No(예 147)
--   · enrollment_consultations ← 예비원생 No(예 725)
--   · student_consultations    ← 상담 No(예 5046)
--   · textbook_catalog    ← 단가표 No(예 170)
--   · invoices    = 기존 자연키 (tenant_id, student_id, period) 유니크 재사용(makeedu 라인 → 학생×청구월 집계)
--   · enrollments = 자연키 (student_id, class_id)
-- 전부 nullable(기존/eywa-only 행은 NULL) + 부분 유니크 (tenant_id, col) WHERE col IS NOT NULL
--   (테넌트 격리 + NULL 다중 허용). RLS는 기존 tenant_isolation 정책 그대로 커버.

alter table students                 add column if not exists makeedu_id text;
alter table classes                  add column if not exists makeedu_lesson_id text;
alter table enrollment_consultations add column if not exists makeedu_id text;
alter table student_consultations    add column if not exists makeedu_id text;
alter table textbook_catalog         add column if not exists makeedu_id text;

create unique index if not exists ux_students_makeedu
  on students (tenant_id, makeedu_id) where makeedu_id is not null;
create unique index if not exists ux_classes_makeedu_lesson
  on classes (tenant_id, makeedu_lesson_id) where makeedu_lesson_id is not null;
create unique index if not exists ux_enrollment_consultations_makeedu
  on enrollment_consultations (tenant_id, makeedu_id) where makeedu_id is not null;
create unique index if not exists ux_student_consultations_makeedu
  on student_consultations (tenant_id, makeedu_id) where makeedu_id is not null;
create unique index if not exists ux_textbook_catalog_makeedu
  on textbook_catalog (tenant_id, makeedu_id) where makeedu_id is not null;
