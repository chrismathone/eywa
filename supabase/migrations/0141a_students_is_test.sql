-- 0141a: 테스트 학생 플래그 — 집계 오염 차단 (2026-07-23, 원장 지시).
--
-- 왜: ClassNote 발송 테스트를 `학원이` 학생에게 하는데(원장 지침 — 실학생 오발송 방지), 그 테스트
-- 보고서가 **작성률 집계에 섞였다.** 실제로 화면에 이렇게 새어 나왔다:
--   · 계정도 없는 가짜 작성자 `테스트`·`테스트강사`가 강사로 등장(각 1건)
--   · 원장 계정 `박소선`이 0/0으로 등장(테스트 1건)
--   · 실강사 김민주(8건)·이수진(1건)의 **분자가 부풀려짐**
--
-- 왜 학생에 다는가: 테스트는 항상 **테스트 학생에게** 간다. 보고서마다 표시하면 새 테스트가 생길 때마다
-- 빠뜨리지만, 학생에 한 번 달면 그 학생 앞으로 생기는 모든 기록이 자동으로 빠진다(원천 차단).
--
-- ⚠️ **숨기는 플래그가 아니다.** 학생목록·발송 화면에는 그대로 보여야 한다 — 원장이 테스트하려면
--    `학원이`를 찾을 수 있어야 한다. 이 값은 **집계/통계에서만** 뺀다.
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

alter table students add column if not exists is_test boolean not null default false;

comment on column students.is_test is
  '테스트 전용 학생(ClassNote 발송 시험 등). 작성률 등 집계에서 제외 — 화면에서 숨기지는 않는다.';

-- 부분 인덱스: 테스트 학생은 극소수라 전체 인덱스는 낭비. 집계 쿼리가 "제외할 id 집합"을 뽑을 때만 쓴다.
create index if not exists students_is_test_idx on students (tenant_id) where is_test;

-- 현 데이터 지정 — `학원이`(발송 테스트 전용, 활성 수강 0·청구 0) 계열.
-- ⚠️ 이름으로 찍는다: 테스트 학생은 이름 규약(`학원이`)으로만 식별 가능하고, 실학생과 겹칠 위험은
--    `학원이`라는 이름 특성상 사실상 없다. 새 테스트 학생을 만들면 이 값을 직접 켤 것.
update students set is_test = true
where name in ('학원이', '학원이A')
  and tenant_id in (select id from tenants);
