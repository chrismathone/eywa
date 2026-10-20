-- 0381a — 회차 미룸·당김을 **줄마다** (0282a 후속)
--
-- 원장(2026-10-20): *"미룸 당김을 수업이 2개면 각각 미룸, 당김 버튼이 활성화되어야할거같음"*.
-- 한 교시에 25분 차수가 둘이면(같은 교재 1·2차수, 또는 교재 둘) 줄마다 따로 민다. 0282a는 표식이
-- (반, 날짜, 교시) 하나라 교시를 통째로만 밀 수 있었다 — 그래서 미룸은 두 차수, 당김은 한 차수가 움직여
-- 밀고 당기기를 섞으면 순서가 어긋났다.
--
-- 🔑 표식에 두 칸을 더한다:
--      · `lane` = 교재 id(문자열). ''(빈 값) = 옛 **칸 표식** — 교시를 통째로(0282a 뜻 그대로).
--      · `pos`  = 그 교시의 몇 번째 차수 자리(1~4). 0 = 칸 표식.
--                 **같은 자리를 여러 번 당기면** `자리 + 4×(k−1)`로 쌓는다(5~20) — 같은 줄을 두 번 당기면 그 자리
--                 차수가 둘 건너뛰어야 하는데, 한 자리에 표식이 하나뿐이면 두 번째가 다음 자리에 걸려 엉뚱한 차수가
--                 빠진다(shift-key `MAX_LANE_POS`).
--    🔴 둘 다 NOT NULL + 기본값이다 — NULL이면 유니크가 안 겹쳐 같은 표식이 두 벌 쌓이고, upsert가 그걸 못 막는다
--       ([[#113]]과 같은 이유로 부분(WHERE) 유니크도 쓰지 않는다).
--    ⚠️ `lane`은 FK가 아니다 — 배정 삭제가 그 교재 표식을 함께 지운다(plan-delete-lines). 교재를 지워도 남는
--       표식은 그 교재 배정이 없으면 아무 계산에도 안 쓰인다.
-- 🔑 기존 행은 전부 칸 표식(lane='', pos=0)이 되어 **뜻이 그대로**다.
--
-- ⚠️ 앱은 이 SQL 전에도 돈다([[#95]]) — 새 열을 못 읽으면 옛 열로 읽는다. 줄 표식은 못 쓰므로, 그 칸에 그 교재
--    한 차수뿐이면 교시 통째 표식으로 대신하고(같은 뜻), 아니면 "0381a 필요"로 거절한다.
--    🔴 순서: 앱 배포 → 이 SQL. 이 SQL이 옛 유니크(칸 축)를 지우므로, 이 SQL 뒤에 **옛 앱**이 칸 축으로 upsert하면
--       42P10으로 실패한다(새 앱은 새 축으로 쓴다).
--
-- 롤백(줄 표식은 잃는다 — 칸 표식으로 접을 수 없다):
--   delete from public.class_lesson_shifts where lane <> '' or pos <> 0;
--   create unique index if not exists class_lesson_shifts_cell_uniq
--     on public.class_lesson_shifts (tenant_id, class_id, plan_date, slot_start);
--   drop index if exists public.class_lesson_shifts_lane_uniq;
--   alter table public.class_lesson_shifts drop column if exists pos, drop column if exists lane;
set local statement_timeout = '60s';

alter table public.class_lesson_shifts
  add column if not exists lane text not null default '',
  add column if not exists pos smallint not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_lesson_shifts_lane_pos_chk') then
    alter table public.class_lesson_shifts
      add constraint class_lesson_shifts_lane_pos_chk
      check ((lane = '' and pos = 0) or (lane <> '' and pos between 1 and 20));
  end if;
end $$;

-- 한 칸 · 한 교재 · 한 자리에 결정은 하나(칸 표식은 lane='', pos=0 한 줄).
create unique index if not exists class_lesson_shifts_lane_uniq
  on public.class_lesson_shifts (tenant_id, class_id, plan_date, slot_start, lane, pos);
drop index if exists public.class_lesson_shifts_cell_uniq;

comment on column public.class_lesson_shifts.lane is
  '줄 표식의 교재 id(0381a). 빈 값 = 칸 표식(그 교시를 통째로 미루거나 당긴다, 0282a).';
comment on column public.class_lesson_shifts.pos is
  '줄 표식의 차수 자리(그 교시의 몇 번째 25분, 1~4 · 같은 자리 거듭 당김은 +4씩 5~20). 0 = 칸 표식.';
