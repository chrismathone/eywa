-- 0118a_onescreen_session_teacher_axis.sql (손수 alpha)
-- onescreen_daily_sessions(0065a)의 유니크가 (tenant, student, date) 1행이라, 같은 학생을 같은 날 가르치는
-- 두 강사(예: 수학·영어)가 각자 upsert하면 subject_progress를 통째 교체 + 학생단위 스칼라(점수/태도/특이사항)까지
-- 서로 덮어써 상대 강사의 '작업중(미저장)' 상태가 유실됐다(로스터 복원은 이 세션에서 읽음). 강사축을 유니크에
-- 추가해 강사별 1행으로 분리한다 — updated_by(=저장한 강사) 재사용(신규 컬럼 없이). 로스터는 updated_by=본인으로 조회.
-- 기존 행: 옛 유니크가 (tenant,student,date) 유일을 보장했으므로 updated_by 추가로 중복이 생기지 않는다(무손실).
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'onescreen_daily_sessions_tenant_id_student_id_session_date_key'
  ) then
    alter table onescreen_daily_sessions
      drop constraint onescreen_daily_sessions_tenant_id_student_id_session_date_key;
  end if;
end $$;

-- 강사별 1행 = upsert 충돌 타겟. updated_by는 saveOnescreenSession이 항상 user.id로 채운다(비null).
create unique index if not exists onescreen_daily_sessions_teacher_uniq
  on onescreen_daily_sessions (tenant_id, updated_by, student_id, session_date);
