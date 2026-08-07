-- 0195a — 저장된 견적: 월 정액이 '회당'으로 저장돼 있던 과목 행을 월 고정으로 바로잡는다.
--
-- 원장 2026-08-07: *"저장된 청구서들 중에 EiE가 회당 단가 처리되어있는 청구서가 있는데? 금액은 정상인데
-- 회당 단가 27만원, 시수12, 총금액 27만원"* → *"이미 EiE는 월별 금액이므로 회당 단가 → 월 고정으로
-- 변경처리해야함"*.
--
-- 🔴 **지뢰였다.** 그 견적을 열어 날짜·요일·시수를 **하나만** 건드리면 자동 계산이 돌아
--    `270,000 × 12 = 3,240,000원`이 된다. 원장이 계산기에 구분을 만들라고 한 바로 그 사고가
--    이미 저장된 견적 안에서 격발을 기다리고 있었다.
--
-- 실측(적용 직전): 견적 15건·과목 22행 중 **4행**(박재우 3 · 이도윤 1, 전부 EiE 270,000).
--
-- 판별은 **산수로 불가능한 조합** 하나뿐: 회당인데 `총액 = 회당 단가`이고 시수가 1이 아니다.
--   (시수 1이면 총액=단가가 정상이라 제외. 앱도 같은 규칙을 쓴다 — `normalizeLoadedCourse`.)
-- ⚠️ **금액·시수는 건드리지 않는다** — 이미 학부모에게 안내된 숫자다. 바꾸는 것은 구분과 회당 단가뿐이라
--    행 금액도 `total_amount`도 그대로다(합계 재계산 불필요).
-- ⚠️ 앱이 **열 때도 같은 보정을 한다**(0195a를 안 돌려도 화면은 안전). 이 파일은 저장값 자체를 사실로
--    맞춰 두는 것 — 다음에 누가 raw 데이터를 읽어도 같은 것을 보게 하려는 것이다.
-- ⚠️ 멱등: 고쳐진 행은 `fixedMonthly=true`가 되어 조건에서 빠진다.

update public.tuition_quotes q
   set courses = (
         select coalesce(
                  jsonb_agg(
                    case
                      when coalesce((c ->> 'fixedMonthly')::boolean, false) = false
                       and coalesce((c ->> 'perSession')::numeric, 0) > 0
                       and coalesce((c ->> 'price')::numeric, 0) = coalesce((c ->> 'perSession')::numeric, 0)
                       and coalesce((c ->> 'sessions')::numeric, 0) <> 1
                      then c || '{"fixedMonthly": true, "perSession": 0}'::jsonb
                      else c
                    end
                    order by ord
                  ),
                  '[]'::jsonb
                )
           from jsonb_array_elements(q.courses) with ordinality t(c, ord)
       ),
       updated_at = now()
 where exists (
   select 1
     from jsonb_array_elements(q.courses) e(c)
    where coalesce((c ->> 'fixedMonthly')::boolean, false) = false
      and coalesce((c ->> 'perSession')::numeric, 0) > 0
      and coalesce((c ->> 'price')::numeric, 0) = coalesce((c ->> 'perSession')::numeric, 0)
      and coalesce((c ->> 'sessions')::numeric, 0) <> 1
 );

-- 확인용(적용 후): 0행이어야 한다.
--   select count(*) from public.tuition_quotes q
--    where exists (select 1 from jsonb_array_elements(q.courses) e(c)
--                   where coalesce((c->>'fixedMonthly')::boolean,false) = false
--                     and coalesce((c->>'perSession')::numeric,0) > 0
--                     and coalesce((c->>'price')::numeric,0) = coalesce((c->>'perSession')::numeric,0)
--                     and coalesce((c->>'sessions')::numeric,0) <> 1);
