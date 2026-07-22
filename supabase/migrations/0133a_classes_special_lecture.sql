-- 0133a: classes.is_special — '특강'(방학 단기강좌) 반을 **컬럼**으로 표시한다.
--
-- ⚠️ 번호 주의: 0132a는 이미 `0132a_class_salary_applies_dows.sql`(급여 요일 안분)이 쓰고 있어 0133a로 내렸다.
--
-- 🔴 배포 순서(필수): **이 마이그레이션을 코드보다 먼저 적용한다.**
--    앱 코드가 `classes.is_special`을 select/insert 하므로, 컬럼 없이 코드만 올라가면
--    ① 반 생성·수정이 전부 실패하고 ② `/timetable`이 500(fetchSlots가 이 컬럼을 select → PostgREST 42703
--    → fetchAllPaged throw) ③ 반 상세·수정이 404("반 없음")로 보인다. 릴리스 체크리스트에 넣을 것.
--    적용 확인:  select column_name from information_schema.columns
--                where table_name = 'classes' and column_name = 'is_special';
--    적용 뒤 PostgREST 스키마 캐시 갱신도 확인(캐시가 낡으면 같은 42703이 계속 난다):
--                notify pgrst, 'reload schema';
--
-- 왜 반 이름 매칭이 아니라 컬럼인가:
--  · 원장 요구(2026-07-22)는 **수업 생성 폼의 토글**이다. 이름에 '특강'을 넣도록 강요하면 실제 반 이름
--    규칙(`고등M 고1 BS4F 토`·`JP1`)과 충돌하고, 이름을 고치는 순간 분류가 조용히 뒤집힌다.
--  · 이 컬럼은 이름 규칙을 **대체하지 않고 우선**한다 — 컬럼 true면 특강, false면 이름 폴백
--    (하위호환: 이름에 '특강'이 든 기존 반은 토글을 안 켜도 계속 특강). 판정 단일소스 =
--    `src/features/classes/special-lecture.ts` `isSpecialLecture()`.
--  · 백필 없음: default false + 이름 폴백이라 기존 행은 손대지 않는다(실측 injaewon `class_name like '%특강%'` = 1건).
--
-- ⚠️ 소비처 범위(2026-07-22 현재): 이 컬럼을 보는 곳은 **시간표의 정규/특강 구분뿐**이다.
--    급여 과정 분류(`payroll/salary-group.ts` autoSalaryGroup)는 여전히 **반 이름만** 본다 — 두 판정이
--    공유하는 것은 이름 규칙(`hasSpecialLectureName`)이고 이 컬럼은 공유하지 않는다. 즉 토글만 켠 반은
--    시간표에선 특강, 급여 과정에선 미분류(또는 수납관리 수동 지정값)다. 급여까지 이 컬럼을 따르게
--    하려면 정산 조회가 is_special을 함께 읽어야 하고, 그건 **돈 산식 변경이라 골든마스터 게이트**를
--    다시 통과해야 한다(별도 작업). 폼 토글 문구도 이 한계를 명시한다.
--
-- ⚠️ 부분 인덱스 없음(의도): 특강 필터는 SQL이 아니라 페이지 JS(전 슬롯 조회 후 filter)에서 일어나
--    `where is_special` 인덱스는 **소비처가 0**이다(write 비용만 는다). 특강만 좁혀 읽는 쿼리를 실제로
--    만들 때 그 쿼리와 함께 추가할 것.
--
-- 롤백 = alter table public.classes drop column is_special;

alter table public.classes
  add column if not exists is_special boolean not null default false;

comment on column public.classes.is_special is
  '특강(방학 단기강좌) 반 = 시간표 특강 구분에만 노출. false여도 반 이름에 ''특강''이 있으면 특강으로 본다(이름 폴백, 0133a). 급여 과정 분류는 이 컬럼을 보지 않는다.';
