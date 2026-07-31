-- 0162a: 공지 팝업 dismiss를 브라우저(localStorage)에서 **계정(DB)** 으로 이전.
-- 배경: 0060a는 "일반 사이트 팝업광고" 관행대로 dismiss를 localStorage에 뒀는데, localStorage는
-- origin(스킴+호스트+**포트**) 단위라 dev 포트마다·브라우저마다·PC마다 따로 놀았다("다시 보지 않기를
-- 눌렀는데 또 뜬다"). 사람 기준으로 기억해야 사무실 PC에서 끈 게 집 PC에서도 유지된다.
-- 계정 단위 = (user_id, popup_id) 1행. 팝업이 수정되면(updated_at 변경) 옛 dismiss는 무시하고 재노출
-- (version 컬럼 비교 — 0060a의 클라 로직을 그대로 옮긴 것).
create table if not exists notice_dismissals (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  popup_id uuid not null references notice_popups(id) on delete cascade,
  version timestamptz not null,   -- dismiss 시점의 notice_popups.updated_at(다르면 재노출)
  until timestamptz,              -- 이 시각까지 숨김. null = 영구("다시 보지 않기")
  created_at timestamptz not null default now(),
  primary key (user_id, popup_id)
);

-- PK(user_id, popup_id)가 조회(내 dismiss 전체)를 이미 커버. tenant 인덱스는 정리/감사용.
create index if not exists notice_dismissals_tenant_idx on notice_dismissals (tenant_id);

alter table notice_dismissals enable row level security;

-- 내 것만 읽고 쓴다(+ 테넌트 이중 격리). ⚠️ 게이트 함수는 `(select f())`로 감싸 InitPlan화 —
-- 안 감싸면 행마다 호출돼 느려진다(0160a 수납 RLS 사건과 같은 함정).
drop policy if exists notice_dismissals_own on notice_dismissals;
create policy notice_dismissals_own on notice_dismissals
  for all
  using (user_id = (select auth.uid()) and tenant_id = (select auth_tenant_id()))
  with check (user_id = (select auth.uid()) and tenant_id = (select auth_tenant_id()));
