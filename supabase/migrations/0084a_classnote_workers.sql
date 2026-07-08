-- 0084a: ClassNote 발송 워커 심장박동 — 어느 PC가 발송 담당인지 + 살아있는지 웹에서 표시.
-- 상주 데몬(watch-classnote-queue.mjs)이 매 폴(15초)마다 자기 hostname·last_seen을 upsert한다.
-- 연동 면이 이 행을 읽어 "발송 PC: DESKTOP-ABC · 온라인/오프라인(마지막 활동 N분 전)"을 표시 →
-- 강사·원장이 담당 PC가 켜져 있는지(큐가 처리될지) 한눈에 확인. PC별 1행.
--
-- makeedu_sync_workers(0073a)와 동일 구조지만 **별도 테이블**: 한 PC에 두 워커가 동시 상주하면
-- hostname PK가 충돌하므로 워커 종류별로 분리(발송 담당 PC ≠ makeedu 동기화 PC일 수 있음).
create table if not exists classnote_workers (
  tenant_id uuid not null references tenants(id) on delete cascade,
  hostname text not null,
  started_at timestamptz,          -- 현재 데몬 프로세스 시작 시각(재시작 감지)
  last_seen timestamptz not null default now(),
  primary key (tenant_id, hostname)
);

alter table classnote_workers enable row level security;

-- 테넌트 멤버는 자기 테넌트 워커 read. write는 직접 연결(데몬, DATABASE_URL)·service_role만 (0058a/0073a 패턴).
drop policy if exists classnote_workers_tenant_read on classnote_workers;
create policy classnote_workers_tenant_read on classnote_workers
  for select using (tenant_id = auth_tenant_id());
