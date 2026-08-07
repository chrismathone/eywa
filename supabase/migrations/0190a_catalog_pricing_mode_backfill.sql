-- 0190a — 수강료 단가표: 단가 종류(pricing_mode)가 비어 있는 항목 중 **확실한 것만** 채운다.
--
-- 배경(원장 2026-08-07): *"EiE 수업이 전부 27만원으로 잡혀있는데 까딱하다가 1회당 27만원으로 계산되기 때문"*.
-- 계산기는 pricing_mode가 없으면 안전한 쪽(월 고정 = 곱셈 안 함)으로 넣지만, **왜 그런지가 데이터에 없어서**
-- 다음 사람이 회당으로 바꿔 놓으면 27만원 × N회가 된다. 사실을 데이터에 적어 그 문을 닫는다.
--
-- 🔴 **추측으로 채우지 않는다.** 실측(2026-08-07) 미지정 50건 중 여기서 손대는 것은 둘뿐:
--   · EIE 12건 (전부 270,000원) → 원장이 "월 27만원"이라고 확인한 사실 → monthly
--   · 할인 3건 → 할인 분류이므로 자명 → discount
--   나머지(수학 18 · 영어 11 · 국어 2 · 기타 4)는 **회당인지 월인지 사람만 안다.** 특히 영어는
--   미지정 금액대(24,000~40,875)와 회당으로 표시된 금액대(6,250~13,625)가 서로 달라, 금액만 보고
--   같은 종류로 묶으면 틀린다. 그 항목들은 단가표 화면에서 '미지정' 필터로 보고 직접 고르면 된다.
--   (계산기는 그때까지 각 행에 "구분을 골라 주세요" 경고를 띄운다.)
--
-- ⚠️ 멱등: pricing_mode가 비어 있는 행만 건드린다(이미 고른 값을 덮지 않는다).
-- ⚠️ 스키마 변경 없음 — 이 파일을 적용하기 전에 앱을 배포해도 안전하다(옛/새 데이터 둘 다에서 동작).

update public.tuition_catalog
   set pricing_mode = 'monthly', updated_at = now()
 where category = 'EIE'
   and pricing_mode is null;

update public.tuition_catalog
   set pricing_mode = 'discount', updated_at = now()
 where category = '할인'
   and pricing_mode is null;

-- 확인용(적용 후 실행해 보면 남은 미지정이 분류별로 몇 건인지 보인다):
--   select category, count(*) from public.tuition_catalog
--    where pricing_mode is null and is_active group by 1 order by 1;
