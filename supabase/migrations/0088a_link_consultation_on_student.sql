-- 0088a: 학생 생성·활성화 시 같은 자연키의 미연결 상담을 자동 연결 (근본 차단)
--
-- 배경(치명적 재발 버그): eywa 등록상담을 makeedu로 역동기화하면 makeedu에서 학생이 되고,
-- 그 학생이 정동기화로 eywa에 다시 들어온다. 그런데 makeedu가 매기는 id가 상담↔학생 서로 달라
-- (상담 makeedu_id ≠ 학생 makeedu_id) 오직 자연키(정규화 이름+학교+학년)만이 동일인을 잇는다.
-- 정동기화 학생 임포트(import-students.cjs)는 기존 '학생'과만 매칭하고 '상담'은 보지 않아,
-- 상담이 orphan(student_id null)으로 남고 → 나중에 그 상담을 "수업 배정"(convert)하면
-- 학생을 또 INSERT하려다 ux_students_active_natural_key(부분 유니크) 위반으로 폭발했다.
--
-- 근본 대응: 학생이 만들어지거나 활성화될 때(어느 경로든 — sync/수동/convert/QR),
-- 같은 자연키의 미연결 활성 상담을 그 학생에 자동 연결한다. → orphan 상담이 구조적으로 불가능.
-- 자연키 정규화는 students.name_normalized 정의와 동일: lower(regexp_replace(name,'\s+','','g')).

-- 1) 트리거 함수 -------------------------------------------------------------
create or replace function public.link_consultation_on_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 재원(비-withdrawn) 학생일 때만 연결. 같은 테넌트 + 미연결 상담 + 자연키 일치.
  if NEW.status is distinct from 'withdrawn' then
    update public.enrollment_consultations c
    set student_id = NEW.id,
        outcome = 'enrolled'
    where c.tenant_id = NEW.tenant_id
      and c.student_id is null
      and lower(regexp_replace(coalesce(c.prospect_name, ''), '\s+', '', 'g')) = NEW.name_normalized
      and coalesce(c.prospect_school, '') = coalesce(NEW.school, '')
      and coalesce(c.prospect_grade, '') = coalesce(NEW.grade, '');
  end if;
  return NEW;
end;
$$;

-- 2) 트리거 부착 — 자연키를 이루는 컬럼(status/name/school/grade) 변화 + 신규 삽입 시 발화.
--    (name_normalized는 name 파생 generated 컬럼이라 name 변경만 감지하면 됨.)
drop trigger if exists trg_link_consultation_on_student on public.students;
create trigger trg_link_consultation_on_student
  after insert or update of status, name, school, grade on public.students
  for each row
  execute function public.link_consultation_on_student();

-- 3) 일회성 백필 — 현재 orphan(미연결 활성 상담 ↔ 이미 존재하는 재원 학생) 즉시 연결.
--    자연키가 활성 학생 중 유일(ux_students_active_natural_key)하므로 상담당 최대 1명 매칭 → 모호성 없음.
--    student_id is null 조건이라 멱등(재실행 무해).
update public.enrollment_consultations c
set student_id = s.id,
    outcome = 'enrolled'
from public.students s
where c.student_id is null
  and s.tenant_id = c.tenant_id
  and s.status <> 'withdrawn'
  and lower(regexp_replace(coalesce(c.prospect_name, ''), '\s+', '', 'g')) = s.name_normalized
  and coalesce(c.prospect_school, '') = coalesce(s.school, '')
  and coalesce(c.prospect_grade, '') = coalesce(s.grade, '');
