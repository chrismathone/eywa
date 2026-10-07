-- 0354a — 수납명만 바뀐 줄의 배분을 '번호 옮기기'가 따라가게 한다.
--
-- 원장 2026-10-07 *"금액이 바뀌지 않으면 그대로 두도록 해. 자꾸 확정이 풀리면 의문을 가질 수 밖에 없음."*
-- 앱은 이미 수납명을 안 본다(`receipt-allocation.ts` `sameBillAt`) — 그런데 번호 옮기기(0267d)는 이름으로 따라가서, 메이크에듀
-- 동기화가 수납명을 바꾼 **뒤에** 다른 항목이 앞에 끼어 번호가 밀리면 못 따라가고 배분이 다시 '재확인'이 됐다. 두 군데를 고친다.
--
--  ① 유효 판정 — 저장 때의 항목(스냅샷)과 옛 줄의 이름이 달라도, 그 자리에서 이름만 바뀐 같은 청구면 유효하다(앱과 같은 기준).
--     → 이미 이름이 바뀌어 있는 줄(스냅샷은 옛 이름)도 다음 변경 때 이름으로 따라가고 스냅샷이 지금 줄로 새로 적힌다.
--     단, **스냅샷의 옛 이름을 가진 줄이 새 목록에 다시 나타났으면** 이 갈래를 쓰지 않는다 — 그 줄이 원래 항목일 수 있어
--     앱도 재확인으로 읽는다(`sameItemAt`의 "저장 때 이름의 항목이 다른 번호에 있다"). 따라가 버리면 남의 줄에 조용히 굳는다(적대 리뷰).
--  ② 제자리 이름 변경 — 옛 줄이 이름으로는 새 목록 어디에도 없고, 같은 번호의 새 줄이 이름만 바뀐 같은 청구면 스냅샷을 새 줄로 새로 적는다.
--     → 그 뒤 번호가 밀려도 종전대로 이름으로 따라간다.
--
-- 🔴 ②는 **앱이 지금도 유효로 읽는 경우에만** 스냅샷을 새로 적는다(`receipt_renamed_in_place` = 앱 `sameBillAt`의 이름이 다른 갈래).
--    재확인이던 배분이 이 트리거 때문에 유효로 바뀌는 일은 없다. 더 엄격한 조건 둘: 새 줄의 이름이 옛 목록의 다른 번호에 있던 이름이면
--    (이름이 바뀐 게 아니라 다른 항목이 그 자리로 온 것) 안 하고, 다른 묶음이 이름으로 그 번호를 찾아오면 양보한다.
-- 🔴 금액·종류·반·합산 묶음이 달라지면 종전대로 아무것도 안 한다(앱이 재확인으로 읽는다).
-- ⚠️ 보조 판정 안의 오류(깨진 금액 값 등)는 '이름만 바뀐 것이 아님'으로 접는다 — 이 판정 때문에 수납 동기화가 멈추지 않게.
--    금액을 숫자로 못 읽는 줄은 처음부터 대상이 아니다. (트리거 본문이 종전부터 하던 금액 형 변환은 그대로다 — 옛 것과 같은 급.)
--    문자열 금액은 자릿수가 정해진 숫자 모양(정수 15자리 · 소수 6자리까지, 앞뒤 공백 없음)만 읽는다 — 형 변환이 던질 길을 없앤다
--    (전각 공백이 붙은 값 · 수만 자리 숫자는 예외 블록 밖에서 던져 청구서 갱신을 막았다 — 재리뷰).
-- ⚠️ 값싼 판정(이름이 같다 · 모양·금액이 다르다)을 먼저 한다 — 이름이 안 바뀐 보통의 갱신은 예외 블록(하위 트랜잭션)에 들어가지 않는다.
-- ⚠️ 원 단위 정수 금액이 전제다 — 소수·문자열 금액에서는 앱(반올림)과 '같은 모양' 판정이 갈릴 수 있다(운영 값에는 없다).
-- 멱등(create or replace). 표·데이터는 건드리지 않는다. 🔴 적용 순서: 보조 함수 셋 → 트리거 함수(뒤집으면 청구서 갱신이 전부 막힌다).
-- 되돌리기 = 0267d의 `relink_session_receipt_allocations`를 다시 적용.

create or replace function public.receipt_line_shape(line jsonb)
returns jsonb language sql immutable parallel safe set search_path=public as $$
  select jsonb_build_array(coalesce(line->>'kind',''),coalesce(line->>'classId',''),coalesce(line->>'receiptGroupId',''));
$$;

create or replace function public.receipt_raw_amount(line jsonb)
returns numeric language sql immutable parallel safe set search_path=public as $$
  select case when jsonb_typeof(line->'amount')='number' then (line->>'amount')::numeric
    when jsonb_typeof(line->'amount')='string' and line->>'amount' ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' then (line->>'amount')::numeric end;
$$;

-- `lines`의 `idx`번 줄이 `previous`와 **이름만 다른 같은 청구**인가 — 종류·반·묶음·금액(환불 전·급여 기준 둘 다)이 같고,
-- 같은 이름이나 같은 모양의 다른 줄이 목록에 없다(있으면 어느 줄이 그 청구인지 가릴 수 없다). 이름이 같으면 false(종전 판정의 몫).
create or replace function public.receipt_renamed_in_place(previous jsonb, lines jsonb, idx integer)
returns boolean language plpgsql immutable set search_path=public as $$
declare line jsonb; label text; shape jsonb; raw numeric; pay numeric;
begin
  if idx is null or idx<0 or jsonb_typeof(previous) is distinct from 'object' or jsonb_typeof(lines) is distinct from 'array' then return false; end if;
  line:=lines->idx;
  if jsonb_typeof(line) is distinct from 'object' then return false; end if;
  label:=public.receipt_line_identity(previous)->>2;
  shape:=public.receipt_line_shape(previous);
  raw:=public.receipt_raw_amount(previous);
  if raw is null then return false; end if;
  if public.receipt_line_identity(line)->>2=label or public.receipt_line_shape(line)<>shape
    or public.receipt_raw_amount(line) is distinct from raw then return false; end if;
  begin
    pay:=coalesce(public.receipt_salary_amount(previous),0);
    if coalesce(public.receipt_salary_amount(line),0)<>pay then return false; end if;
    return not exists(
      select 1 from jsonb_array_elements(lines) with ordinality o(item,ordinality)
      where o.ordinality-1<>idx and (
        public.receipt_line_identity(o.item)->>2=label
        or (public.receipt_line_shape(o.item)=shape
          and (public.receipt_raw_amount(o.item) is not distinct from raw or coalesce(public.receipt_salary_amount(o.item),0)=pay))));
  exception when others then
    return false;
  end;
end;
$$;

create or replace function public.relink_session_receipt_allocations()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if old.line_items is not distinct from new.line_items
    or jsonb_typeof(old.line_items) is distinct from 'array' or jsonb_typeof(new.line_items) is distinct from 'array' then return new; end if;
  perform id from public.invoice_session_terms where invoice_id=new.id order by id for update;
  with old_groups as (
    select t.allocation_line_index idx,array_agg(t.id) ids,sum(t.allocation_amount) amount,
      bool_and(coalesce(t.allocation_amount is not null and t.allocation_amount>=0
        and t.allocation_base_amount is not distinct from t.amount and (t.confirmed_sessions is not null or t.amount is null)
        and ((public.receipt_line_identity(t.allocation_source)=public.receipt_line_identity(old.line_items->t.allocation_line_index)
            and (t.allocation_source->>'amount')::numeric=(old.line_items->t.allocation_line_index->>'amount')::numeric)
          or (public.receipt_renamed_in_place(t.allocation_source,old.line_items,t.allocation_line_index)
            and not exists(select 1 from jsonb_array_elements(new.line_items) back(line)
              where public.receipt_line_identity(back.line)->>2=public.receipt_line_identity(t.allocation_source)->>2))),false)) valid,
      bool_and(public.receipt_renamed_in_place(t.allocation_source,new.line_items,t.allocation_line_index)) stays
    from public.invoice_session_terms t where t.invoice_id=new.id and t.allocation_line_index is not null group by t.allocation_line_index
  ), named as (
    select g.idx,count(*) hits,min(n.ordinality-1)::integer new_idx from old_groups g
    cross join lateral jsonb_array_elements(new.line_items) with ordinality n(line,ordinality)
    where public.receipt_contains_line(n.line,old.line_items->g.idx)
    group by g.idx
  ), targets as (
    select g.idx,g.ids,g.amount,g.valid,
      case when n.hits=1 then n.new_idx
        when n.hits is null and g.stays
          and not exists(select 1 from named x where x.hits=1 and x.new_idx=g.idx)
          and not exists(select 1 from jsonb_array_elements(old.line_items) with ordinality o(line,ordinality)
            where o.ordinality-1<>g.idx
              and public.receipt_line_identity(o.line)->>2=public.receipt_line_identity(new.line_items->g.idx)->>2)
        then g.idx end new_idx
    from old_groups g left join named n on n.idx=g.idx
  ), safe_targets as (
    select new_idx from targets where new_idx is not null group by new_idx
    having bool_and(coalesce(valid,false) and amount=(old.line_items->idx->>'amount')::numeric)
      and sum(amount)=(new.line_items->new_idx->>'amount')::numeric
  )
  update public.invoice_session_terms t set allocation_line_index=m.new_idx,allocation_source=new.line_items->m.new_idx
  from targets m join safe_targets s on s.new_idx=m.new_idx where t.id=any(m.ids)
    and (t.allocation_line_index is distinct from m.new_idx or t.allocation_source is distinct from new.line_items->m.new_idx);
  return new;
end;
$$;
