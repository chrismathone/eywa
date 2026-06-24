-- 교재신청(textbook_orders) 상태 = ijw식 3개 독립 체크(등록/주문/납부). 각자 타임스탬프(체크=시각, 해제=null).
-- 주문/납부는 기존 ordered_at/paid_at 재사용, 등록은 registered_at 신설. delivered_at/billed_at는 폐기(컬럼만 잔존).
-- + 마지막 변경자(이름 denormalize)·시각 = 누가·언제 마지막으로 바꿨는지.
alter table textbook_orders add column if not exists registered_at timestamptz;
alter table textbook_orders add column if not exists status_by_name text;
alter table textbook_orders add column if not exists status_at timestamptz;

-- 데모 백필(과거 단일 status → 체크 타임스탬프). paid=등록·주문·납부 모두 체크, ordered=등록·주문 체크.
update textbook_orders set
  ordered_at = coalesce(ordered_at, paid_at, request_date::timestamptz, now()),
  registered_at = coalesce(registered_at, paid_at, request_date::timestamptz, now())
  where status = 'paid';
update textbook_orders set
  ordered_at = coalesce(ordered_at, request_date::timestamptz, now()),
  registered_at = coalesce(registered_at, request_date::timestamptz, now())
  where status = 'ordered';
