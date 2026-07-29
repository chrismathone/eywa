-- 0156a — invoices_bak_20260708 을 public 밖(비노출 `archive` 스키마)으로 이관 (2026-07-29)
--
-- 배경: 0155a 에서 권한 회수 + force RLS 로 급한 불은 껐지만, **테이블이 여전히 public 에 있다**.
--       public 은 PostgREST 가 노출하는 스키마라, 앞으로 누가 grant 를 되돌리거나 RLS 를 끄면
--       같은 사고가 재발한다. 노출 스키마 밖으로 빼면 그 사고 유형 자체가 사라진다(구조적 차단).
--
-- ── 이 테이블의 정체 (2026-07-29 실측으로 확정) ────────────────────────────────────────
-- 2026-07-08 **수납 line_items 재구성 직전**의 invoices 스냅샷이다(changelog "수납 브랜치 머지 (2026-07-13)"
-- 항목의 "DB는 이미 선반영(2821건 11-key line_items, 백업 invoices_bak_20260708)"이 그 출처).
-- 실측:
--   · 2,002행 전부가 현재 invoices 에 같은 id 로 존재한다(백업에만 있는 행 = **0**).
--   · 컬럼 20종을 대조해 "백업엔 값이 있는데 현재는 NULL"인 경우 = **전 컬럼 0건**(정보 유실 없음).
--   · 현재가 오히려 더 채워져 있다: billed_at +1,967 · discount_reason +1,608 · card_company +1,509 ·
--     cash_receipt_number +375 · paid_at +97 · payment_method +96.
--   · line_items 도 유실 0 / 보강 2(백업의 2건은 array 가 아니라 string = 깨진 값이었다).
--   · 백업 최종 updated_at = 2026-07-07, 현재 = 2026-07-28.
-- 즉 **더 낡고 덜 채워진 스냅샷**이며, 고유하게 가진 정보는 값이 바뀐 행들의 *이전 값*뿐이다
--   (amount_total 109행 · amount_paid 183행 · status 962행 · paid_at 147행 · due_date 7행 등).
--
-- ── 왜 DROP 하지 않는가 ───────────────────────────────────────────────────────────────
-- 🔴 `audit_logs` 에 invoice/billing/payment 계열 기록이 **0건**이다. 즉 위 "이전 값"을 담고 있는
--    기록이 이 테이블 말고는 없다. 돈 데이터이고 되돌릴 수 없으므로 **삭제는 원장 판단 사항**으로 남긴다.
--    (돈 산식·수납 계열은 골든마스터가 머지 게이트인 영역 — 근거 없는 파기 금지.)
-- 여기서는 **노출만 제거**한다: 데이터·행수·컬럼 그대로, 위치만 archive 로.
--
-- 되돌리기: alter table archive.invoices_pre_line_items_20260708 set schema public;
--
-- ⏰ 재검토 예정: **2026-08-29** — 원장 결정(2026-07-29) "백업은 1달 후에 지워보자".
--    그날 ①행수·합계 재확인 ②코드 참조 0 확인 ③audit_logs 에 invoice 기록이 생겼는지 확인
--    (생겼으면 이 백업의 대체재가 있는 것) → 원장 승인 후에만 DROP. 승인 전 CSV/JSONL 덤프 전달.
--    ⚠️ 스스로 DROP 하지 말 것. 삭제도 애드혹이 아니라 마이그레이션 파일로 남긴다.

create schema if not exists archive;

comment on schema archive is
  '노출 금지 보관용. PostgREST 노출 스키마(public)에 두면 안 되는 백업·스냅샷 테이블. anon/authenticated 접근 없음.';

-- PostgREST 가 이 스키마를 노출하도록 설정이 바뀌더라도 anon/authenticated 는 들어올 수 없게 한다(이중 방어).
revoke all on schema archive from public;
revoke all on schema archive from anon, authenticated;
grant usage on schema archive to service_role;

do $$
begin
  if to_regclass('public.invoices_bak_20260708') is not null then
    alter table public.invoices_bak_20260708 set schema archive;
    alter table archive.invoices_bak_20260708 rename to invoices_pre_line_items_20260708;
    raise notice '0156a: public.invoices_bak_20260708 → archive.invoices_pre_line_items_20260708 이관';
  elsif to_regclass('archive.invoices_pre_line_items_20260708') is not null then
    raise notice '0156a: 이미 이관됨(skip)';
  else
    raise notice '0156a: 대상 테이블이 없다(skip)';
  end if;
end $$;

do $$
begin
  if to_regclass('archive.invoices_pre_line_items_20260708') is null then
    return;
  end if;
  -- 이관 후에도 RLS 는 유지(정책 0개). 스키마 격리와 별개인 이중 방어.
  execute 'alter table archive.invoices_pre_line_items_20260708 enable row level security';
  execute 'alter table archive.invoices_pre_line_items_20260708 force row level security';
  execute 'revoke all privileges on table archive.invoices_pre_line_items_20260708 from anon, authenticated';
  execute $c$comment on table archive.invoices_pre_line_items_20260708 is
    '2026-07-08 수납 line_items 재구성 직전 invoices 스냅샷(2,002행). 전 행이 public.invoices 에 존재하고 정보 유실 0 — 고유 정보는 값이 바뀐 행들의 이전 값뿐이다. audit_logs 에 invoice 기록이 없어 그 이력의 유일한 사본이라 보존 중. 삭제 여부는 원장 판단 — 2026-08-29 재검토 예정(원장 지시 2026-07-29).'$c$;
end $$;
