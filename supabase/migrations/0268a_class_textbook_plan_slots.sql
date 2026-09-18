-- 0268a — 반 교재 배정에 **고른 교시 목록**을 담는다 (0266a 후속)
--
-- 원장(2026-09-16, 월간 시트 캡처와 함께): *"반배정은 반배정 저기서 하지말고 여기서 교재 선택하고 몇차시에
-- 할지 선택하면 해당 서식에 맞춰서 추가되게 — 예를들어서 16시 수업 클릭 17시 수업 클릭 하고 뭐 교재
-- 선택하거나 그런식으로 해서 해당 차이별로 쭈루룩 짜진다는지"*.
--
-- 🔑 무엇이 바뀌나: 0266a는 교시를 **축**(`slot_axis` = 정규 수업 / JJ 자습실)으로 뭉뚱그렸다. 사람이 실제로
--    고르는 것은 축이 아니라 **그 요일 그 시각의 칸**이다.
--    → `slot_picks`(예 `{"mon|17:20","thu|16:20"}`)를 두고, 값이 있으면 **그 칸에만** 차수를 태운다.
--
-- 🔴 **요일이 꼭 붙는다**(원장 제보 2026-09-18: *"추민아 선생님이 배정해도 송지혜 선생님까지 다같이 배정됌"*).
--    처음엔 시각만 담으려 했는데 — 같은 시각의 **담당이 요일마다 갈린다**: `중고E_중1 MED`는
--    월 17:20이 추민아(Jane)이고 목 17:20은 JJ(자습실)다. 시각만 담으면 추민아의 기입이 목요일 자습실
--    칸까지 내려앉는다. 실측(2026-09-18) 이렇게 갈리는 조합이 **60개(반×시각)**라 예외가 아니라 상례다.
--
-- 🔴 `slot_axis`를 지우지 않는다 — 값이 없는(=옛) 배정은 그대로 축으로 읽어야 하고, 컬럼을 지우면
--    0268a 적용 전에 배포된 코드가 죽는다(expand/contract). 새 배정은 `slot_picks`를 채운다.
-- 🔴 시각은 `time[]`이 아니라 **`text[]`**다 — 앱·RPC·화면이 내내 `"HH:MM"` 문자열 하나로 슬롯을 가리키고
--    (`class_sheet_plan_lines.slot_start`를 5자로 잘라 쓰는 규약), 여기서만 `time`으로 두면 PostgREST가
--    `16:20:00`으로 돌려줘 비교가 한 글자 차이로 어긋난다. 요일까지 붙으므로 더더욱 text다.
--
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다([[#95]]) — 조회가 `slot_picks` 없이 한 번 더 시도하고(폴백),
--    그 경우 옛 축 방식으로 읽는다. 새 배정 저장만 "잠시 뒤 다시" 안내로 막힌다(기입 자체는 된다).
--
-- 롤백:
--   alter table public.class_textbook_plans drop column if exists slot_picks;
set local statement_timeout = '60s';

alter table public.class_textbook_plans
  add column if not exists slot_picks text[];

-- 크기 가드 — 빈 배열은 "고른 게 없다"가 아니라 **실수**라 막는다(그 뜻은 null이다).
-- 상한 48 = 주 6일 × 하루 4교시보다 넉넉하다(요일까지 세므로 시각 기준이던 12로는 모자란다).
-- ⚠️ 형식(`"mon|17:20"`)은 여기서 안 막는다 — CHECK엔 서브쿼리·집계를 못 쓰고, 배열 원소마다 정규식을 거는
--    표현은 불변(IMMUTABLE)이 아닌 함수를 끌어들인다. 쓰는 쪽이 하나뿐이라(쓰기 정책 0개 = 서버 액션 전용)
--    형식은 앱이 지킨다: `saveClassTextbookPlan`이 시간표에서 뽑은 값만 넣고 `parseSlotPick`으로 한 번 더 거른다.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_textbook_plans_slot_picks_len') then
    alter table public.class_textbook_plans
      add constraint class_textbook_plans_slot_picks_len check (
        -- ⚠️ `array_length('{}', 1)`은 **NULL**이라 `NULL between 1 and 48`도 NULL이고, CHECK는 NULL을
        --    통과시킨다 — coalesce가 없으면 빈 배열이 그대로 들어온다(주석이 약속한 것과 달라진다).
        slot_picks is null or coalesce(array_length(slot_picks, 1), 0) between 1 and 48
      );
  end if;
end $$;

comment on column public.class_textbook_plans.slot_picks is
  '이 배정이 태울 교시 목록("요일|시작시각", 예 mon|17:20 — 0268a). null이면 옛 방식(slot_axis 축)으로 읽는다.';

notify pgrst, 'reload schema';
