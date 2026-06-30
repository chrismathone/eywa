-- 0060a: 공지 팝업(notice_popups) — 셸 진입 시 중앙/계단식으로 뜨는 창형 공지("일반 사이트 팝업광고" 패턴).
-- announcements(대시보드 카드)와 별개: 이건 "진입 시 강제로 한 번 보이는" 배너형이라 노출기간·이미지·
-- 링크·위치·크기·우선순위를 갖는다. "오늘 하루/7일/다시 안 보기" dismiss는 브라우저 localStorage(클라).
create table if not exists notice_popups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null,
  body text,                                  -- 본문(선택 — 이미지 전용 팝업 가능)
  image_url text,                             -- branding 업로드 경로 또는 외부 https URL(resolveBrandingSrc로 표시)
  link_url text,                              -- 클릭 시 이동(선택, https)
  link_label text,                            -- 링크 버튼 라벨(선택, 기본 "자세히 보기")
  audience announcement_audience not null default 'all',
  width integer not null default 380,         -- 팝업 카드 폭(px)
  position text not null default 'cascade',   -- cascade|center|left-top|right-top|left-bottom|right-bottom
  priority integer not null default 0,        -- 표시/계단 순서(클수록 먼저·위)
  is_active boolean not null default true,
  starts_at timestamptz,                      -- 노출 시작(선택, null=즉시)
  ends_at timestamptz,                        -- 노출 종료(선택, null=무기한)
  author_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notice_popups_tenant_active_idx
  on notice_popups (tenant_id, is_active, priority);

alter table notice_popups enable row level security;

-- 테넌트 격리(읽기·쓰기 모두 자기 테넌트). 쓰기 권한(원장/관리자)은 앱 레벨(canManageStaff)에서 추가 게이트.
drop policy if exists notice_popups_tenant_isolation on notice_popups;
create policy notice_popups_tenant_isolation on notice_popups
  for all using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());
