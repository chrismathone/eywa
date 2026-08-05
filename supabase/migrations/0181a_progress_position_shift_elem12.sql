-- 0181a — 진도 글로벌 위치 +130 시프트 (초1·초2 커리큘럼 신설, 2026-08-05).
--
-- 배경: 진도 위치(`progress_containers.start_position`/`last_position`, `progress_events.global_position`/
-- `from_position`/`to_position`)는 **커리큘럼을 학년순으로 flatten한 1-based 인덱스**다
-- (`src/features/progress/curriculum-position.ts`). 즉 **커리큘럼 앞쪽에 학년을 끼워 넣으면 이미 저장된
-- 숫자가 통째로 다른 차시를 가리킨다.**
--
-- 2026-08-05 원장 요청으로 **초1·초2를 맨 앞에 신설**(130차시) → 초3 이후 모든 차시가 +130 밀렸다.
-- 실측 대상: progress_containers 266행 · progress_events 1,236행(전부 초3 이상 = 시프트 대상).
-- 컨테이너의 `max_jump`·`chapter_count`는 **차이값**이라 시프트해도 불변 → 건드리지 않는다.
--
-- 🔴 **재실행 금지 성질의 데이터 마이그레이션**이다(두 번 돌면 +260). alpha는 `pnpm db:alphas`가
--    전부 재실행하므로 반드시 멱등이어야 한다 → 아래 `migration_data_marks` 원장(ledger)으로 1회만 수행.
--    신규 DB(행 0건)에서는 어차피 no-op이고, 마크만 남는다.
--
-- 대안(재백필)도 가능하지만 채택하지 않았다: `scripts/backfill-progress.mts`는 report 텍스트에서
-- 위치를 다시 계산하므로 정확하지만, 옛 컨테이너를 지우고 다시 만들지 않는 한 **옛 숫자와 새 숫자가
-- 섞인다**. 산술 시프트는 대상이 전부 동일 오프셋이라 정확하고 되돌리기도 쉽다(-130).

-- 데이터 전용(1회성) 마이그레이션의 적용 여부를 기록하는 원장.
-- 테넌트 데이터가 아니라 **인프라 메타**라 tenant_id가 없다 → RLS를 켜되 정책을 두지 않아
-- authenticated/anon에는 전면 차단(service_role·소유자만 접근)한다.
create table if not exists migration_data_marks (
  key text primary key,
  note text,
  applied_at timestamptz not null default now()
);
alter table migration_data_marks enable row level security;

do $$
declare
  v_shift constant integer := 130;   -- 초1(57) + 초2(73). curriculum-position.test.ts의 ELEM12_LESSONS와 동일해야 한다.
  v_containers integer;
  v_events integer;
begin
  insert into migration_data_marks (key, note)
  values ('0181a_progress_position_shift_elem12', '초1·초2 신설로 진도 글로벌 위치 +130')
  on conflict (key) do nothing;

  if not found then
    raise notice '0181a: 이미 적용됨 — 시프트를 건너뜁니다.';
    return;
  end if;

  update progress_containers
     set start_position = start_position + v_shift
   where start_position is not null;
  get diagnostics v_containers = row_count;

  update progress_containers
     set last_position = last_position + v_shift
   where last_position is not null;

  update progress_events
     set global_position = global_position + v_shift
   where global_position is not null;
  get diagnostics v_events = row_count;

  update progress_events
     set from_position = from_position + v_shift
   where from_position is not null;

  update progress_events
     set to_position = to_position + v_shift
   where to_position is not null;

  raise notice '0181a: 진도 위치 +% 시프트 완료 (containers %, events %)', v_shift, v_containers, v_events;
end $$;
