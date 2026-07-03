-- 0074a: 인앱 알림(직원 대상) — "자신과 관련된 행동"이 생기면 수신자에게 알림 1행.
-- (사용자 결정 2026-07-03: A안 인앱 알림. 첫 슬라이스 = 수업 배정·반이동 전입·강사 인수인계 → 담당 강사.)
--
-- 모델: 알림 1행 = (수신자 recipient_id, 유형 type, 제목/본문, 이동 링크, 유발자 actor_id, 읽음 read_at).
-- 발송은 서버(service_role, notifyUsers)가 다른 사용자에게 insert하므로 authenticated insert 정책은 없다
-- (service_role은 RLS 우회). 수신자는 **자기 알림만** 조회/읽음처리/삭제.
--
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  recipient_id uuid not null references users(id) on delete cascade,   -- 수신자(이 알림의 주인)
  type text not null,                                                  -- enrollment_assigned | enrollment_transferred_in | teacher_handover | ...
  title text not null,                                                 -- "새 학생 배정"
  body text,                                                           -- "김철수 학생이 초등M 반에 배정되었습니다"
  link text,                                                           -- 클릭 시 이동(예: /classes/{id})
  actor_id uuid references users(id) on delete set null,               -- 누가 유발했나(표시/감사, 선택)
  read_at timestamptz,                                                 -- null=안읽음
  created_at timestamptz not null default now()
);

-- 안 읽은 목록/카운트 핫패스: 수신자별 최신순 + 읽음 여부.
create index if not exists notifications_recipient_idx
  on notifications (recipient_id, created_at desc);
create index if not exists notifications_recipient_unread_idx
  on notifications (recipient_id) where read_at is null;

alter table notifications enable row level security;

-- 수신자는 자기 알림만 — 조회/읽음처리(update)/삭제. INSERT 정책 없음 = service_role(notifyUsers)만 생성.
drop policy if exists notifications_recipient_select on notifications;
create policy notifications_recipient_select on notifications
  for select using (recipient_id = auth.uid());

drop policy if exists notifications_recipient_update on notifications;
create policy notifications_recipient_update on notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

drop policy if exists notifications_recipient_delete on notifications;
create policy notifications_recipient_delete on notifications
  for delete using (recipient_id = auth.uid());
