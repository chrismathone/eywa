-- 0264a — 보강 예약 (결석 → 미래의 보강 시간을 미리 잡는다)
--
-- 원장(2026-09-14): *"보강 예약을 클릭하면 보강 팝업이 떠서 '몇시'에 보강인지 시간 지정 가능하게. 평일과
-- 주말 운영시간으로 정할 수 있어야함. 수기 금지. 해당 학생의 보강 예약이 출석부에 생기고, 아직 보강 수업
-- 전이기 때문에(시수 결정 전) 출석부에 텍스트로 '보강 예약'이라고 … 해당하는 보강 날짜에 보강 추가 할
-- 필요없이 미리 학생이 추가되어있어야되겠어. … 9/30 결석할거니까 10/5에 보강수업을 미리 잡는다는등.
-- 그러면 9/30에 0으로 처리되고, 10/5에 보강하면 되니까. 메모도 자동 입력되고"*
--
-- 🔑 구조 결정:
--   ① **출결 행이 아니다.** 예약은 "아직 안 한 수업"이라 시수·회차·출석률·급여 어디에도 닿으면 안 된다.
--      `attendance_records`에 새 status를 넣으면 회차 소비(0263a `count(distinct session_date)`)·출석률·
--      ClassNote 게이트가 전부 그 행을 세므로 **표를 따로 둔다**. 보강을 실제로 하면 그날 출결 행이 생기고
--      이 행은 `done`으로 넘어가며 그 행에 연결된다(`attendance_record_id`).
--   ② **결석 쪽은 종전 출결 규약 그대로** — 결석일 칸은 `setAttendanceCell`(결석·시수 0)로 찍고 메모는
--      `absenceMemo()`("10/5 보강 예정")를 이어 붙인다. 여기엔 결석 칸의 사본을 두지 않는다.
--   ③ **교시는 시각 스냅샷**(`slot_start`·`slot_end`·`period_label`) — 학원설정 교시표가 뒤에 바뀌어도
--      예약은 잡던 그 시각으로 읽힌다. 선택지는 앱이 설정 교시표(평일=과목별 표 · 주말=주말 표)에서만
--      만든다(원장 *"수기 금지"*) — 서버 액션이 같은 표로 다시 검증한다.
--   ④ `class_id` = **원반**(결석이 난 반 = 예약이 서는 출석부). 호스트 반을 따로 묻지 않는다
--      (CLAUDE.md 2026-09-02 *"반 보강이 아닌 보강엔 호스트 반이 없다 — 묻지 말 것"*과 같은 결).
--
-- 🔴 유니크는 **부분 유니크(WHERE)가 아니라 일반 유니크**([[#113]]) — 취소는 행을 **지운다**(감사로그에
--    내용을 남긴다). 취소를 상태로 남기면 같은 시간을 다시 잡을 때 유니크에 걸린다.
-- 🔴 `auth_menu_access(...)`를 RLS에 쓰지 말 것([[#92]]). 읽기는 테넌트 격리(select 정책), 쓰기는 앱 게이트
--    (`canWriteTenant("attendance")` + 담당 반)가 맡고 **서버 액션(service_role)** 이 쓴다 — 0251a와 같은 결.
-- 🔴 정책을 하나도 안 만들면 세션 클라이언트로 **에러 없이 0행**이다([[#104]]) → select 정책을 만든다.
--
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다([[#95]]) — 표가 없으면 조회는 빈 목록(예약 없음)이고 예약 저장만
--    한글 오류("아직 적용되지 않았습니다")로 거절된다. 출결 화면은 종전 그대로.
--
-- 롤백:
--   drop table if exists public.makeup_reservations;
set local statement_timeout = '60s';

create table if not exists public.makeup_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  -- 원반(결석이 난 반). 반이 지워지면 예약도 뜻을 잃는다.
  class_id uuid not null references public.classes(id) on delete cascade,
  -- 결석한(할) 날 — 과거·미래 모두 가능(사전 결석 통보 → 미리 잡는 보강).
  absence_date date not null,
  -- 보강을 하는 날 + 교시 시각(설정 교시표 스냅샷).
  makeup_date date not null,
  slot_start time not null,
  slot_end time not null,
  -- 예약 당시 교시 이름("1-1"·"EiE 3교시"·"주말 2교시"). 표시 전용 — 식별은 시각이다.
  period_label text constraint makeup_reservations_label_len
    check (period_label is null or char_length(period_label) <= 40),
  note text constraint makeup_reservations_note_len
    check (note is null or char_length(note) <= 300),
  -- reserved = 아직 안 함 · done = 그날 출결이 찍혀 이행됨(행은 남는다 — 이력).
  status text not null default 'reserved'
    constraint makeup_reservations_status_chk check (status in ('reserved', 'done')),
  -- 이행 때 연결되는 그날 출결 행(그 반·그 학생·그 날짜). 행이 지워지면 연결만 끊긴다.
  attendance_record_id uuid references public.attendance_records(id) on delete set null,
  done_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_reservations_dates_differ check (absence_date <> makeup_date),
  constraint makeup_reservations_slot_order check (slot_end > slot_start),
  -- 🔴 일반 유니크(부분 유니크 금지, [[#113]]) — 같은 학생·같은 반·같은 날·같은 교시는 하나.
  constraint makeup_reservations_uniq unique (tenant_id, student_id, class_id, makeup_date, slot_start)
);

comment on table public.makeup_reservations is
  '보강 예약(0264a). 출결 행이 아니다 — 시수·회차·출석률에 닿지 않는다. 보강일 출결이 찍히면 done + 연결.';

-- 월별 출석부(반 × 기간) · 일별/원스크린(반 × 날짜)
create index if not exists makeup_reservations_class_date_idx
  on public.makeup_reservations (tenant_id, class_id, makeup_date);
-- 시간표 '보강' 탭(주 범위) · 운영실
create index if not exists makeup_reservations_date_idx
  on public.makeup_reservations (tenant_id, makeup_date);
-- 학생 상세 · 결석 칸에서 되짚기
create index if not exists makeup_reservations_student_idx
  on public.makeup_reservations (tenant_id, student_id);

alter table public.makeup_reservations enable row level security;

drop policy if exists makeup_reservations_tenant_read on public.makeup_reservations;
create policy makeup_reservations_tenant_read on public.makeup_reservations
  for select using (tenant_id = public.auth_tenant_id());

drop trigger if exists makeup_reservations_set_updated_at on public.makeup_reservations;
create trigger makeup_reservations_set_updated_at before update on public.makeup_reservations
  for each row execute function public.tg_set_updated_at();
