-- 0257a_consultation_autolink_homonym_guard.sql (손수 alpha)
--
-- 배경(2026-09-10 실사고 — 김근우 건):
--   학부모가 QR로 접수한 **새 학생** 김근우(대구일중 중1)가, 이미 재원 중인 **다른 아이** 김근우(대구일중 중1,
--   makeedu 원생)와 이름·학교·학년이 같다는 이유만으로 접수 순간 자동 연결됐다(0107a tier1). 두 아이의 보호자
--   이름·연락처는 서로 달랐지만 tier1은 연락처를 보지 않는다.
--   연결된 상담은 화면에서 '수업 배정' 대신 '학생 정보 보기'가 되어, 동명이인 접미사(김근우A)를 붙이는 방어로직
--   (convertConsultationToStudent)이 **실행될 기회가 없었고**, 직원은 기존 아이 화면에서 새 아이의 수학 반 2개와
--   교재를 배정했다. makeedu 보내기도 "이미 원생인 학생에 연결됨"으로 막혔다.
--   게다가 이 연결은 트리거 안에서 일어나 **감사로그가 0줄**이라 누가 무엇을 했는지 되짚을 수 없었다.
--
-- 고침(앱 코드가 이 파일에 의존하지 않는다 — 적용 순서 무관, #95):
--   ① tier1(이름+학교+학년)은 **양쪽 보호자 연락처가 둘 다 확실한 국내 번호이고 서로 다르면** 매칭하지 않는다
--      (다른 가족). '확실한 국내 번호' = 숫자만 남겨 0으로 시작하는 9~11자리, +82는 0으로 바꿔 본다(`eywa_phone_kr`).
--      그 모양이 아니면 — 연락처 칸의 금액·암호화 흔적·번호 두 개(실측 2026-09-10: 상담 236건·학생 13건) —
--      **모순 증거로 치지 않는다**. 깨진 값으로 같은 가족의 연결까지 막으면 옛 상담 백로그가 영영 안 붙는다.
--      tier2(연락처 숫자 일치 + 이름)는 불변.
--      🔑 비대칭: 같은 아이를 못 붙이면 '수업 배정'이 접미사 학생(○○A)을 만들고 "같은 학생이면 정리하세요"를
--      띄운다 — 되돌릴 수 있다(중복 병합). 다른 아이를 붙이면 두 아이의 상담·수강·교재·청구가 **조용히** 섞인다.
--      그래서 확실한 모순 증거(다른 번호)가 있으면 붙이지 않는 쪽을 택한다.
--      실측: 현재 연결 325건 중 이 규칙이면 안 붙었을 것 = 2건(둘 다 같은 아이·다른 보호자 번호 — 수용한 비용).
--   ② 자동 연결을 **트리거가 직접 감사로그에 남긴다**(action `consultation_autolink`). 앱 한 곳에서 남기면
--      학생 쪽 트리거(학생 등록·수정 → 옛 상담 연결)가 빠진다. best-effort — 기록 실패가 접수·저장을 막지 않는다.
--      실행자는 **'시스템(자동 연결)'** 로 적는다(그 저장을 한 직원이 연결을 "결정"한 게 아니다). 저장한 직원이
--      있으면 metadata.userId에만 남긴다.
--   ③ 새 definer 함수와 옛 `link_consultations_for_student`를 **RPC로 못 부르게** revoke한다(아래 6).
--
-- ⚠️ 알려진 한계: 기록을 BEFORE 트리거에서 쓰므로 `INSERT … ON CONFLICT DO NOTHING`으로 **버려진** 행도 기록이
--    남는다(존재하지 않는 consultationId). makeedu 예비상담 동기화는 삽입 대상을 미리 걸러 보내므로 실제로는
--    동기화가 동시에 두 번 돌 때만 생긴다. 뷰어에선 자동 연결 행이 같은 요청의 QR 접수 행보다 **조금 앞 시각**으로
--    찍힌다(연결은 상담 INSERT 안에서, 접수 기록은 그 뒤에 쓴다) — 실제 순서 그대로다.
-- ⚠️ 감사로그 액션/대상 값에는 `-- audit-action` / `-- audit-target-type` 표식을 단다 — 레지스트리 가드
--    (src/features/audit/actions-registry.test.ts)가 이 표식으로 SQL이 쓰는 키를 찾아 한글 라벨 누락을 잡는다.
--
-- 기존 연결은 건드리지 않는다(백필 없음). 실측 2026-09-10: 연락처가 어긋나는데 연결된 QR 접수는 김근우 1건뿐
-- (수동 정정 완료).
--
-- 롤백: 0107a의 eywa_cs_match + 0113a의 두 함수(link_consultations_for_student·link_student_for_consultation)를
--       다시 실행하고 `drop function public.eywa_cs_match_rule(text,text,text,text,text,text,text,text)`,
--       `drop function public.eywa_log_consultation_autolink(uuid,uuid,text,uuid,text,text)`,
--       `drop function public.eywa_phone_kr(text)`. 트리거는 함수 이름으로 참조하므로 재부착 불요.
--       (revoke는 그대로 둬도 된다 — 앱은 이 함수들을 RPC로 부르지 않는다.)

begin;

-- 1) 확실한 국내 번호만 돌려준다(아니면 null) — '다른 번호'를 모순 증거로 쓸지 가르는 기준 ---------------------
create or replace function public.eywa_phone_kr(s text)
returns text language sql immutable as $$
  -- 0으로만 된 자리채움(010-0000-0000·000-0000-0000)은 번호가 아니다 — 모순 증거로 쓰면 같은 가족이 안 붙는다.
  select case when y.n ~ '^0(10)?0+$' then null else y.n end
  from (
    select case
      when x.d ~ '^0[0-9]{8,10}$' then x.d
      when x.d ~ '^82[0-9]{8,10}$' then '0' || substr(x.d, 3)   -- +82 10-… → 010-…
      else null
    end as n
    from (select public.eywa_phone_digits(s) as d) x
  ) y
$$;

-- 2) 매칭 규칙 — 어느 규칙으로 맞았는지 돌려준다(감사로그 근거). null = 불일치 ---------------------------
create or replace function public.eywa_cs_match_rule(
  c_name text, c_school text, c_grade text, c_phone text,
  s_name_norm text, s_school text, s_grade text, s_phone text
) returns text language sql immutable as $$
  select case
    -- 이름이 다르면 무엇이 같아도 불일치(0107a와 같은 정규화)
    when lower(regexp_replace(coalesce(c_name, ''), '\s+', '', 'g')) <> coalesce(s_name_norm, '') then null
    -- tier2: 연락처(9자리+) 숫자 일치 + 이름 (0107a 그대로)
    when length(public.eywa_phone_digits(c_phone)) >= 9
         and public.eywa_phone_digits(c_phone) = public.eywa_phone_digits(s_phone) then 'phone_name'
    -- tier1: 이름 + 학교 + 학년 — 단 양쪽이 확실한 국내 번호이고 서로 다르면 다른 가족(0257a)
    when public.eywa_school_norm(c_school) = public.eywa_school_norm(s_school)
         and regexp_replace(coalesce(c_grade, ''), '\s+', '', 'g') = regexp_replace(coalesce(s_grade, ''), '\s+', '', 'g')
         and not (public.eywa_phone_kr(c_phone) is not null
                  and public.eywa_phone_kr(s_phone) is not null
                  and public.eywa_phone_kr(c_phone) <> public.eywa_phone_kr(s_phone))
      then 'name_school_grade'
    else null
  end
$$;

-- 매칭 단일 진실(시그니처 불변 — 두 트리거 함수가 이 이름으로 부른다).
create or replace function public.eywa_cs_match(
  c_name text, c_school text, c_grade text, c_phone text,
  s_name_norm text, s_school text, s_grade text, s_phone text
) returns boolean language sql immutable as $$
  select public.eywa_cs_match_rule(c_name, c_school, c_grade, c_phone,
                                   s_name_norm, s_school, s_grade, s_phone) is not null
$$;

-- 3) 자동 연결 감사로그 — 트리거 두 곳이 같이 쓴다 --------------------------------------------------------
create or replace function public.eywa_log_consultation_autolink(
  p_tenant uuid, p_consultation uuid, p_label text, p_student uuid, p_rule text, p_via text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_user uuid;
begin
  -- 저장한 직원(있으면) — 서비스 롤·동기화 스크립트는 세션이 없어 null이다.
  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;
  if v_uid is not null then
    select u.id into v_user from public.users u where u.id = v_uid;
  end if;

  begin
    insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
    values (
      p_tenant,
      null,
      '시스템(자동 연결)',
      'consultation_autolink', -- audit-action
      'enrollment_consultations', -- audit-target-type
      p_label,
      jsonb_strip_nulls(jsonb_build_object(
        'consultationId', p_consultation,
        'studentId', p_student,
        'rule', p_rule,
        'via', p_via,
        'userId', v_user
      ))
    );
  exception when others then
    null; -- 감사 기록 실패가 상담 접수·학생 저장을 막으면 안 된다(logAction과 같은 best-effort)
  end;
end $$;

-- 4) 상담 쪽 BEFORE 트리거 — 유일 매칭일 때만 연결 + 기록. outcome은 건드리지 않는다(0113a) ------------------
create or replace function public.link_student_for_consultation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cnt int;
  v_id uuid;
  v_rule text;
begin
  if NEW.student_id is not null then return NEW; end if;
  -- min(uuid)가 없어 array_agg[1]로 유일 후보를 취한다(v_cnt=1일 때만 사용 — 두 배열이 같은 행 순서).
  select count(*), (array_agg(s.id))[1], (array_agg(m.rule))[1]
    into v_cnt, v_id, v_rule
    from public.students s
    cross join lateral (
      select public.eywa_cs_match_rule(NEW.prospect_name, NEW.prospect_school, NEW.prospect_grade, NEW.parent_phone,
                                       s.name_normalized, s.school, s.grade, s.parent_phone) as rule
    ) m
   where s.tenant_id = NEW.tenant_id
     and s.status <> 'withdrawn'
     and m.rule is not null;
  if v_cnt = 1 then
    NEW.student_id := v_id;
    -- 🔴 호출 자체를 예외 블록으로 감싼다 — 로거 안의 예외 처리는 **호출 시점 오류**(권한·함수 없음)를 못 막는다.
    --    기록 한 줄 때문에 학부모의 QR 접수가 실패하면 안 된다(적대 재리뷰 2026-09-10).
    begin
      perform public.eywa_log_consultation_autolink(
        NEW.tenant_id, NEW.id, NEW.prospect_name, v_id, v_rule,
        case when coalesce(NEW.from_public_intake, false) then 'intake' else 'consultation' end
      );
    exception when others then
      null;
    end;
  end if;
  return NEW;
end $$;

-- 5) 학생 쪽 — 학생 등록·수정 시 그 학생에 맞는 미연결 상담 연결 + 기록(각 상담이 유일 매칭일 때만) ----------
create or replace function public.link_consultations_for_student(p_student uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  r record;
begin
  select id, tenant_id, name_normalized, school, grade, parent_phone, status
    into s from public.students where id = p_student;
  if not found or s.status = 'withdrawn' then return; end if;

  for r in
    update public.enrollment_consultations c
       set student_id = s.id, updated_at = now()   -- 0113a: outcome 강제 없음
     where c.tenant_id = s.tenant_id
       and c.student_id is null
       and public.eywa_cs_match(c.prospect_name, c.prospect_school, c.prospect_grade, c.parent_phone,
                                s.name_normalized, s.school, s.grade, s.parent_phone)
       -- 동명이인 방어: 이 상담이 다른 비퇴원 학생과도 매칭되면(모호) 연결하지 않음.
       and not exists (
         select 1 from public.students s2
         where s2.tenant_id = c.tenant_id and s2.id <> s.id and s2.status <> 'withdrawn'
           and public.eywa_cs_match(c.prospect_name, c.prospect_school, c.prospect_grade, c.parent_phone,
                                    s2.name_normalized, s2.school, s2.grade, s2.parent_phone)
       )
    returning c.id, c.prospect_name,
              public.eywa_cs_match_rule(c.prospect_name, c.prospect_school, c.prospect_grade, c.parent_phone,
                                        s.name_normalized, s.school, s.grade, s.parent_phone) as rule
  loop
    -- 호출 시점 오류(권한·함수 없음)까지 삼킨다 — 기록 한 줄 때문에 학생 저장이 실패하면 안 된다(위 4와 같은 이유).
    begin
      perform public.eywa_log_consultation_autolink(s.tenant_id, r.id, r.prospect_name, s.id, r.rule, 'student');
    exception when others then
      null;
    end;
  end loop;
end $$;

-- 6) RPC로 직접 부르지 못하게 — 트리거(함수 소유자 권한)만 부른다(적대 리뷰 2026-09-10, 0114a 선례) -----------
--    definer라 RLS를 우회하므로, 열어 두면 로그인한 누구나 '시스템(자동 연결)' 명의의 가짜 감사로그를 — p_tenant를
--    바꿔 남의 학원에까지 — 쓸 수 있다(0219a의 "본인 명의로만 쓴다"가 뚫린다). link_consultations_for_student는
--    0107a부터 열려 있던 구멍(아무 학생 uuid로 연결을 강제 실행)인데 이제 감사로그까지 쓰므로 같이 닫는다.
--    앱은 둘 다 RPC로 부르지 않는다(2026-09-10 src·scripts 전수 확인). 트리거 안의 호출은 소유자 권한이라 영향 없음.
revoke all on function public.eywa_log_consultation_autolink(uuid, uuid, text, uuid, text, text) from public;
revoke all on function public.eywa_log_consultation_autolink(uuid, uuid, text, uuid, text, text) from anon;
revoke all on function public.eywa_log_consultation_autolink(uuid, uuid, text, uuid, text, text) from authenticated;
revoke all on function public.link_consultations_for_student(uuid) from public;
revoke all on function public.link_consultations_for_student(uuid) from anon;
revoke all on function public.link_consultations_for_student(uuid) from authenticated;

-- 7) 자기검증 — 적용 즉시 규칙이 의도대로인지 확인한다(실패하면 이 트랜잭션 전체가 롤백된다) -------------------
--    가상의 이름·번호만 쓴다(마이그레이션 파일에 실제 학생 연락처를 남기지 않는다).
--    ⚠️ 판정 함수만 검사한다 — 트리거 본문은 적용 후 테스트 학생('학원이')으로 QR 접수 1건을 넣어 확인할 것.
do $$
begin
  -- 이름·학교·학년은 같고 보호자 번호가 다르다 = 동명이인(김근우 건의 모양) → 연결하지 않는다
  assert public.eywa_cs_match_rule('홍길동', '대구일중', '중1', '01011112222',
                                   '홍길동', '대구일중', '중1', '010-3333-4444') is null,
    '0257a: 번호가 다른 동명이인이 매칭됨';
  assert public.eywa_cs_match('홍길동', '대구일중', '중1', '01011112222',
                              '홍길동', '대구일중', '중1', '010-3333-4444') = false,
    '0257a: eywa_cs_match가 규칙과 다름';
  -- 같은 가족(번호 같음, 표기만 다름) → 연락처·이름 규칙으로 연결
  assert public.eywa_cs_match_rule('홍길동', '대구일중', '중1', '010-3333-4444',
                                   '홍길동', '대구일중', '중1', '01033334444') = 'phone_name',
    '0257a: 같은 번호가 매칭 안 됨';
  -- 연락처가 한쪽에 없으면 종전대로 이름·학교·학년
  assert public.eywa_cs_match_rule('홍길동', '대구일중', '중1', null,
                                   '홍길동', '대구일중', '중1', '010-3333-4444') = 'name_school_grade',
    '0257a: 연락처 없는 상담이 매칭 안 됨';
  -- 번호가 아닌 값(짧은 금액·암호화 흔적·번호 두 개)은 모순 증거로 치지 않는다 → 종전대로
  assert public.eywa_cs_match_rule('홍길동', '대구일중', '중3', '338000',
                                   '홍길동', '대구일중', '중3', '010-3333-4444') = 'name_school_grade',
    '0257a: 짧은 잡음이 연결을 막음';
  assert public.eywa_cs_match_rule('홍길동', '대구일중', '중1', '333D2100E8110C4617AB',
                                   '홍길동', '대구일중', '중1', '010-3333-4444') = 'name_school_grade',
    '0257a: 암호화 흔적이 연결을 막음';
  assert public.eywa_cs_match_rule('홍길동', '대구일중', '중1', '010-1111-2222 / 010-5555-6666',
                                   '홍길동', '대구일중', '중1', '010-3333-4444') = 'name_school_grade',
    '0257a: 번호 두 개가 연결을 막음';
  -- +82 표기도 국내 번호로 본다(다른 번호면 모순)
  assert public.eywa_phone_kr('+82 10-1111-2222') = '01011112222', '0257a: +82 정규화';
  assert public.eywa_phone_kr('02-123-4567') = '021234567', '0257a: 9자리 지역번호';
  assert public.eywa_phone_kr('338000') is null, '0257a: 짧은 값은 번호가 아님';
  assert public.eywa_phone_kr('010-0000-0000') is null, '0257a: 0 자리채움은 번호가 아님';
  assert public.eywa_cs_match_rule('홍길동', '대구일중', '중1', '010-0000-0000',
                                   '홍길동', '대구일중', '중1', '010-3333-4444') = 'name_school_grade',
    '0257a: 0 자리채움이 연결을 막음';
  assert public.eywa_cs_match_rule('홍길동', '대구일중', '중1', '+82 10-1111-2222',
                                   '홍길동', '대구일중', '중1', '010-3333-4444') is null,
    '0257a: +82 번호의 모순을 놓침';
  -- 학교 표기 흔들림(0107a) 유지
  assert public.eywa_cs_match_rule('홍길동', '대구일중학교', '중1', null,
                                   '홍길동', '대구일중', '중1', null) = 'name_school_grade',
    '0257a: 학교 정규화 회귀';
  -- 이름이 다르면(접미사 포함) 무엇이 같아도 불일치
  assert public.eywa_cs_match_rule('홍길동A', '대구일중', '중1', '010-3333-4444',
                                   '홍길동', '대구일중', '중1', '010-3333-4444') is null,
    '0257a: 이름이 다른데 매칭됨';
end $$;

commit;
