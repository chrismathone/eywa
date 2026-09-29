-- 0304a — ClassNote **반 단체 공지** 큐 (2026-09-29, 원장 *"공지사항 모드도 확실하게 … 반 공지 혹은 원생 개별 공지로 구분"*).
--
-- 왜 별도 표인가: 기존 `classnote_notices`(0099a)는 **원생 개별 공지**(학생마다 1:1 알림장) 전용이고 회수·제자리 수정·
--     결과 기록이 전부 그 전제로 짜여 있다. 반 단체 공지는 ClassNote **공지사항**(`POST /api/v1_2/notices/ {classes_to}`)
--     으로 반 보드에 **1건**을 올리는 다른 물건이라 섞지 않는다.
-- 🔴 쓰기 = 서버(service_role)만 — 사용자 쓰기 정책을 두지 않는다. 앱 사용자가 직접 행을 넣어 **아무 반 보드에나**
--    공지를 보내는 길을 막는다. 워커도 `targets`의 보드 번호를 믿지 않고 `classnote_class_boards`(0302a)에서 다시 찾는다.
-- 🔴 `classes_to`가 빠지면 ClassNote가 **기관 전체 공지**로 받을 수 있다(필수 칸이 아님 — 2026-09-29 실측) — 워커가 매번 막는다.

create table if not exists public.classnote_class_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  body text not null,
  targets jsonb not null default '[]'::jsonb,   -- [{classId, className}] (테스트 발송이면 [] + is_test)
  is_test boolean not null default false,        -- true = `[수학] 테스트반`(학원* 원아만)으로만
  status text not null default 'queued',         -- queued | processing | success | partial | failed
  results jsonb,                                 -- [{classId, className, ok, noticeId?, note?}]
  error text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  processing_at timestamptz,
  processed_at timestamptz
);

create index if not exists classnote_class_notices_queue_idx
  on public.classnote_class_notices (tenant_id, status, created_at desc);

alter table public.classnote_class_notices enable row level security;

-- 읽기 = 테넌트 멤버(반 공지 탭 목록). 쓰기 정책 없음 = service_role만.
drop policy if exists classnote_class_notices_tenant_read on public.classnote_class_notices;
create policy classnote_class_notices_tenant_read on public.classnote_class_notices
  for select using (tenant_id = auth_tenant_id());

comment on table public.classnote_class_notices is
  'ClassNote 반 단체 공지 큐(반 보드에 공지 1건). 쓰기 = 서버만. 워커가 보드 번호를 0302a에서 다시 찾고 보드 원아 = 재원 로스터를 대조한다.';

notify pgrst, 'reload schema';
