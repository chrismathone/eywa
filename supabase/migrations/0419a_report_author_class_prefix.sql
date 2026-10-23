-- 수업보고서 발송 표기. 이름과 함께 본인 설정 액션(service_role)으로만 갱신한다.
-- 기존 계정은 꺼짐. 기존 RLS 및 users 보호 트리거를 변경하지 않는다.
alter table public.users add column if not exists report_class_name_prefix boolean not null default false;
comment on column public.users.report_class_name_prefix is
  '학부모 수업보고서의 표시 이름 앞에 보고서 반명을 붙임. 강사 귀속 teacher_name은 불변.';
