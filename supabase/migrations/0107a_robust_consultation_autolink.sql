-- 0107a: 등록상담 ↔ 학생 로버스트 자동연결 (0088a 강화)
--
-- 배경: "배정 완료" 컬럼은 저장 상태가 아니라 파생 배지(상담 student_id 연결 + 학생 활성수강>=1).
-- 상담이 학생에 연결(student_id)돼 있으면, 어느 경로로 반 배정을 하든(학생상세·반배정·임포트) 배정완료가
-- 자동 표시된다. 문제는 orphan(student_id NULL) 상담 — 0088a 트리거는 (1) students 쪽에서만 발화해
-- "학생이 먼저, 상담이 나중" 순서를 못 잡고 (2) 정확 자연키라 학교표기차("신암초등학교" vs "신암초")를 놓쳤다.
--
-- 강화: (a) 학교표기 정규화(초등학교/중학교/고등학교 → 초/중/고), (b) 전화+이름 대체 매칭,
--       (c) 상담 쪽에도 BEFORE 트리거를 달아 "상담이 나중에 들어오는" orphan을 즉시 연결.
-- 안전: tier1(이름+학교정규화+학년)·tier2(전화+이름) 모두 **비퇴원 학생 중 유일 매칭일 때만** 연결(동명이인 방어).
--       진급(이름+학년추정)은 오연결 위험이라 자동 대상에서 제외(주기 검토로만).
-- 참고: enrollments 트리거는 두지 않는다 — 연결은 학생/상담 생성 시점에 끝나고 배정완료 배지는 파생이라
--       배정 순간 자동 표시되므로 중복이고, 대량 수강 임포트 시 성능만 갉아먹는다.

-- 1) 정규화 헬퍼 -------------------------------------------------------------
-- 학교 접미사 정규화(지역접두는 학교명 일부일 수 있어 건드리지 않음 — 예 '달성초'의 '달성').
create or replace function public.eywa_school_norm(s text)
returns text language sql immutable as $$
  select case when coalesce(s,'') = '' then '' else
    regexp_replace(
      regexp_replace(
        regexp_replace(replace(lower(btrim(s)), ' ', ''),
          '(초등학교|초등|초교)$', '초'),
        '중학교$', '중'),
      '(고등학교|고교)$', '고')
  end
$$;

-- 전화 숫자만(형식 차이 흡수).
create or replace function public.eywa_phone_digits(s text)
returns text language sql immutable as $$
  select regexp_replace(coalesce(s,''), '\D', '', 'g')
$$;

-- 상담(prospect_*) ↔ 학생(정규화 이름/학교/학년/전화) 매칭 단일 진실.
-- tier1: 이름정규화 + 학교정규화 + 학년.  tier2: 전화(>=9자리) + 이름정규화.
create or replace function public.eywa_cs_match(
  c_name text, c_school text, c_grade text, c_phone text,
  s_name_norm text, s_school text, s_grade text, s_phone text
) returns boolean language sql immutable as $$
  select
    ( lower(regexp_replace(coalesce(c_name,''), '\s+', '', 'g')) = coalesce(s_name_norm,'')
      and public.eywa_school_norm(c_school) = public.eywa_school_norm(s_school)
      and regexp_replace(coalesce(c_grade,''), '\s+', '', 'g') = regexp_replace(coalesce(s_grade,''), '\s+', '', 'g') )
    or
    ( length(public.eywa_phone_digits(c_phone)) >= 9
      and public.eywa_phone_digits(c_phone) = public.eywa_phone_digits(s_phone)
      and lower(regexp_replace(coalesce(c_name,''), '\s+', '', 'g')) = coalesce(s_name_norm,'') )
$$;

-- 2) 학생 기준 연결 — 이 학생에 매칭되는 미연결 상담을 연결(각 상담이 유일 매칭일 때만) -----------
create or replace function public.link_consultations_for_student(p_student uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select id, tenant_id, name_normalized, school, grade, parent_phone, status
    into s from public.students where id = p_student;
  if not found or s.status = 'withdrawn' then return; end if;

  update public.enrollment_consultations c
     set student_id = s.id, outcome = 'enrolled', updated_at = now()
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
     );
end $$;

-- 3) 트리거 함수 ------------------------------------------------------------
-- (a) students insert/update → 그 학생의 미연결 상담 연결 (0088a 대체, parent_phone도 감지).
create or replace function public.link_consultation_on_student()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.link_consultations_for_student(NEW.id);
  return NEW;
end $$;

-- (b) enrollment_consultations BEFORE insert/update → 기존 학생에 즉시 연결(유일 매칭일 때만).
--     "상담이 학생보다 나중에 들어오는" orphan 갭 차단. BEFORE라 별도 UPDATE 없이 NEW에 직접 기입.
create or replace function public.link_student_for_consultation()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cnt int; v_id uuid;
begin
  if NEW.student_id is not null then return NEW; end if;
  -- min(uuid)는 없으므로 array_agg[1]로 유일 후보 취득(v_cnt=1일 때만 사용).
  select count(*), (array_agg(s.id))[1] into v_cnt, v_id
    from public.students s
   where s.tenant_id = NEW.tenant_id and s.status <> 'withdrawn'
     and public.eywa_cs_match(NEW.prospect_name, NEW.prospect_school, NEW.prospect_grade, NEW.parent_phone,
                              s.name_normalized, s.school, s.grade, s.parent_phone);
  if v_cnt = 1 then
    NEW.student_id := v_id;
    NEW.outcome := 'enrolled';
  end if;
  return NEW;
end $$;

-- 4) 트리거 부착 ------------------------------------------------------------
drop trigger if exists trg_link_consultation_on_student on public.students;
create trigger trg_link_consultation_on_student
  after insert or update of status, name, school, grade, parent_phone on public.students
  for each row execute function public.link_consultation_on_student();

drop trigger if exists trg_link_student_for_consultation on public.enrollment_consultations;
create trigger trg_link_student_for_consultation
  before insert or update of prospect_name, prospect_school, prospect_grade, parent_phone
  on public.enrollment_consultations
  for each row execute function public.link_student_for_consultation();

-- 5) 일회성 백필(멱등 — student_id is null 가드) — 현 orphan 중 tier1/2 유일 매칭 즉시 연결.
update public.enrollment_consultations c
   set student_id = s.id, outcome = 'enrolled', updated_at = now()
  from public.students s
 where c.student_id is null
   and s.tenant_id = c.tenant_id
   and s.status <> 'withdrawn'
   and public.eywa_cs_match(c.prospect_name, c.prospect_school, c.prospect_grade, c.parent_phone,
                            s.name_normalized, s.school, s.grade, s.parent_phone)
   and not exists (
     select 1 from public.students s2
     where s2.tenant_id = c.tenant_id and s2.id <> s.id and s2.status <> 'withdrawn'
       and public.eywa_cs_match(c.prospect_name, c.prospect_school, c.prospect_grade, c.parent_phone,
                                s2.name_normalized, s2.school, s2.grade, s2.parent_phone)
   );
