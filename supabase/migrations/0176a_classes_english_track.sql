-- 0176a — 영어 반의 프로그램 구분: EiE / 인재원 영어 (2026-08-04).
--
-- 배경(원장 2026-08-04): *"상단 헤더에 (전체/EiE/인재원 영어) 토글버튼 만들고 on/off 할 수 있게.
-- EiE 수업이라는건 상단의 약자들 수업의 경우를 전부 EiE 수업이라고함. 영어과목으로 수업생성할때
-- EiE/인재원 영어 토글 가능하도록 배선까지해놓을것."*
--
-- 🔴 **이름으로 매번 추측하지 않고 반에 저장한다.** 지금은 반 이름 모양이 두 갈래로 갈려 있어
--    (약자형 `LS2a`·`MEC1-3` vs 한글형 `중등E_중2 정규 A`) 이름만 봐도 갈리지만, 이름은 사람이 바꾸는
--    값이라 판정 근거로 삼으면 **반 이름을 고치는 순간 분류가 조용히 뒤집힌다**(0175a가 `is_special`의
--    이름 폴백을 두고 경고한 것과 같은 함정). 백필만 이름으로 하고, 이후 진실은 이 컬럼 하나다.
--
-- 약자의 뜻은 코드·설정 어디에도 없었고(있던 사전은 `LAB`·`JJ` = 자리(방)뿐, 축이 다르다), 풀네임은
-- **청구 항목 원문**(makeedu 이관분 `invoices.line_items`, `[EiE]` 태그 725행·49종)에 남아 있었다:
--   DP=Dr.Phonics · PL=Pre Let's · RTT=Ready To Talk · LT=Let's Talk · LS=Let's Speak ·
--   LE=Let's Express · KW=Kopi Wang · PJ=Pre Junior · JP=Junior Plus · MEC=Middle School English Course.
-- (이 사전 자체는 화면에 필요해지면 그때 설정으로 — 지금은 분류에 필요 없다.)
--
-- 백필 규칙 = **반 이름이 `영문 2~4자 + 숫자`로 시작하면 EiE, 아니면 인재원 영어**.
-- 실측(2026-08-04, 영어 반 61개 전수): 약자형 27개(DP5·JP1·KW1·KW6·LS2a·LS2b·LS4·LS5·LT2·LT4·
-- MEC1-3·PJ5·PL2·RTT2 + 종강 13) / 한글형 34개(중등E_·중고E_·고등E_·고등특강(테스트) + 종강 5).
-- **경계에 걸치는 이름 0개** — 그래서 이 규칙을 1회성 백필로 쓴다(코드는 이 규칙을 갖지 않는다).
--
-- 🔴 화면 필터의 계약(코드가 지켜야 할 것):
--    · EiE = `english_track = 'eie'`
--    · 인재원 영어 = `english_track is distinct from 'eie'` ← **null(미분류)은 인재원 쪽에 보인다**.
--      양쪽 다 'eie'/'injaewon' 정확히 일치로 거르면 미분류 반이 **두 필터 모두에서 사라진다**
--      (이 프로젝트가 반복해 밟은 "쓴 게 안 보임"). 잘못된 칸에 보이는 건 눈에 띄어 고쳐지지만,
--      사라지는 건 아무도 모른다.
--
-- 🔴 배포 순서 = **이 마이그레이션이 코드보다 먼저**(2026-08-03 강사 원스크린 먹통 재발 방지).
--    컬럼 없이 english_track을 select/insert하는 코드가 올라가면 PostgREST 42703으로 그 화면이 죽는다.
--    적용 확인:
--      select column_name from information_schema.columns
--       where table_name='classes' and column_name='english_track';
--      select english_track, count(*) from public.classes where subject='english' group by 1;
--      notify pgrst, 'reload schema';
--
-- ⚠️ **의도적 비소비처**(#92 — 안 적힌 건 닫힌 걸로 오인된다):
--    · 돈 계열 전부 — 청구·시수·분배·급여는 이 값을 안 본다(골든마스터 무관). EiE/인재원은 표시·필터 축이다.
--    · 시간표·출석부·수업보고서 — 영어 반은 지금과 똑같이 전부 보인다. 이 컬럼은 ECS 화면의 보기 필터와
--      반 설정 표시에만 닿는다. (ECS '작성률 분모'도 **안 바꾼다** — 분모를 필터에 묶으면 LAB·JJ 토글과
--      곱해져 "보이는 교시 = 세는 교시" 계약이 두 축으로 갈라진다. 필터는 눈으로 좁혀 보는 용도다.)
--    · 다른 과목 — subject <> 'english' 행은 null 그대로 둔다(수학에 트랙 개념이 없다).
--    · RLS 변경 없음(classes의 tenant_isolation 그대로). 인덱스 없음(반 수십~백 행, 필터는 JS에서).
--
-- ⚠️ 형제 컬럼과 축이 다르다 — `is_special`(특강 여부)·`report_optout`(보고서 미발송)과 무관하게 조합된다.
--
-- 롤백: alter table public.classes drop column if exists english_track;  (코드가 먼저 내려가야 한다)

alter table public.classes
  add column if not exists english_track text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'classes_english_track_check'
  ) then
    alter table public.classes
      add constraint classes_english_track_check
      check (english_track is null or english_track in ('eie', 'injaewon'));
  end if;
end $$;

-- 백필 — 영어 반이면서 아직 미분류인 행만(멱등: 다시 돌려도 사람이 고친 값을 안 덮는다).
update public.classes
   set english_track = case when class_name ~ '^[A-Za-z]{2,4}[0-9]' then 'eie' else 'injaewon' end
 where subject = 'english'
   and english_track is null;

comment on column public.classes.english_track is
  '영어 프로그램 구분(0176a) — ''eie''(EiE 프랜차이즈 레벨 수업: DP·PL·RTT·LT·LS·LE·KW·PJ·JP·MEC 약자 반) / ''injaewon''(인재원 자체 영어) / null(미분류·비영어). ECS 헤더 보기 필터와 반 설정 토글의 단일 소스. 필터 계약: EiE는 = ''eie'', 인재원 영어는 is distinct from ''eie''(미분류가 사라지지 않게). 작성률 분모·돈 계산에는 닿지 않는다.';
