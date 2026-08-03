-- 0172a — 수업보고서 "작성 계정"(created_by). 보강 행 복원의 스코프 키를 **이름 문자열 → 계정 id**로.
--
-- 배경(원장 지시 2026-08-03): 0171a로 보강 행을 되살릴 때 "내가 쓴 것"을 `teacher_name`(표시 이름 **문자열**)로
-- 찾고 있었다. 그 키의 문제:
--  ① 강사 이름을 바꾸면 그 전에 쓴 보강이 **본인 화면에서도 사라진다**(문자열이 안 맞으므로).
--  ② 옛 표기가 그대로 남은 행('수진'·'희영1'·'성우' 10건)은 누구에게도 안 뜬다.
--  ③ 동명이인이 생기면 남의 보강이 내 화면에 섞인다(현재 중복 표시명 0건이나 스키마가 막지 않는다).
-- `teacher_name`은 **학부모에게 보이는 담임 표기**라 그대로 두고, 소유(누구 화면에 뜨는가)는 계정 id로 분리한다.

alter table public.lesson_reports
  add column if not exists created_by uuid references public.users(id) on delete set null;

comment on column public.lesson_reports.created_by is
  '이 보고서를 처음 저장한 계정(소유 = 누구의 원스크린에 뜨는가). 표시용 담임 이름은 teacher_name(학부모에게 나가는 값)으로 별개. '
  '⚠️ 갱신 시 보존된다(아래 트리거) — 다른 사람이 고쳐도 원 작성자 화면에서 사라지지 않게.';

-- 🔴 갱신에서 **원 작성자를 보존**한다. 앱은 upsert 한 문장으로 저장하므로(insert/update 분기 없음),
--    payload의 created_by가 그대로 들어가면 관리자가 한 번 고치는 순간 그 보강 행이 강사 화면에서 증발한다
--    (0171a가 고친 바로 그 증상의 재발). 코드가 아니라 DB에서 못박는다.
create or replace function public.lesson_reports_keep_created_by()
returns trigger language plpgsql as $$
begin
  new.created_by := coalesce(old.created_by, new.created_by);
  return new;
end;
$$;

drop trigger if exists lesson_reports_keep_created_by_trg on public.lesson_reports;
create trigger lesson_reports_keep_created_by_trg
  before update on public.lesson_reports
  for each row execute function public.lesson_reports_keep_created_by();

-- 기존 보강 행 백필 — 같은 테넌트 안에서 표시 이름이 **유일하게** 맞는 계정만(동명이인은 건너뛴다).
-- ⚠️ 보강 행으로 범위를 좁힌다(이 기능이 쓰는 곳). 전체 17,000행 갱신은 이 변경이 요구하지 않는다.
update public.lesson_reports lr
set created_by = u.id
from public.users u
where lr.makeup
  and lr.created_by is null
  and lr.teacher_name is not null
  and u.tenant_id = lr.tenant_id
  and u.display_name = lr.teacher_name
  and (
    select count(*) from public.users u2
    where u2.tenant_id = lr.tenant_id and u2.display_name = lr.teacher_name
  ) = 1;
