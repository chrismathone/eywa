-- 0071a: 역동기화(eywa→makeedu) 푸시 큐 + 멱등 플래그.
-- QR 공개접수 상담(enrollment_consultations.from_public_intake)은 eywa가 원본이라 makeedu에 없다 →
-- 사무실이 손으로 재입력하던 것을 "makeedu로 보내기" 버튼으로 건별 푸시. Vercel은 makeedu에 못 써서
-- (서버리스·makeedu 신뢰 IP 요구) 요청만 큐에 남기고, 동기화 PC 워처가 makeedu 상담등록 폼에 대신 제출.
--
-- 멱등: 성공 시 enrollment_consultations.makeedu_pushed_at=now() 세팅 → 후보에서 제외(재푸시 차단).
--       makeedu가 부여한 counselSeq를 makeedu_id에 저장(있으면) → 딥링크 + 읽기 동기화 중복 방지.
--       seq 못 잡아도 pushed_at으로 재푸시는 막히고, 다음 읽기 동기화가 자연키로 makeedu_id 백필.
create table if not exists makeedu_push_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  consultation_id uuid not null references enrollment_consultations(id) on delete cascade,
  requested_by uuid references users(id) on delete set null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending',      -- pending|running|done|error|skipped(이미 전송됨)
  started_at timestamptz,
  finished_at timestamptz,
  makeedu_counsel_seq text,                     -- 성공 시 makeedu가 부여한 counselSeq(잡히면)
  error text
);

create index if not exists ix_makeedu_push_requests_status
  on makeedu_push_requests (status, requested_at);
create index if not exists ix_makeedu_push_requests_consult
  on makeedu_push_requests (consultation_id);

alter table makeedu_push_requests enable row level security;

-- 테넌트 멤버는 자기 테넌트 요청 read(상태 확인). write는 service_role(서버 액션 admin)·직접 연결(워처)만.
drop policy if exists makeedu_push_requests_tenant_read on makeedu_push_requests;
create policy makeedu_push_requests_tenant_read on makeedu_push_requests
  for select using (tenant_id = auth_tenant_id());

-- 멱등 플래그 — 성공적으로 makeedu에 푸시된 시각(후보 제외 + UI 배지).
alter table enrollment_consultations add column if not exists makeedu_pushed_at timestamptz;
