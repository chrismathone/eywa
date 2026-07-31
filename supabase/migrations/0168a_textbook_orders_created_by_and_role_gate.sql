-- 0168a — textbook_orders에 `created_by`(작성자) 추가 + 역할 게이트. 0158a가 남긴 마지막 "의도적 제외" 해소.
--
-- 배경: 0158a는 이 테이블을 **일부러 안 잠갔다** — "created_by 컬럼이 없어 강사 본인 요청을 DB에서
-- 안전하게 식별할 수 없다. 잠그면 강사 교재요청이 통째로 막힌다(fail-closed 락아웃)"가 이유였다.
-- 그 사이 정책은 `textbook_orders_tenant_isolation`(역할 무시) 하나뿐이라,
-- **viewer 8계정이 `GET /rest/v1/textbook_orders`로 교재 요청 447건(단가 포함)을 그대로 읽을 수 있었다.**
--
-- ── 게이트 설계: "본인 행만"이 아니라 **메뉴 권한**이다 (중요) ─────────────────
-- 처음엔 expenses처럼 `created_by = auth.uid()`로 좁히려 했으나 **그러면 정상 동작이 깨진다**:
-- 강사는 `loadScopedOrders`로 **담당 학생의 요청을 (남이 낸 것도) 읽는다** — 수학·영어를 함께 듣는
-- 학생이면 다른 과목 강사의 요청도 목록에 뜬다(2026-07-29 결정: 보이되 **수정은 못 한다**).
-- 행 단위로 좁히면 그 읽기가 사라진다. 그래서 DB는 **거친 백스톱**만 맡는다:
--   · 읽기/쓰기 = `auth_menu_access('textbook_requests') <> 'none'`
--     (master·admin·manager·teacher·accountant = full / counselor = injaewon override full / **viewer·student = none**)
--   · 세밀한 "내 것만 수정" 판정은 앱의 `ownsTextbookRequest`가 계속 단일 소스다.
--
-- ── created_by의 의미 = **실제 작성자**(감사·위조 방지). `teacher_name`(소유자)과 다른 사실이다 ──
-- ⚠️ 이 둘을 같은 것으로 취급하지 말 것. 교재 요청은 **대리 작성이 의도된 동작**이라
--    (`requestTextbook`가 폼의 '담임 선생님'을 비우면 요청자로 채운다) 사무실이 강사 앞으로 낸 요청은
--    `created_by`=사무실 / `teacher_name`=그 강사이고, **소유자는 teacher_name 쪽**이다
--    (textbook-ownership.ts 참조 — "담임 선생님 앞으로 낸 요청"이 의도한 의미).
-- ⚠️ **과거 447행은 백필하지 않는다.** `teacher_name`으로 채우면 "소유자"를 "작성자" 칸에 적는 셈이라
--    사실이 아닌 값이 남는다(대리 작성분을 구분할 방법이 없다). 옛 행은 `created_by = null`
--    = "작성자 미상(컬럼 도입 전)"이 정직하다. 게이트가 메뉴 기준이라 null이어도 아무도 안 잠긴다.
--    참고로 이름→계정 매칭은 15명 중 11명이 1:1이고 **동명이인은 0명**이었다(미매칭 4명 = 9행:
--    `김`·`셀린T`·`신입`·`윤하t`). 즉 기술적으로는 백필이 가능했지만 **의미가 달라서** 안 한 것이다.
--
-- 멱등: add column if not exists · drop policy if exists → create policy.
-- 롤백: 아래 4개 정책 drop(컬럼은 남겨도 무해 — 아무도 안 읽으면 그냥 null).

alter table public.textbook_orders
  add column if not exists created_by uuid references public.users(id) on delete set null;

comment on column public.textbook_orders.created_by is
  '이 요청을 실제로 저장한 계정(감사·위조 방지). 소유자는 teacher_name이 단일 소스다 — 대리 작성이 의도된 동작이라 둘은 다른 사실이다. 0168a 이전 행은 null(작성자 미상).';

create index if not exists textbook_orders_created_by_idx
  on public.textbook_orders (tenant_id, created_by);

-- ⚠️ 게이트 함수는 `(select f())`로 감쌀 것(gotchas #91 — 맨몸이면 행마다 호출).
create or replace function public.auth_textbook_can_use() returns boolean
  language sql stable security definer set search_path = public as $$
  select public.auth_menu_access('textbook_requests') <> 'none'
$$;

-- 로그인 사용자의 표시명 — `textbook_orders.teacher_name`이 표시명 스냅샷이라 소유 판정에 필요하다.
create or replace function public.auth_display_name() returns text
  language sql stable security definer set search_path = public as $$
  select display_name from public.users where id = auth.uid()
$$;

drop policy if exists textbook_orders_role_gate_select on public.textbook_orders;
create policy textbook_orders_role_gate_select on public.textbook_orders
  as restrictive for select to authenticated
  using ((select public.auth_textbook_can_use()));

-- ⚠️ `created_by is null` 허용은 **의도**다: 이 컬럼을 안 채우는 경로(스크립트·미래 코드)를
--    fail-closed로 막지 않는다. 대신 **남의 id를 적는 위조는 막는다**(= null이거나 나 자신만).
drop policy if exists textbook_orders_role_gate_insert on public.textbook_orders;
create policy textbook_orders_role_gate_insert on public.textbook_orders
  as restrictive for insert to authenticated
  with check (
    (select public.auth_textbook_can_use())
    and (created_by is null or created_by = (select auth.uid()))
  );

-- ── 수정/삭제 = **앱의 `ownsTextbookRequest`와 같은 규칙을 DB에도** ────────────
-- 2026-07-29에 "강사는 본인이 만든 요청만 수정·삭제"로 정했지만 그건 **화면에서만** 막은 것이라,
-- 강사가 REST로 직접 붙으면 남의 요청을 고칠 수 있었다(gotchas #77). 같은 판정을 여기서도 한다:
--   · 강사(`system_role = 'teacher'`)는 `teacher_name`이 **자기 표시명과 정확히 일치**할 때만.
--     (느슨한 매칭 금지 — 느슨하게 하면 남의 요청을 내 것으로 오판해 원래 버그가 되돌아온다.)
--   · 사무실·상담 등 그 외 역할은 앱에서도 소유 게이트를 안 타므로(`effectiveTeacherId()`가 null)
--     여기서도 안 탄다. `textbook_requests` 메뉴 권한까지만 본다.
-- ⚠️ 표시명이 별칭이거나(`셀린T`) 개명했으면 그 행은 **앱에서도 이미 읽기 전용**이다 — DB가 앱보다
--    더 조이는 게 아니라 같은 규칙을 복제하는 것이다(정답은 데이터 정규화, textbook-ownership.ts 참조).
-- ⚠️ WITH CHECK엔 created_by 조건을 **걸지 않는다.** NEW 행만 보고 OLD와 비교할 수 없어서
--    `created_by = auth.uid()`를 걸면 **사무실이 대리 작성한 요청을 그 강사가 수정할 때 막힌다**(락아웃).
drop policy if exists textbook_orders_role_gate_update on public.textbook_orders;
create policy textbook_orders_role_gate_update on public.textbook_orders
  as restrictive for update to authenticated
  using (
    (select public.auth_textbook_can_use())
    and (
      (select public.auth_system_role()) <> 'teacher'
      or teacher_name = (select public.auth_display_name())
    )
  )
  with check (
    (select public.auth_textbook_can_use())
    and (
      (select public.auth_system_role()) <> 'teacher'
      or teacher_name = (select public.auth_display_name())
    )
  );

drop policy if exists textbook_orders_role_gate_delete on public.textbook_orders;
create policy textbook_orders_role_gate_delete on public.textbook_orders
  as restrictive for delete to authenticated
  using (
    (select public.auth_textbook_can_use())
    and (
      (select public.auth_system_role()) <> 'teacher'
      or teacher_name = (select public.auth_display_name())
    )
  );
