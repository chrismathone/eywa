-- 0064a: 등록상담 "완전 이식"(ijw ConsultationForm 필드 100% 대응) — 누락 컬럼 추가.
--  · counselor        상담자 (접수 정보) — 기존 registrar(등록자)와 별개
--  · received_date    접수일 (편집 가능한 접수일. createdAt 자동 타임스탬프와 별개)
--  · student_type     학생 구분 (예: 예비/재원)
--  · siblings_details 남매 관계 기록 (재원생 여부 등 자유 텍스트)
--  · consultation_date 상담일 (편집 가능한 순수 date. ⚠️ consulted_at[timestamptz, 정렬용 레코드 타임스탬프]에
--                     date 문자열을 쓰면 KST↔UTC 하루밀림·시각 소실이 생겨서, 상담일은 전용 date 컬럼으로 분리한다.)
-- 전부 nullable → 기존 데이터/기능 무영향(메타데이터-only, 즉시).
alter table enrollment_consultations
  add column if not exists counselor text,
  add column if not exists received_date date,
  add column if not exists student_type text,
  add column if not exists siblings_details text,
  add column if not exists consultation_date date;

notify pgrst, 'reload schema';
