-- invoices 결제 상세 필드 (회계/세무 투명성) — ijw 패리티.
-- 결제수단·카드사·현금영수증번호·적립금사용·할인사유·청구일. 멱등(add column if not exists).
-- RLS는 0004a의 tenant_isolation이 전 컬럼을 이미 커버 → 정책 변경 불필요.

alter table invoices add column if not exists payment_method text;       -- card/transfer/cash/other
alter table invoices add column if not exists card_company text;          -- 카드사명(결제수단=card)
alter table invoices add column if not exists cash_receipt_number text;   -- 현금영수증 발급번호
alter table invoices add column if not exists points_used numeric(12, 0) not null default 0; -- 적립금 사용액
alter table invoices add column if not exists discount_reason text;       -- 할인 사유
alter table invoices add column if not exists billed_at date;             -- 청구일(납부기한 due_date와 별개)
