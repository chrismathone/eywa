-- 0132a: 반별 급여 설정에 **적용 요일** — "그 반의 주말 수업분만 비율제" 케이스(원장 2026-07-21).
--
-- 배경: 이성우 선생님은 **주말만 비율제**인데, 담당 반 `고등M 고1 BS4F 토`가 **토+수 복합**이라
--   반 단위로는 갈리지 않는다(반 하나에 주말·평일 수업이 섞여 있음). 원장 확정:
--   *"해당 반의 주말 수업분만 비율제로 계산함."*
-- 그래서 반별 설정에 적용 요일을 두고, 정산 때 **그 요일 시수 비중만큼만** 지급 기준액을 인정한다.
-- null = 전 요일(기존 동작 그대로). 롤백 = alter table ... drop column applies_dows.

alter table public.class_salary_settings
  add column if not exists applies_dows text[];

comment on column public.class_salary_settings.applies_dows is
  '비율제가 적용되는 요일(sun~sat). null=전 요일. 값이 있으면 그 요일 시수 비중만큼만 지급 기준액으로 인정(0132a).';

-- 값 검증: 아는 요일 키만(오타로 조용히 0 비중이 되는 것 방지).
alter table public.class_salary_settings
  drop constraint if exists class_salary_settings_dows_check;
alter table public.class_salary_settings
  add constraint class_salary_settings_dows_check
  check (
    applies_dows is null
    or (
      array_length(applies_dows, 1) between 1 and 7
      and applies_dows <@ array['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']::text[]
    )
  );
