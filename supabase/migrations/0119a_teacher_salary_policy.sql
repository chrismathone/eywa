-- 0119a: 강사 급여 정책 2필드 — 급여 연계 v1(splits→강사 정산). docs/payroll-linkage-plan.md.
--
-- 원장 결정(2026-07-17): 강사별 개별 급여 모델(비율제/급여제/혼합) + 청구 기준(confirmed_amount) 지급.
-- v1은 읽기전용 정산 참고 화면만 — payroll_records 자동기록·PAYROLL_ENABLED 전환은 하지 않는다.
-- 이 2필드는 정산 참고 화면이 splits 확정치에 적용하는 급여 정책일 뿐(계산은 화면에서만, 저장 0).
--
-- 호환성: 둘 다 nullable(기본 null=미설정). 기존 급여 로직(월기본+시급, 비활성)과 무관 — 순수 신규 컬럼.
-- 롤백 = alter table users drop column salary_type, drop column commission_rate.

alter table users
  add column if not exists salary_type text
    constraint users_salary_type_check
    check (salary_type is null or salary_type in ('commission', 'fixed', 'hybrid')),
  add column if not exists commission_rate numeric(5,2)
    constraint users_commission_rate_range
    check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100));

comment on column users.salary_type is
  '급여 방식(0119a): commission=비율제(매출 배분) / fixed=급여제(월기본) / hybrid=혼합 / null=미설정. docs/payroll-linkage-plan.md';
comment on column users.commission_rate is
  '매출 배분율 %(commission/hybrid). confirmed_amount(청구 기준)에 적용. null=미설정.';
