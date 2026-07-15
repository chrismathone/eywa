-- 0108a: ClassNote 인바운드 피드 워터마크 — "학부모 글을 어디까지 봤나"를 테넌트×스코프로 1행 기록.
-- (사용자 결정 2026-07-15: 학부모가 ClassNote에 **새 글**을 올리면 그 학생의 담당 강사에게 eywa 인앱 알림.
--  범위=수학 1인보드 먼저. 댓글은 범위 밖 — 학부모 안내문구로 "새 글로 남겨주세요" 유도.)
--
-- 왜 워터마크인가: ClassNote 피드(`GET /api/v1_2/centers/{c}/reports/`)는 **id 내림차순**이 API 계약이다
-- (DRF CursorPagination의 커서가 base64("p=<직전 페이지 마지막 id>") = id가 곧 페이지네이션 위치 키).
-- 그래서 "마지막으로 본 id" 하나만 들고 있으면 새 글 판별이 결정적이다. `created`는 신뢰 금지
-- (마이크로초 .000000인 주입값이 섞여 단조증가가 아님) — 순서는 반드시 id.
--
-- 왜 파일 마커가 아니라 테이블인가(선례 0058a_makeedu_sync_state): 프로비저닝의 하루 1회 마커는 diff 기반이라
-- 유실돼도 멱등하지만, **알림은 누적이라 워터마크가 유실되면 과거 글이 통째로 재알림**된다(노이즈 폭탄).
-- 연동 PC 재설정·교체에도 살아남아야 하므로 DB에 둔다.
--
-- 쓰기 = 연동 PC 워커(DATABASE_URL 직결, RLS 우회)만. 앱은 읽기만(현재 소비처 없음 — 운영 점검용).
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

create table if not exists classnote_feed_state (
  tenant_id uuid not null references tenants(id) on delete cascade,
  scope text not null,                         -- 'parent_posts' (향후 다른 인바운드 스코프 확장 여지)
  last_seen_post_id bigint,                    -- ClassNote report id — null이면 콜드 스타트(첫 폴은 알림 0건)
  last_polled_at timestamptz,
  status text not null default 'ok',           -- ok|error
  error text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, scope)
);

alter table classnote_feed_state enable row level security;

-- 테넌트 멤버는 자기 테넌트 행 read. write는 워커(service_role/postgres 직결)만 — 정책 없음 = RLS bypass만 통과.
drop policy if exists classnote_feed_state_tenant_read on classnote_feed_state;
create policy classnote_feed_state_tenant_read on classnote_feed_state
  for select using (tenant_id = auth_tenant_id());
