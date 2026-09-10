-- 0254a — 자리(랩실) 출석부 **배치**(드래그로 옮긴 자리) + 초기화
--
-- 원장 2026-09-10: *"드래그로 학생 이동할수 있게 /seat/lab 에서. 대신 이것도 감사로그에 남아야함.
-- 클릭으로 출결되는거랑 중복액션되지않게 잘 분리해서"* → *"'초기화' 기능으로 원상태로 돌아갈 수 있게
-- 드래그한것을"* → *"반별 '초기화' 단체 '초기화'"*.
--
-- 🔴🔴 **이 표는 출결이 아니다.** 랩실 603호엔 같은 시각에 여러 반이 함께 들어와서(실측 최대 5개 반 32명)
--    아이가 제 반 묶음이 아닌 옆 묶음에 앉는 일이 생긴다. 여기 담는 건 **그 자리·그 날짜·그 교시에
--    카드를 어느 반 묶음에 놓았나**뿐이고, `attendance_records`는 한 줄도 바뀌지 않는다
--    (출결은 언제나 학생의 **수강 반**으로 저장된다 = `from_class_id`). 그래서 시수·급여·회차·월별
--    출석부·반별 출석부가 전부 그대로다.
-- 🔴 **수강 반이동(`move_enrollments_batch`)이 아니다** — 자리 화면은 출결 전용이라는 상위 결정
--    (2026-08-19)을 그대로 지킨다. 적용일·GiST 제약·전출입 플래그는 이 표와 무관하다.
-- 🔑 **초기화 = 줄을 지우는 것**이다. 되돌릴 값을 따로 저장하지 않으므로(원래 반은 언제나 그 교시
--    명단이 다시 알려 준다) "근거 없는 복원"이 원리적으로 불가능하다. `from_class_id`는 감사·표시용
--    스냅샷일 뿐 복원의 근거가 아니다.
-- 🔴 **부분 유니크(WHERE) 금지**([[#113]]) — upsert가 `on conflict (tenant_id, seat, session_date,
--    slot_start, student_id)`로 추론해야 한다. 술어 없는 일반 유니크다.
-- ⚠️ RLS는 **정책 0개**(0157a `class_sheet_*`·0246a와 같은 규약) — 앱은 admin 클라이언트 + 명시
--    `tenant_id` 필터로만 읽고 쓴다([[#104]]). 세션 클라이언트로 읽으면 에러 없이 0행이다.
-- ⚠️ 이 SQL이 아직 안 돌았어도 화면은 산다([[#95]]) — 조회는 fail-soft(배치 0줄 = 지금까지의 화면
--    그대로)이고 드래그·초기화만 잠긴다. 매일 도는 자리 출석부라 이 성질이 필수다.
set local statement_timeout = '60s';

create table if not exists seat_placements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- 자리 키(URL·설정과 같은 소문자 값) — DB 라벨(`LAB`/`JJ`)이 아니라 앱의 `SeatKey`.
  seat text not null check (seat in ('lab', 'jj')),
  session_date date not null,
  -- 교시 시작시각 — 자리 출결과 **같은 축**(`attendance_records.slot_start`).
  slot_start time not null,
  student_id uuid not null references students(id) on delete cascade,
  -- 원래 반(= 수강·시간표가 정한 반, 출결이 저장되는 곳). 감사·표시용 스냅샷.
  from_class_id uuid not null,
  -- 지금 카드가 놓인 반 묶음.
  to_class_id uuid not null,
  -- 🔴 같은 반으로의 '이동'은 이동이 아니다(= 초기화) — 줄이 남지 않게 DB도 함께 막는다.
  constraint seat_placements_moved check (from_class_id <> to_class_id),
  moved_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, seat, session_date, slot_start, student_id)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seat_placements_from_class_fk') then
    alter table seat_placements
      add constraint seat_placements_from_class_fk
      foreign key (tenant_id, from_class_id) references classes (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'seat_placements_to_class_fk') then
    alter table seat_placements
      add constraint seat_placements_to_class_fk
      foreign key (tenant_id, to_class_id) references classes (tenant_id, id) on delete cascade;
  end if;
end $$;

-- 화면이 읽는 축 그대로(자리·날짜·교시) — 유니크가 (tenant, seat, date, slot, student)라 접두로 이미 덮인다.

drop trigger if exists seat_placements_set_updated_at on seat_placements;
create trigger seat_placements_set_updated_at
  before update on seat_placements
  for each row execute function public.tg_set_updated_at();

-- RLS: 정책 0개(의도) — 0157a `class_sheet_*`·0246a와 같은 규약. select 정책도 만들지 않는다.
alter table seat_placements enable row level security;
revoke all on table seat_placements from public, anon, authenticated;
grant all on table seat_placements to service_role;

comment on table seat_placements is
  '자리(랩실·JJ실) 출석부의 배치 — 그 자리·날짜·교시에 학생 카드를 어느 반 묶음에 놓았나. 출결 귀속(attendance_records.class_id)은 안 바뀐다. RLS 정책 0개 = service_role(admin) 전용.';

notify pgrst, 'reload schema';
