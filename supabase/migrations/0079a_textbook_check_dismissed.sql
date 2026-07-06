-- 0079a: 교재 신청 자동 체크(mirror-textbook-checks) 수동 해제 마커.
-- 사무실이 등록/납부 체크를 해제(환불·오체크 정정)하면 이 시각이 찍히고,
-- makeedu 수납 미러(입력자='자동화')는 그 신청을 영구 제외한다.
-- 없으면 해제 → 다음 동기화 재체크 → 재해제 … 핑퐁(ijw '동기화마다 수동 처리 롤백' 버그의 역방향).
alter table textbook_orders add column if not exists check_dismissed_at timestamptz;
comment on column textbook_orders.check_dismissed_at is
  '교재 체크(등록/납부) 수동 해제 시각 — non-null이면 makeedu 자동 체크 대상에서 영구 제외(사람 소유)';
