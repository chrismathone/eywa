-- 0204a — 등록상담 동의 스냅샷 (2026-08-12 개인정보 법적 검토)
--
-- **문제**: 동의 기록이 `privacy_agreement boolean` 하나뿐이었다. 언제 동의했는지, 어떤 문구에
-- 동의했는지, 무엇에 동의했는지가 전부 없다. 게다가 동의 문구는 `tenant_settings.data`에 살면서
-- 원장이 학원설정에서 고치면 **덮어써진다** → 문구를 한 번 고치는 순간, 그 이전에 동의한 학부모가
-- 무엇에 동의했는지 재현할 방법이 사라진다.
--
-- 개인정보보호법상 **동의를 받았다는 입증 책임은 학원에 있다.** 증명하지 못하면 안 받은 것과 같다.
-- 그래서 동의 시점의 **문구 전문까지** 상담 행에 함께 얼려 둔다(설정을 나중에 고쳐도 과거 동의 불변).
--
-- 구조(`src/lib/consent/snapshot.ts` ConsentSnapshot, 순수 모듈 + Vitest):
--   { version: 1, agreedAt: ISO, source: 'public_intake'|'staff_form',
--     items: [ { key, label, agreed, text, textHash } … ] }
--   key = privacy(제15조) · overseas(제28조의8) · sensitive(제23조) · service(약관)
--   🔴 법은 이 셋을 **각각 별도로** 동의받도록 요구한다 — 하나로 묶으면 포괄 동의라 셋 다 무효 소지.
--
-- ⚠️ 앱은 이 컬럼이 **없어도 돌아간다**(#95, expand/contract): 조회는 `select("*")` 계열이라 없으면
--    undefined(=동의 없음으로 판정, fail-closed), 저장은 컬럼 부재를 감지해 스냅샷을 뺀 채 다시 저장한다
--    (접수 자체는 절대 막지 않는다 — 학부모가 폼을 다 채우고 실패하는 것이 가장 나쁘다).
--    ⚠️ 단 이 SQL을 적용하기 전까지는 **동의를 증명할 수 없는 상태가 이어진다** → 되도록 즉시 적용할 것.
--
-- 되돌리기 = alter table enrollment_consultations drop column consent_snapshot;
set local statement_timeout = '60s';

alter table enrollment_consultations
  add column if not exists consent_snapshot jsonb;

comment on column enrollment_consultations.consent_snapshot is
  '동의 스냅샷 — 동의 시각·항목별 동의 여부·그 시점 문구 전문/지문. 학원설정 문구가 바뀌어도 과거 동의를 재현하기 위한 증빙. 0204a, 2026-08-12 개인정보 검토.';

-- 동의 이력 조회(감사·분쟁 대응)용 — 스냅샷이 있는 행만 훑는다.
create index if not exists enrollment_consultations_consent_idx
  on enrollment_consultations (tenant_id, created_at desc)
  where consent_snapshot is not null;
