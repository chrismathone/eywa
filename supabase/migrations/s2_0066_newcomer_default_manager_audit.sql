-- s2_0066_newcomer_default_manager_audit.sql — 신규생 '과목 기본 담당'을 바꾸면 같은 거래에서 감사로그에 남긴다 · 2026-11-11
-- ✅ 운영 적용 2026-11-11(앱보다 먼저 · 거래 안 ROLLBACK 시험 뒤 적용 — 교체·새 줄·직결 쓰기에 감사 줄이 하나씩 · 담당자가 그대로인 고침과 검증 트리거가 막은 쓰기는
--    줄 없음 · 과목 이름이 대상 칸에 남는 것 · 과목 목록이 없는 지점은 키로 남는 것 · service_role 전용 실행권 확인. 시험 기록은 거래째 되돌렸다 — 기본 담당 세 줄과
--    감사로그 0건 그대로). 적용 기록 = supabase/migrations/README.md(2026-11-11 신규생 과목 기본 담당 편집).
--
-- 왜: 과목 기본 담당 표(student_onboarding_manager_defaults · s2_0062)는 검증 트리거만 있고 변경 기록이 없다. 직접 지정하지 않은 학생 전체의
--   관리 담당이 이 표 한 줄로 바뀌는데(신규생 관리 화면의 '기본 담당 설정' · 2026-11-11 Claude·Codex 합의안), 앱의 logAction은 실패를 삼켜
--   기록 없이 바뀔 수 있다. 과목별 배정 표의 이력 트리거(audit_onboarding_followup · s2_0061)는 student_id가 있는 표 전용이라 여기에 못 건다.
-- 무엇: 전용 트리거 함수 audit_onboarding_default_manager() + AFTER INSERT OR UPDATE 트리거 onboarding_default_manager_audit.
--   담당자가 **실제로 바뀐** 쓰기(새 줄 · manager_id가 달라진 고침)에만 audit_logs 한 줄을 넣는다 — 같은 거래라 기록이 실패하면 변경도 되돌아간다.
--   실행자 = updated_by(저장한 직원 — 검증 트리거 validate_onboarding_subject_manager가 같은 지점 직원임을 먼저 확인한다) ·
--   대상 = 과목 이름(그때의 이름 — 학원 설정의 과목 목록에서 읽는다 · 못 찾으면 과목 키) · 상세 = 과목 키 · 그때의 과목 이름 ·
--   이전·새 담당자(id와 그때의 이름). 앱 밖에서 표를 직접 고쳐도(운영 SQL) 같은 줄이 남는다.
--   과목 이름을 함께 남기는 까닭: 대상 칸은 슬랙 알림에 그대로 나가고(키 'math'가 보이면 안 된다), 과목을 지운 뒤에는 화면이 이름을 되찾지 못한다.
--   학원 설정에 과목 목록을 저장한 적이 없는 학원(코드 기본 과목)은 키만 남는다 — 감사로그 화면이 과목 이름으로 접는다(describe.ts).
--   담당자가 그대로인 고침(updated_by·updated_at만 바뀜)은 남기지 않는다 · 지우기(DELETE)는 앱에 길이 없고 이 트리거도 보지 않는다.
-- 권한: 호출자 권한으로 돈다(security definer 아님) — 이 표에 쓰는 역할(service_role · 운영 직결)은 users·tenant_settings를 읽고 audit_logs에 쓸 수 있다
--   (2026-11-11 운영 확인: service_role의 users·tenant_settings SELECT · audit_logs INSERT 권한 · BYPASSRLS). audit_logs의 슬랙 인박스 트리거
--   (slack_enqueue_activity)는 보안 정의자이고 제 오류를 삼킨다(원본 쓰기를 막지 않는다). 이 파일이 처음 만드는 함수라 PUBLIC·anon·authenticated
--   실행권을 거둬도 기존 호출자가 없다(트리거 함수 실행권은 발화 때 검사하지 않는다 — #155).
-- 앱과의 순서: 앱보다 먼저 적용한다(#95) — 먼저 적용해도 옛 앱에는 이 표를 쓰는 화면이 없어 달라지는 것이 없다.
-- 다시 실행해도 같다(create or replace · drop trigger if exists). 한 거래로 적용한다(파일에 begin/commit 없음 — 적용하는 쪽이 감싼다).
-- 되돌리기: scripts/_oneoff/revert-s2_0066-newcomer-default-manager-audit.sql
create or replace function public.audit_onboarding_default_manager() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_old_id uuid;
  v_old_name text;
  v_new_name text;
  v_actor_name text;
  v_subjects jsonb;
  v_label text;
begin
  if tg_op = 'UPDATE' then
    -- 담당자가 그대로면 '변경'이 아니다(이전 → 새 담당이 같은 줄을 남기지 않는다).
    if new.manager_id is not distinct from old.manager_id then
      return null;
    end if;
    v_old_id := old.manager_id;
    select u.display_name into v_old_name from public.users u where u.id = v_old_id;
  end if;
  select u.display_name into v_actor_name from public.users u where u.id = new.updated_by;
  select u.display_name into v_new_name from public.users u where u.id = new.manager_id;

  -- 그때의 과목 이름 — 학원 설정의 과목 목록(배열)에서 이 키의 이름을 읽는다. 목록이 없거나 배열이 아니면 건너뛴다(오류로 저장을 막지 않는다).
  select ts.data #> '{operations,subjects}' into v_subjects from public.tenant_settings ts where ts.tenant_id = new.tenant_id;
  if jsonb_typeof(v_subjects) = 'array' then
    select nullif(btrim(s.item ->> 'label'), '') into v_label
    from jsonb_array_elements(v_subjects) as s(item)
    where s.item ->> 'key' = new.subject
    limit 1;
  end if;
  -- 과목 목록에 없는 영어 프로그램 줄(EiE) — 앱의 ENGLISH_TRACK_LABEL.eie와 같은 글자(가드 manager-defaults.test.ts가 맞춘다).
  if v_label is null and new.subject = 'eie' then
    v_label := 'EiE';
  end if;

  insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (
    new.tenant_id,
    new.updated_by,
    v_actor_name,
    'newcomer_default_manager_update', -- audit-action
    'newcomer_default_manager', -- audit-target-type
    coalesce(v_label, new.subject),
    jsonb_strip_nulls(jsonb_build_object(
      'subject', new.subject,
      'subjectLabel', v_label,
      'fromManagerId', v_old_id,
      'fromName', v_old_name,
      'toManagerId', new.manager_id,
      'toName', v_new_name
    ))
  );
  return null;
end $$;
revoke all on function public.audit_onboarding_default_manager() from public, anon, authenticated;
grant execute on function public.audit_onboarding_default_manager() to service_role;

drop trigger if exists onboarding_default_manager_audit on public.student_onboarding_manager_defaults;
create trigger onboarding_default_manager_audit after insert or update on public.student_onboarding_manager_defaults
  for each row execute function public.audit_onboarding_default_manager();
