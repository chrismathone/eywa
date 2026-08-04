-- 0174a — 교재요청서 ↔ 학부모 공지 연결 + 삭제/수정 소유 판정에 created_by 합집합 (2026-08-03).
--
-- 원장 제보 3건이 한 자리로 모인다:
--  ① *"하단 요청서 삭제가 안되는 것 같다"* — 수납 교재 표의 휴지통이 눌러도 아무 일도 안 일어난다.
--  ② *"선생님이 본인 이름을 요청서에 다르게 적었을 때 발송한 건이 삭제가 안 된다"*
--  ③ *"클래스노트로 발송 안 한 요청서엔 애초에 삭제 버튼이 없다 … 이것도 이름 때문인가?"* → **그렇다.**
--
-- 🔴 뿌리는 하나: **자유 텍스트인 `teacher_name`을 소유 판정에 쓰고 있었다.**
--    · 요청서 화면은 `ownsTextbookRequest`가 false면 **버튼을 아예 렌더하지 않는다**(그래서 "버튼이 없다").
--    · 수납 표는 버튼이 있지만 아래 RLS DELETE 정책에 걸려 **0행 삭제**가 되는데, PostgREST `.delete()`는
--      RLS로 막힌 행을 **에러 없이** 건너뛴다 → 화면은 성공으로 읽고 아무 말도 안 한다("무반응").
--    실측(2026-08-03): 460건 중 이름 불일치 16건, 그중 최근 3건이 `셀린T`(2건은 created_by 있음·사무실 미처리).
--
-- ⚠️ **`teacher_name`을 `created_by`로 바꾸지 않는다 — 합집합으로 넓힌다.**
--    2026-07-31에 "created_by를 1순위로 올리면 **대리 작성**이 깨진다"고 일부러 정해둔 자리다
--    (사무실이 강사 앞으로 낸 요청은 created_by=사무실이지만 소유자는 그 강사다).
--    `내가 만든 것 OR 내 이름으로 된 것` = 원래 의미를 그대로 두고 **본인이 잠기는 구멍만** 막는다.
--    created_by가 없는 옛 행(447건)은 종전대로 이름 기준 — 안 맞으면 관리자 몫이다(화면이 그렇게 안내한다).
--
-- 그리고 `classnote_notice_id` 한 컬럼이 **두 가지 일**을 한다:
--  · 삭제할 때 "이 요청서가 어느 학부모 글로 나갔는지" 되짚는 연결(개별 글 삭제는 워커 배포 후 별건).
--  · **중복 발송 차단 표식** — 원장 지시 *"일반 수업보고서와 마찬가지로 같은 종류의 교재요청서는 중복
--    발송되지 않도록 차단"*. 수업보고서가 `classnote_status='success'`로 재발송을 막는 것과 같은 모양이다.
--    ⚠️ 앱이 이 값으로 거르므로, 값이 채워지는 시점은 **발송 성공 직후**여야 한다(먼저 채우면 실패분이 영영 막힌다).
--
-- 롤백: alter table textbook_orders drop column classnote_notice_id;
--       + 아래 두 정책을 0168a 원문으로 재실행.

alter table public.textbook_orders
  add column if not exists classnote_notice_id uuid references public.classnote_notices(id) on delete set null;

comment on column public.textbook_orders.classnote_notice_id is
  '이 요청서가 실려 나간 학부모 공지(classnote_notices). 발송 성공 직후 기록. '
  '① 삭제 시 학부모 글 되짚기 ② 중복 발송 차단 표식(수업보고서 classnote_status=success와 같은 역할). '
  '게시취소(회수)하면 앱이 이 값을 비워 다시 보낼 수 있게 한다.';

-- 발송 여부 조회(중복 차단 게이트)가 매 발송마다 돈다 — 테넌트+학생 기준 부분 인덱스.
create index if not exists textbook_orders_sent_idx
  on public.textbook_orders (tenant_id, student_id)
  where classnote_notice_id is not null;

-- ── 소유 판정 합집합: (내가 만든 것) OR (내 표시명으로 된 것) ──────────────────
-- 강사가 아닌 역할(사무실)은 종전대로 전부 통과 — 이 조건은 teacher에게만 걸린다.
drop policy if exists textbook_orders_role_gate_delete on public.textbook_orders;
create policy textbook_orders_role_gate_delete on public.textbook_orders
  as restrictive
  for delete
  using (
    (select public.auth_textbook_can_use())
    and (
      (select public.auth_system_role()) <> 'teacher'
      or teacher_name = (select public.auth_display_name())
      or created_by = (select auth.uid())
    )
  );

drop policy if exists textbook_orders_role_gate_update on public.textbook_orders;
create policy textbook_orders_role_gate_update on public.textbook_orders
  as restrictive
  for update
  using (
    (select public.auth_textbook_can_use())
    and (
      (select public.auth_system_role()) <> 'teacher'
      or teacher_name = (select public.auth_display_name())
      or created_by = (select auth.uid())
    )
  )
  with check (
    (select public.auth_textbook_can_use())
    and (
      (select public.auth_system_role()) <> 'teacher'
      or teacher_name = (select public.auth_display_name())
      or created_by = (select auth.uid())
    )
  );
