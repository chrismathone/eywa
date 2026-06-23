-- 0046a: enrollment_consultations 등록 상담 폼 전체 필드 (ijw ConsultationForm 이식)
-- 메인 ~25컬럼 + 과목별 점수 탭은 subject_details jsonb 한 컬럼에. 상담내용=기존 parent_request 재사용.
-- RLS는 enrollment_consultations 기존 tenant_isolation 정책 상속(신규 정책 불요). 멱등.

alter table public.enrollment_consultations
  add column if not exists english_name text,
  add column if not exists gender text,
  add column if not exists blood_type text,
  add column if not exists birth_date date,
  add column if not exists student_phone text,
  add column if not exists home_phone text,
  add column if not exists parent_relation text,
  add column if not exists address text,
  add column if not exists zip_code text,
  add column if not exists address_detail text,
  add column if not exists consultation_path text,
  add column if not exists subject text,
  add column if not exists career_goal text,
  add column if not exists siblings text,
  add column if not exists safety_notes text,
  add column if not exists shuttle_bus_request boolean not null default false,
  add column if not exists registration_status text,
  add column if not exists payment_amount numeric(12,0),
  add column if not exists payment_date date,
  add column if not exists registrar text,
  add column if not exists privacy_agreement boolean not null default false,
  add column if not exists installment_agreement boolean not null default false,
  add column if not exists follow_up_date date,
  add column if not exists follow_up_content text,
  add column if not exists non_registration_reason text,
  add column if not exists subject_details jsonb;
