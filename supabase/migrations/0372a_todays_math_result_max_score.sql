-- 오늘 수학 채점 결과에 시험지 만점(배점 합)을 더한다(원장 2026-10-17 *"같은 탭에 토글로 진행해"* — 성적관리 월말평가 칸 채우기).
--
-- 오늘 수학의 점수는 배점의 합이라 시험마다 만점이 다르다(조정 배점 → 원본 배점 → 균등). aywa 성적 칸은 (점수, 만점)을 함께 적으므로,
-- 만점을 모르면 "85"가 100점 만점의 85인지 알 수 없다 — 성적관리 화면은 **만점이 같을 때만** 채운다.
-- 칸 하나(nullable) + 반영 함수 교체(0371a 본문 그대로 + max_score). 옛 행은 null — 오늘 수학이 지문 버전을 올려(v2) 다음 동기화에
-- 기간 안의 날을 전부 다시 받아 채운다. 앱보다 먼저 적용한다(칸이 없을 때 새 함수 본문이 실패하므로 같은 거래에서 함께).
begin;
set local lock_timeout = '5s';

alter table public.todays_math_test_results add column if not exists max_score numeric
  check (max_score is null or (max_score > 0 and max_score <= 10000));
comment on column public.todays_math_test_results.max_score is '시험지 만점(배점 합). 모르면 null.';

create or replace function public.todays_math_apply_result_day(p_tenant uuid, p_date date, p_digest text, p_rows jsonb)
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_count integer;
begin
  if p_tenant is null or p_date is null or p_digest is null or p_digest !~ '^[0-9a-f]{64}$'
    or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception '오늘 수학 결과 반영 값이 올바르지 않습니다.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('todays_math_results:' || p_tenant::text || ':' || p_date::text, 0));

  create temp table if not exists tm_incoming (
    source_test_id uuid, student_id uuid, class_id uuid, kind text, title text, unit_name text, test_date date,
    question_count integer, max_score numeric, absent boolean, score numeric, correct_count integer, taken_at timestamptz
  ) on commit drop;
  truncate tm_incoming;
  insert into tm_incoming
  select r."sourceTestId", r."sourceStudentId", r."sourceClassId", r.kind, r.title, r."unitName", r."testDate",
         r."questionCount", r."maxScore", r.absent, r.score, r."correctCount", r."takenAt"
  from jsonb_to_recordset(p_rows) as r(
    "sourceTestId" uuid, "sourceStudentId" uuid, "sourceClassId" uuid, kind text, title text, "unitName" text, "testDate" date,
    "questionCount" integer, "maxScore" numeric, absent boolean, score numeric, "correctCount" integer, "takenAt" timestamptz
  );
  if exists (select 1 from tm_incoming where test_date is distinct from p_date) then
    raise exception '오늘 수학 결과의 날짜가 맞지 않습니다.';
  end if;
  -- 결시에 점수를 실어 보내면 지운다(표 CHECK로 거래가 통째 실패하지 않게).
  update tm_incoming set score = null, correct_count = null where absent;
  -- 만점이 범위 밖이면 모르는 값으로(표 CHECK로 그날 전체가 실패하지 않게).
  update tm_incoming set max_score = null where max_score is not null and (max_score <= 0 or max_score > 10000);
  delete from tm_incoming i where not exists (select 1 from public.students s where s.tenant_id = p_tenant and s.id = i.student_id);
  update tm_incoming i set class_id = null
    where class_id is not null and not exists (select 1 from public.classes c where c.tenant_id = p_tenant and c.id = i.class_id);

  delete from public.todays_math_test_results t
  where t.tenant_id = p_tenant and t.test_date = p_date
    and not exists (select 1 from tm_incoming i where i.source_test_id = t.source_test_id and i.student_id = t.student_id);

  insert into public.todays_math_test_results as t (
    tenant_id, source_test_id, student_id, class_id, kind, title, unit_name, test_date, question_count, max_score, absent, score, correct_count, taken_at, synced_at
  )
  select p_tenant, i.source_test_id, i.student_id, i.class_id, i.kind, i.title, i.unit_name, i.test_date, i.question_count, i.max_score, i.absent,
         i.score, i.correct_count, i.taken_at, now()
  from tm_incoming i
  on conflict (tenant_id, source_test_id, student_id) do update set
    class_id = excluded.class_id, kind = excluded.kind, title = excluded.title, unit_name = excluded.unit_name,
    test_date = excluded.test_date, question_count = excluded.question_count, max_score = excluded.max_score, absent = excluded.absent, score = excluded.score,
    correct_count = excluded.correct_count, taken_at = excluded.taken_at, synced_at = excluded.synced_at
  where (t.class_id, t.kind, t.title, t.unit_name, t.test_date, t.question_count, t.max_score, t.absent, t.score, t.correct_count, t.taken_at)
    is distinct from
    (excluded.class_id, excluded.kind, excluded.title, excluded.unit_name, excluded.test_date, excluded.question_count, excluded.max_score,
     excluded.absent, excluded.score, excluded.correct_count, excluded.taken_at);

  select count(*) into v_count from public.todays_math_test_results where tenant_id = p_tenant and test_date = p_date;
  insert into public.todays_math_result_days (tenant_id, test_date, digest, row_count, synced_at)
  values (p_tenant, p_date, p_digest, v_count, now())
  on conflict (tenant_id, test_date) do update set digest = excluded.digest, row_count = excluded.row_count, synced_at = excluded.synced_at;
  return v_count;
end $$;
revoke all on function public.todays_math_apply_result_day(uuid, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.todays_math_apply_result_day(uuid, date, text, jsonb) to service_role;

commit;
notify pgrst, 'reload schema';
