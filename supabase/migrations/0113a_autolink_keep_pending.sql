-- 0113a: 자동연결은 student_id만 연결하고 outcome을 'enrolled'로 강제하지 않는다
--
-- 배경(치명적 버그): 기존 재원생(예: 수학)이 QR 공개접수로 새 상담(예: 영어)을 신청하면,
-- 0107a의 자동연결 트리거가 그 상담을 기존 학생에 연결하면서 outcome을 'enrolled'로 덮어썼다.
-- 등록상담 칸반은 연결 학생의 활성 수강이 있으면(assignedClassCount>=1) 카드를 "배정 완료"로 옮겨
-- 대기 큐에서 빼므로, 신선한 QR 접수가 "이미 등록됨"으로 매몰돼 상담사가 새 상담을 영영 못 봤다.
-- 실측(인재원): QR 접수 20건 중 기존 학생과 매칭된 9건이 전부 enrolled로 매몰(장건욱=영어재원+수학QR 등).
--
-- 결정: outcome은 사람이 소유하는 파이프라인 상태다. 자동연결은 오직 **student_id 연결만** 한다
--       (orphan 방지 = convert 폭발 차단 목적은 연결만으로 충분). 신선한 QR 접수는 'pending'으로 큐에 남고,
--       학생 상세 상담 탭에는 연결(student_id)로 다건 노출된다. "배정 완료" 판정은 앱에서 **상담 과목의 실제
--       수강**으로 파생(getEnrollmentConsultations의 subject-scoped assignedClassCount) — 교차과목 오매몰 차단.
-- 참고: 두 함수 모두 트리거가 이름으로 참조하므로 CREATE OR REPLACE만으로 즉시 반영(트리거 재부착 불요).

-- (a) students insert/update → 그 학생의 미연결 상담 연결. outcome은 건드리지 않는다.
create or replace function public.link_consultations_for_student(p_student uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select id, tenant_id, name_normalized, school, grade, parent_phone, status
    into s from public.students where id = p_student;
  if not found or s.status = 'withdrawn' then return; end if;

  update public.enrollment_consultations c
     set student_id = s.id, updated_at = now()   -- 0113a: outcome='enrolled' 강제 제거
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

-- (b) enrollment_consultations BEFORE insert/update → 기존 학생에 즉시 연결(유일 매칭일 때만).
--     outcome은 건드리지 않는다 → 신선한 QR 접수는 'pending' 유지(큐 노출).
create or replace function public.link_student_for_consultation()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cnt int; v_id uuid;
begin
  if NEW.student_id is not null then return NEW; end if;
  select count(*), (array_agg(s.id))[1] into v_cnt, v_id
    from public.students s
   where s.tenant_id = NEW.tenant_id and s.status <> 'withdrawn'
     and public.eywa_cs_match(NEW.prospect_name, NEW.prospect_school, NEW.prospect_grade, NEW.parent_phone,
                              s.name_normalized, s.school, s.grade, s.parent_phone);
  if v_cnt = 1 then
    NEW.student_id := v_id;   -- 0113a: NEW.outcome := 'enrolled' 제거 (파이프라인 상태 보존)
  end if;
  return NEW;
end $$;
