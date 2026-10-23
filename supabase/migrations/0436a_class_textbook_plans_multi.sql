-- 같은 반 · 같은 교재 배정을 여러 개(최대 3개) 허용 — 배정마다 차수가 따로 돈다
--
-- 원장(2026-10-21): *"교재 배정 기능에 현재 동일한 교재는 한권만 되도록 되어있는데 동일한 선생님이 동일한 교재로
-- 최대3개까지 넣을수있어야함 그때 동일한 교재를 넣을경우 각 차시가 각각 돌도록"*.
--
-- 🔑 무엇이 바뀌나
--   ① 유니크 `class_textbook_plans_pos_uniq`(반·교재·축)를 지운다 — 같은 교재 두 번째 배정이 23505로 막히던 자리.
--      개수(3)와 겹침 금지는 **앱이 지킨다**(`placeSameBookPlan`, 쓰기 정책 0개 = 서버 액션 전용이라 문이 하나다).
--      🔴 대신 일반 인덱스를 둔다 — 저장 때마다 "같은 반 같은 교재" 형제를 찾는다.
--   ② 줄 미룸·당김 표식(0382a `lane`)의 키를 **교재 id → 배정 id**로 옮긴다. 교재 id로 두면 같은 교재 배정 둘이
--      서로의 미룸·당김을 읽어 한쪽을 누르면 다른 쪽 차수도 밀린다("각각 돌도록"이 깨진다).
--      교재 id 표식은 옛 앱(같은 교재 1건 시절)이 쓴 것이라 그때부터 있던 배정 것이다 — 정규 수업 축 · 가장 먼저
--      만든 배정으로 옮긴다(축이 둘이면 수업 축). 적용 시점 실측: 줄 표식 0건(2026-10-21).
--
-- ⚠️ 앱을 먼저 배포한다([[#95]]) — 새 앱은 이 SQL 전에도 돈다(두 번째 배정만 "SQL 필요" 안내로 막힌다).
--    이 SQL은 여러 번 돌려도 같다(배포 사이에 옛 앱이 교재 id로 쓴 표식이 있으면 다시 돌리면 옮겨진다).
--
-- 롤백(같은 반·교재 배정이 둘 이상 남아 있으면 인덱스 생성이 실패한다 — 먼저 지울 것):
--   create unique index class_textbook_plans_pos_uniq on public.class_textbook_plans (tenant_id, class_id, textbook_id, slot_axis);
set local statement_timeout = '60s';

create index if not exists class_textbook_plans_book_idx
  on public.class_textbook_plans (tenant_id, class_id, textbook_id);

drop index if exists public.class_textbook_plans_pos_uniq;

-- ② 교재 id 줄 표식 → 그 반 그 교재의 배정 id (하나로 정해질 때만).
with owner as (
  select distinct on (p.tenant_id, p.class_id, p.textbook_id)
         p.tenant_id, p.class_id, p.textbook_id::text as book, p.id::text as plan
    from public.class_textbook_plans p
   where p.is_active and p.term_mode = 'regular'
   order by p.tenant_id, p.class_id, p.textbook_id, (p.slot_axis = 'class') desc, p.created_at
)
update public.class_lesson_shifts s
   set lane = o.plan
  from owner o
 where s.lane <> ''
   and s.tenant_id = o.tenant_id
   and s.class_id = o.class_id
   and lower(s.lane) = lower(o.book);

comment on table public.class_textbook_plans is
  '반 교재 배정(0266a) — 어느 반의 어느 교시에 이 교재를 태울지. 같은 반·같은 교재는 3개까지(교시가 안 겹치게, 2026-10-21) — 배정마다 차수가 따로 돈다.';

notify pgrst, 'reload schema';
