-- 0288a — 성적 칸에 **월** 축을 더한다(원장 2026-09-23: *"시험일이 있으니까 월도 선택해서 볼수있게"*).
--
-- 왜 필요한가: 0283a의 유니크 키가 `(tenant, student, subject, school_year, term, exam_slot)`이라
-- **한 학기에 그 시험은 한 번뿐**이다. 중간·기말·듣기평가는 실제로 한 번씩이라 맞지만, 수학의
-- **월말평가는 달마다** 친다 — 10월 월말평가를 저장하면 9월 것을 덮어썼다(에러 없이 조용히).
--
-- 🔴 `exam_month`는 **not null default 0**이다(0 = 월을 안 쓰는 시험). nullable로 두면 NULL끼리는
--    안 겹쳐서 같은 중간고사 행이 여러 개 생기고 upsert가 갈라진다([[#113]] 계열).
-- 🔴 부분 유니크(WHERE)를 쓰지 않는다 — `ON CONFLICT (컬럼)` 추론이 안 돼 upsert가 전건 42P10으로
--    실패한다([[#113]]).
-- 🔴 **적용 순서: 새 배포가 올라간 뒤에 실행할 것.** 옛 코드는 옛 유니크 축(`ux_grades_term_slot`)을
--    `on conflict`로 가리키므로 인덱스를 먼저 지우면 그 사이 성적 저장이 42P10으로 전건 실패한다
--    (조회·화면은 멀쩡해 더 헷갈린다).
-- 🔴 **전체를 한 트랜잭션으로 묶었다** — 컬럼만 생기고 인덱스가 아직인 중간 상태가 커밋되면 앱이
--    '준비됨'으로 읽어 새 축으로 저장을 시도하고, 그 순간 되돌림 경로가 지난달을 덮을 수 있다.
--    실패하면 통째로 롤백되니 옛 상태 그대로 남는다(다시 실행하면 된다).
-- ⚠️ 앱은 이 SQL 전에도 산다([[#95]]) — `gradeMonthReady()`가 컬럼 유무를 보고, 없으면 옛 키로
--    저장하고 월 드롭다운을 안 세운다. 단 **월말평가 저장만은 잠긴다**(덮어쓰기를 막는 fail-closed).

begin;

alter table student_grades
  add column if not exists exam_month smallint not null default 0;

-- 🔴 **이미 있는 월말평가 행을 시험일의 달로 백필한다** — 안 하면 전부 `0`으로 남아 9월·10월 화면
--    어디에도 안 보이고(조회가 월로 좁힌다), 다시 적으면 새 행이 생겨 한 학기에 같은 시험이 두 벌이 된다.
--    ⚠️ 옛 유니크가 이미 "한 학기에 한 행"을 보장했으므로 이 백필은 중복을 만들 수 없다.
update student_grades
   set exam_month = extract(month from taken_on)::smallint
 where exam_slot = 'monthly'
   and exam_month = 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'student_grades_month_chk') then
    alter table student_grades
      add constraint student_grades_month_chk check (exam_month between 0 and 12);
  end if;
  -- 월을 쓰는 시험은 월말평가뿐이다 — 다른 시험에 월이 붙으면 같은 중간고사가 여러 행으로 갈린다.
  -- ⚠️ 반대 방향(월말평가인데 0)은 **막지 않는다** — `taken_on`이 NOT NULL이라 백필이 전부 채우지만,
  --    제약을 양방향으로 걸면 나중에 시험일 없는 행을 허용하는 순간 저장이 통째로 막힌다.
  if not exists (select 1 from pg_constraint where conname = 'student_grades_month_slot_chk') then
    alter table student_grades
      add constraint student_grades_month_slot_chk check (exam_month = 0 or exam_slot = 'monthly');
  end if;
end $$;

-- 유니크 축 교체: 옛 인덱스를 지우고 월을 포함한 새 인덱스를 만든다.
-- (순서가 중요하다 — 먼저 만들고 지우면 잠깐 두 인덱스가 같이 걸려 같은 행이 두 축으로 막힌다.)
drop index if exists ux_grades_term_slot;

create unique index if not exists ux_grades_term_slot_month
  on student_grades (tenant_id, student_id, subject, school_year, term, exam_slot, exam_month);

-- 조회 축(그 학기·그 시험·그 달) — 화면이 반 명단과 대조할 때 쓴다.
create index if not exists grades_term_slot_month_idx
  on student_grades (tenant_id, subject, school_year, term, exam_slot, exam_month);

commit;

-- PostgREST 스키마 캐시 갱신 — 없으면 새 컬럼을 한동안 "없다"고 답해 화면이 옛 모양으로 돈다.
notify pgrst, 'reload schema';
