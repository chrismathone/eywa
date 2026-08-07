-- 0192a — 단가 종류에 '기타비용'(extra)을 추가하고, 부대비용 4건을 그 값으로 확정.
--
-- 원장 2026-08-07: *"레벨 테스트 비용 및 셔틀버스비 스터디케어, 시스템 사용료는 기타비용"*.
-- 이 넷은 수업이 아니라 회당도 월도 아니다 → 예전 값 집합(per_session/monthly/discount)엔 담을 칸이
-- 없어 **미지정으로 남을 수밖에 없었고**, 그래서 단가표가 "아직 안 골랐다"고 영영 재촉하고 있었다.
--
-- 🔴 **이 파일을 먼저 적용해야 한다.** `pricing_mode`에는 CHECK 제약이 걸려 있어
--    (`tuition_catalog_pricing_mode_check`), 값 집합을 넓히기 전에 앱에서 '기타비용'을 고르면
--    저장이 제약 위반으로 거절된다. 앱 배포보다 SQL이 앞서야 하는 경우다(gotcha #95의 반대 방향).
--
-- ⚠️ 제약 이름은 실측(2026-08-07) 그대로. 없으면 drop이 조용히 넘어가도록 IF EXISTS를 쓴다.
-- ⚠️ 값 집합만 넓힌다 — 기존 세 값은 그대로 유효하다(되돌릴 땐 extra를 쓰는 행부터 비우고 제약 축소).

alter table public.tuition_catalog
  drop constraint if exists tuition_catalog_pricing_mode_check;

alter table public.tuition_catalog
  add constraint tuition_catalog_pricing_mode_check
  check (pricing_mode = any (array['per_session'::text, 'monthly'::text, 'extra'::text, 'discount'::text]));

-- 부대비용 4건(적용 직전 실측: '기타' 분류의 미지정 전부)
--   레벨 테스트 비용 20,000 · 셔틀버스비 20,000 · 스터디케어 50,000 · 시스템 사용료 30,000
-- ⚠️ '기타' 분류의 **미지정만** 건드린다 — 같은 분류에 이미 회당 단가로 정해 둔 6건은 그대로 둔다.
update public.tuition_catalog
   set pricing_mode = 'extra', updated_at = now()
 where category = '기타'
   and pricing_mode is null;

-- 확인용(적용 후): 미지정이 0건이어야 한다.
--   select coalesce(pricing_mode,'(미지정)') as mode, count(*) from public.tuition_catalog
--    where is_active group by 1 order by 1;
