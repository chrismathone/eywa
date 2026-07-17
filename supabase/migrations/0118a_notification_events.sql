-- 0118a: 이벤트 알림 dedup 원장 — "학원 매니저 팀" Phase 3(이벤트 감지형 능동 알림, 2026-07-17).
--
-- 왜 DB 테이블인가(선례 0108a classnote_feed_state): 알림은 누적이라 dedup 상태가 유실되면 과거
-- 이벤트가 통째로 재알림된다(벨 폭탄). notifications 테이블엔 유니크/멱등 제약이 전혀 없어(0074a)
-- "이 이벤트 이미 보냈나"를 판별할 유일한 방어선이 이 테이블이다.
--
-- 한 행 = "이 이벤트를 한 번 처리(발송 또는 콜드스타트 시드)했다"는 사실.
--   subject_key = 이벤트 주체(학생 id·상담 id 등), bucket = 상태 전이 표현(결석 마일스톤 '3'/'5'/'10',
--   후속조치 '2026-07-17:due'/'…:overdue'). unique(tenant, event_type, subject_key, bucket)가 재발송 차단.
-- 원자성: 호출부는 upsert(onConflict, ignoreDuplicates:true).select()로 **새로 삽입된 행만** 골라
--   그 이벤트만 발송한다(bulk insert는 한 행만 충돌해도 문장 전체 23505 실패라 '성공분' 분리 불가).
-- 콜드스타트: (tenant, event_type) 행이 0건이면 첫 실행 — 현재 감지분을 전부 **무발송으로 시드**만 하고
--   그다음 실행부터 신규 edge만 알린다(0108a의 'last_seen null=첫 폴은 알림 0건'과 동일 철학).
--
-- 쓰기 = 서버(cron, service_role)만. 앱 표면은 기존 벨 하나로 유지(알림센터 UI 신설 금지 — 영구제외 결정).
-- read = 테넌트 멤버 자기 테넌트(부기 확인용). ⚠️ drizzle journal 밖(손수 alpha), pnpm db:alphas 사전순.

create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  event_type text not null,                    -- 'absence_alert' | 'followup_due'
  subject_key text not null,                   -- 이벤트 주체 id(학생·상담 등)
  bucket text not null,                        -- 상태 전이 표현(마일스톤 '3' / '2026-07-17:overdue')
  seeded boolean not null default false,        -- true = 콜드스타트 무발송 시드(발송 안 함)
  created_at timestamptz not null default now(),
  unique (tenant_id, event_type, subject_key, bucket)
);

create index if not exists notification_events_tenant_type_idx
  on notification_events (tenant_id, event_type, created_at desc);

alter table notification_events enable row level security;

-- 테넌트 멤버는 자기 테넌트 행 read. write는 서버(service_role)만 — 정책 없음 = RLS bypass만 통과.
drop policy if exists notification_events_tenant_read on notification_events;
create policy notification_events_tenant_read on notification_events
  for select using (tenant_id = auth_tenant_id());
