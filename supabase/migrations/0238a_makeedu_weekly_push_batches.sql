-- 0238a: 주간 자동 역동기화(eywa→makeedu) **배치 dedup**.
--
-- 배경(원장 2026-09-01): 등록상담 화면의 'makeedu 보내기' 수동 카드를 감추고, 매주 **일요일 06:00(KST)**에
-- 동기화 PC 워처가 자동으로 밀도록 바뀌었다. 실제 푸시 경로는 하나도 새로 만들지 않는다 —
-- 후보 판정(push-eligibility) · 큐(makeedu_push_requests) · 제출(push-consultations.cjs)은 그대로고,
-- **적재(큐에 넣는 일)만** 워처가 대신한다(scripts/_makeedu/weekly-push.cjs).
--
-- 이 표는 "그 주 배치가 이미 돌았는가" 한 가지만 답한다(알림 이벤트 bucket 규약과 같은 결):
--   bucket = 'weekly:YYYY-MM-DD' — 가장 최근 **일요일 06:00 KST 경계**의 날짜.
--   기본키(tenant_id, bucket) + `on conflict do nothing`이 곧 원자적 claim이라, 워처가 15초마다 돌아도
--   같은 주에 두 번 적재되지 않는다(워처 PC가 여러 대여도 마찬가지).
--
-- ⚠️ **앱(Next.js)은 이 표를 읽지도 쓰지도 않는다** — 적용 전에도 화면은 아무 영향이 없고(expand/contract),
--    워처만 "표가 없으니 주간 자동 전송을 건너뛴다"고 로그를 남기고 조용히 지나간다(fail-closed:
--    dedup을 못 하면 매 폴마다 다시 밀 수 있으므로 **미적용 상태에서 자동 전송을 시작하지 않는다**).
-- ⚠️ 부분 유니크(WHERE 절)를 붙이지 말 것 — `on conflict (tenant_id, bucket)` 추론이 깨진다([[#113]]).
create table if not exists makeedu_push_batches (
  tenant_id uuid not null references tenants(id) on delete cascade,
  bucket text not null,
  created_at timestamptz not null default now(),
  -- 그 배치가 큐에 넣은 건수(0도 정상 — 보낼 게 없었다는 사실 자체가 기록이다).
  queued_count int not null default 0,
  primary key (tenant_id, bucket)
);

alter table makeedu_push_batches enable row level security;

-- 테넌트 멤버는 읽기만(언제 자동 전송이 돌았는지 확인). 쓰기는 service_role·직접 연결(워처)만 —
-- makeedu_push_requests(0071a)와 같은 정책 모양이다.
drop policy if exists makeedu_push_batches_tenant_read on makeedu_push_batches;
create policy makeedu_push_batches_tenant_read on makeedu_push_batches
  for select using (tenant_id = auth_tenant_id());
