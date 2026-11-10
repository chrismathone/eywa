-- s2_0042_invoices_tenant_student_fk.sql — 청구서의 학생을 같은 지점 학생으로 묶는다(복합 FK) · 2026-11-09 · 수정 계획 P1-M(3b)
--
-- 수동 청구서 생성(`createInvoice`)이 폼의 학생 id를 지점 확인 없이 넣었고, DB도 막지 못했다:
--   · FK는 `student_id → students(id)` 하나뿐 — 학생이 **어느 지점이든** 존재하기만 하면 통과
--   · invoices INSERT 정책은 청구서의 `tenant_id`와 수납 권한만 본다
-- → 수납 쓰기 권한자가 다른 지점 학생 UUID로 요청하면 내 지점에 남의 학생을 가리키는 청구서가 생길 수 있었다(코드 리뷰 B14).
-- 앱도 같이 막지만(`billing/server/actions.ts`), 서버 액션 밖(PostgREST 직결·다른 쓰기 경로)까지 한 곳에서 닫으려고 DB에 건다.
--
-- 방식 = ECS 표와 같은 복합 FK(`(tenant_id, student_id) → students(tenant_id, id)` — 대상 유니크 `students_tenant_id_id_uq`는 이미 있다).
-- 기존 행 검사(2026-11-09): 청구서 4,977건 중 학생 지점 불일치 0건 · 학생 없음 0건.
-- 잠금: 한 트랜잭션이라 제약 추가 때 잡은 SHARE ROW EXCLUSIVE(invoices·students)가 검증 끝까지 간다 — 4,977건이라 밀리초 수준.
--   잠금을 5초 안에 못 잡으면 실패(부분 적용 없음 · 다시 실행).
-- 옛 앱·새 앱 둘 다 그대로 돈다(정상 쓰기는 늘 같은 지점 학생 — #95).
-- 되돌리기 = `alter table invoices drop constraint invoices_tenant_student_fk;`

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoices'::regclass and conname = 'invoices_tenant_student_fk'
  ) then
    alter table public.invoices
      add constraint invoices_tenant_student_fk
      foreign key (tenant_id, student_id) references public.students (tenant_id, id)
      on delete restrict
      not valid;
  end if;
end $$;

alter table public.invoices validate constraint invoices_tenant_student_fk;

commit;
