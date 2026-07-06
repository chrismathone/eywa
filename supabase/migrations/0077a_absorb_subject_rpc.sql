-- 과목 흡수(absorb) RPC — users.subjects[] 치환·중복제거 + 과목 키 jsonb 개명을 DB에서 원자 실행.
-- 손수 alpha(드리즐 무관), 멱등(create or replace). 배경: 클라 read-then-overwrite 루프는
-- ① 원스크린 800ms 자동저장 등 동시 쓰기를 스냅샷으로 덮어써 유실(레이스)
-- ② 행당 1 왕복 순차 루프라 행 누적 시 서버리스 타임아웃 — 적대리뷰 2026-07-06 확정 2건을 해소.
-- security invoker(0039a/0040a 패턴): PostgREST authenticated 세션으로 호출 → 내부 UPDATE에
-- 각 테이블 RLS가 그대로 적용 + auth_tenant_id() where 이중격리.
--
-- 의미는 src/features/owner/subject-absorb.ts 순수 헬퍼와 동일(Vitest가 정의):
--   배열: from→to 치환 후 첫 등장 순서 보존 dedupe (absorbSubjectInArray)
--   jsonb: from 키를 to로 개명, 양쪽 다 객체면 얕은 병합(to 우선), 아니면 to 우선 존치 (absorbJsonSubjectKey)
--   (미세 차이: to 키 값이 JSON null인 경우 SQL coalesce는 'null'::jsonb를 유지 — JS ??는 from을 취함.
--    실데이터에 JSON null 과목 항목은 쓰이지 않아 수용.)
create or replace function public.absorb_subject_key(p_from text, p_to text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := auth_tenant_id();
  n_users int;
  n_details int;
  n_progress int;
begin
  if v_tenant is null then
    raise exception 'absorb_subject_key: 인증된 테넌트가 없습니다';
  end if;
  if p_from !~ '^[a-z0-9_]{1,40}$' or p_to !~ '^[a-z0-9_]{1,40}$' or p_from = p_to then
    raise exception 'absorb_subject_key: 잘못된 과목 키';
  end if;

  -- users.subjects[] (강사 담당 과목): from→to 치환 + 첫 등장 순서 보존 dedupe
  update users u
  set subjects = (
    select coalesce(array_agg(x order by first_ord), '{}')
    from (
      select t.x, min(t.ord) as first_ord
      from unnest(array_replace(u.subjects, p_from, p_to)) with ordinality as t(x, ord)
      group by t.x
    ) s
  )
  where u.tenant_id = v_tenant and p_from = any(u.subjects);
  get diagnostics n_users = row_count;

  -- enrollment_consultations.subject_details (상담 과목별 점수)
  update enrollment_consultations
  set subject_details = (subject_details - p_from) || jsonb_build_object(
        p_to,
        case
          when jsonb_typeof(subject_details -> p_from) = 'object'
           and jsonb_typeof(subject_details -> p_to) = 'object'
            then (subject_details -> p_from) || (subject_details -> p_to)
          else coalesce(subject_details -> p_to, subject_details -> p_from)
        end),
      updated_at = now()
  where tenant_id = v_tenant and subject_details ? p_from;
  get diagnostics n_details = row_count;

  -- onescreen_daily_sessions.subject_progress (원스크린 진도 작업 상태)
  update onescreen_daily_sessions
  set subject_progress = (subject_progress - p_from) || jsonb_build_object(
        p_to,
        case
          when jsonb_typeof(subject_progress -> p_from) = 'object'
           and jsonb_typeof(subject_progress -> p_to) = 'object'
            then (subject_progress -> p_from) || (subject_progress -> p_to)
          else coalesce(subject_progress -> p_to, subject_progress -> p_from)
        end),
      updated_at = now()
  where tenant_id = v_tenant and subject_progress ? p_from;
  get diagnostics n_progress = row_count;

  return jsonb_build_object('users', n_users, 'subject_details', n_details, 'subject_progress', n_progress);
end;
$$;

grant execute on function public.absorb_subject_key(text, text) to authenticated;
revoke execute on function public.absorb_subject_key(text, text) from anon;
