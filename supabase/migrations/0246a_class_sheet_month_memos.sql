-- 0246a — ECS 월간 **특이사항 메모** (달력 보기, 월간계획 아래)
--
-- 원장 2026-09-03: *"인재원 영어의 강사시트 달력뷰에서 특이사항 메모할 수 있는 메모란을 추가해야겠어.
-- 월별 계획 아래쪽에 추가하면 될듯."*
--
-- 🔴 **`class_sheet_memos`(0157a)를 재활용하지 않는다.** 그 표의 축은 **주**(`week_start`가 월요일이고
--    CHECK가 키에 박힌 날짜까지 그 주 안으로 강제한다). 월 메모를 거기 넣으면 임의의 월요일 밑에
--    월 단위 행이 매달리고, 그 주를 지우거나 옮기는 코드가 생기는 순간 조용히 깨진다
--    (MCS 0237a·MP 0239a에서 이미 내린 결론: **축이 다르면 표를 나눈다**).
-- 🔴 **부분 유니크(WHERE) 금지**([[#113]]) — upsert가 `on conflict (tenant_id, class_id, month)`로
--    추론해야 한다. 여기 유니크는 술어 없는 일반 유니크다.
-- 🔑 grain = (반, 달) 하나. 담임/부담임으로 가르지 **않는다** — 특이사항은 그 반의 사실이지 역할별
--    기록이 아니다(위 월간계획 스트립의 역할 토글은 목표에만 걸린다).
-- ⚠️ RLS는 **정책 0개**(0157a·0239a와 같은 규약) — 앱은 admin 클라이언트 + 명시 `tenant_id` 필터로만
--    읽고 쓴다([[#104]]). 세션 클라이언트로 읽으면 에러 없이 0행이다.
-- ⚠️ 이 SQL이 아직 안 돌았어도 화면은 산다(조회는 fail-soft, 편집만 잠기고 한글 배너가 사실을 말한다,
--    [[#95]]). 달력·진도표·계획(MP)은 이 표를 아예 안 읽는다.
set local statement_timeout = '60s';

create table if not exists class_sheet_month_memos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  class_id uuid not null,
  -- 그 달 **1일**로 굳힌다(달을 문자열로 두면 '2026-9'·'2026-09'가 갈린다).
  month date not null check (extract(day from month) = 1),
  body text not null default '' check (char_length(body) <= 2000),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, class_id, month)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_sheet_month_memos_class_fk') then
    alter table class_sheet_month_memos
      add constraint class_sheet_month_memos_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
end $$;

drop trigger if exists class_sheet_month_memos_set_updated_at on class_sheet_month_memos;
create trigger class_sheet_month_memos_set_updated_at
  before update on class_sheet_month_memos
  for each row execute function public.tg_set_updated_at();

-- RLS: 정책 0개(의도) — 0157a `class_sheet_*`와 같은 규약. select 정책도 만들지 않는다.
alter table class_sheet_month_memos enable row level security;
revoke all on table class_sheet_month_memos from public, anon, authenticated;
grant all on table class_sheet_month_memos to service_role;

comment on table class_sheet_month_memos is
  'ECS 월간 특이사항 메모(반 × 달 하나). 달력 보기의 월간계획 아래. RLS 정책 0개 = service_role(admin) 전용.';

notify pgrst, 'reload schema';
