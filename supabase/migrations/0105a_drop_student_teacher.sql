-- 0105a: students.primary_teacher_id / secondary_teacher_id 컬럼 제거(담임/부담임 개념 폐기).
-- (⚠️ 번호: 0104a는 병렬 세션 '강사 멘트 모드' 마이그가 프로덕션에 이미 적용돼 선점 — 이 건은 0105a로.)
-- 인재원은 과목제 — 학생당 담당 강사는 반(classes.teacher_id)별로만 존재한다. 학생당 단일 '담임'은
-- "수업시간 최다 강사" 자동 재계산이라 자의적이었고(영어 학생인데 수학 강사가 담임), 표시/필터/집계에만
-- 쓰였을 뿐 권한/스코프엔 안 쓰였다(RLS·getTeacherScope는 classes.teacher_id 기준). 원장 결정으로 완전 제거.
-- ⚠️ 비가역: 컬럼과 함께 FK·인덱스(students_tenant_primary_teacher_idx) 자동 제거. 값은 자동 파생분이라 손실 무의미.
-- 표시/필터/집계는 전부 과목별 담당 강사(반의 teacher_id)로 대체됨(코드 sweep). RLS 정책 변경 불필요.

drop index if exists students_tenant_primary_teacher_idx;

alter table students drop column if exists primary_teacher_id;
alter table students drop column if exists secondary_teacher_id;
