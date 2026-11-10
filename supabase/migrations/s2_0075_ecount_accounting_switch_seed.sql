-- s2_0075 — 경영 분석: ECOUNT 회계 자료 가져오기 지점 스위치(`ecount_accounting`)를 첫 학원에 켜 둔다
-- 까닭(2026-11-11 Claude·Codex 검토 합의): ECOUNT 계정코드 → 경영 분류표(앱 코드 `ecount-ledger.ts`)는 첫 학원의 계정과목표 하나다.
--   같은 코드가 다른 지점에서는 다른 계정일 수 있어, 분류표가 맞다고 확인된 지점만 회계 자료 가져오기·ECOUNT 월별 대조를 연다.
--   판정은 운영 콘솔의 지점 스위치(tenant_licenses.feature = 'ecount_accounting' · 줄이 없으면 꺼짐 — 앱 `accounting-scope.ts`).
--   원장이 학원 설정을 고쳐 열 수 없다(이 표는 운영자만 쓴다 — 정책 0023a: 지점은 읽기만).
-- 무엇: 설정 행(tenant_settings)이 있는 지점 가운데 일반판이 아닌 지점(preset이 'generic'이 아닌 지점 = 지금은 첫 학원 하나)에만 켜진 줄을 넣는다.
--   지점 id를 적지 않는다. 설정 행이 없는 지점은 넣지 않는다(꺼진 쪽 — 앱의 프리셋 기본값과 달리 닫아 둔다).
--   다른 지점은 줄이 없어 꺼진 채다 — 분류표를 확인한 뒤 운영 콘솔 학원 상세 '기능·라이선스'에서 켠다.
-- 새 표·칸 없음(줄 추가뿐) · 이미 줄이 있으면 그대로 둔다(다시 실행해도 같다).
-- 🔴 앱보다 먼저(없으면 첫 학원의 회계 자료 올리기 칸이 안내 문구로 바뀐다). 되돌리기 = scripts/_oneoff/revert-s2_0075-ecount-accounting-switch-seed.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into public.tenant_licenses (tenant_id, feature, is_active)
select s.tenant_id, 'ecount_accounting', true
from public.tenant_settings s
where coalesce(s.data->>'preset', '') <> 'generic'
on conflict (tenant_id, feature) do nothing;

commit;
