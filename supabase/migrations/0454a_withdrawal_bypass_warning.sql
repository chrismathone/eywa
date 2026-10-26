-- 0454a — 퇴원보고서를 거치지 않은 퇴원 = **경고**(막지 않는다).
--
-- 원장 2026-10-23(W4 확인 질문 ① "지정자가 개발자 도구로 DB에 직접 쓰는 길까지 트리거로 막을까요?"의 답)
--   *"개발자 도구는 어쩔 수 없지. 대신 경고할 수 있게"*
-- 직원 화면의 퇴원은 전부 퇴원보고서의 처리 함수(`transition_withdrawal_report` — 0453a)를 지난다. 앱 게이트는 서버 액션에만 있어
-- (`src/features/withdrawals/via-report.ts`) 원생 상태 변경 담당자가 로그인 세션으로 DB에 직접 `students.status = 'withdrawn'`이나
-- 새 퇴원 예약(`withdrawn_at`)을 쓰면 DB 가드(`zz_student_status_authority`)는 담당자라 통과시킨다. 그 쓰기는 그대로 두고,
-- 그 지점 원장(원장 역할 · 재직 · 운영자 계정 제외 — 퇴원보고서의 원장 후보와 같은 축)에게 벨 알림 + 감사로그를 남긴다.
--
-- ① **지연 제약 트리거**(커밋 직전에 판정) — 처리 함수는 학생을 퇴원으로 바꾼 **뒤에** 보고서 묶음을 'completed'로 바꾼다.
--    문장 끝에 보면 정상 처리를 우회로 오판한다. 판정은 커밋 직전 그 학생의 **지금 값**으로 한다(같은 트랜잭션에서 되돌렸으면 조용히).
-- ② 경고하는 것: 학생 퇴원(재원·휴원·예비 → 퇴원) · 새 퇴원 예약(상태는 퇴원이 아닌데 퇴원일이 새로 생김 — 새 원생 INSERT 포함) ·
--    예약 날짜 변경. 앱은 이제 새 예약·날짜 변경을 걸지 못한다(`formWithdrawalViaReport`) — 생기면 그것이 우회다. 예약은 그날 cron이
--    처리하고 그 처리는 경고하지 않으므로(아래 ③) **예약을 거는 순간**에 경고한다.
-- ③ 경고에서 빼는 길(앱 가드 `via-report-wiring.test.ts`의 '그대로 두는 길'과 같은 목록 — 각각 무엇으로 가르나):
--    · 퇴원보고서 처리 = 학생의 `withdrawal_metadata.reportId`가 같은 지점·같은 학생의 보고서이고, 그 묶음(옛 단건 보고서면 그 보고서)이
--      **이 트랜잭션에서**(applied_at = now()) 'completed' · 처리 구분 'withdrawal' · 처리일 = 퇴원일. 글자만 흉내 낸 metadata는 여기서 걸린다.
--    · 이미 걸려 있던 퇴원 예약의 당일 처리(cron `apply-due-withdrawals`) = 상태만 퇴원으로 · 예약일 그대로 · 예약일이 오늘 이전.
--      (예약은 걸 때 ②로 경고된다 · 운영 DB의 옛 예약 3건은 W4 전에 걸린 것이다.)
--    · 학생 병합(진 쪽 정리) = 메모 첫 줄 표식(`중복 병합: <남는 학생 id>와 통합됨 (날짜)` — 앱 `mergeNoteFor`)이 이번에 새로 붙었고,
--      남는 학생이 같은 지점에 있고, 표식 날짜 = 퇴원일이고, 진 쪽에 수강이 하나도 없다(병합은 수강부터 옮긴다).
--    · 데모 데이터 · 옛 기록 등록(새 원생을 지난 퇴원 상태로 INSERT · 엑셀) = 퇴원 상태 INSERT는 보지 않는다.
--    · 이미 퇴원한 학생의 퇴원일 정정 · 예약 취소 · 재원 복구 = 트리거 조건(WHEN)에 안 걸린다.
--    · 퇴원 → 재원·휴원으로 바꾸며 퇴원일을 그대로 두는 쓰기(= 예약 모양)도 보지 않는다 — 예약 cron이 수강 닫기에 실패하면 학생을
--      원래 예약 상태로 이렇게 되돌린다(`apply-due-withdrawals`). 이 길로 할 수 있는 것은 이미 퇴원했던 학생을 다시 퇴원시키는 것뿐이다.
-- ④ **절대 막지 않는다**: security definer + 본문 전체 `exception when others or query_canceled then return null` — 경고 장치가 실패해도
--    원래 쓰기는 커밋된다. 판정 중 오류는 '확인 못 함'으로 보고 경고 쪽으로 간다(흉내 낸 값으로 오류를 내 경고를 끄지 못하게).
--    알림과 감사로그는 따로 감싼다(한쪽이 실패해도 다른 쪽은 남는다). 같은 트랜잭션에서 한 학생에 경고 하나.
-- ⑤ 성능: 트리거 조건(WHEN)이 퇴원·예약 변화일 때만 함수를 부른다(학생 행 갱신은 잦다). 판정 조회는 기본키(보고서·묶음·학생)와
--    수강의 학생 칸으로만.
-- 🔴 앱보다 먼저든 나중이든 된다(#95) — 앱은 이 함수를 부르지 않는다(알림 종류·감사 액션의 한글 라벨만 더했다).
-- 되돌리기 = `scripts/_oneoff/revert-0454a-withdrawal-bypass-warning.sql`(트리거를 먼저 지운다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create schema if not exists withdrawal_guard_private;
revoke all on schema withdrawal_guard_private from public, anon, authenticated, service_role;

create or replace function withdrawal_guard_private.warn_unreported_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public
set lock_timeout = '2s'
as $function$
declare
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  today date := (now() at time zone 'Asia/Seoul')::date;
  warned text;
  cur record;
  old_status text;
  old_date date;
  old_notes text;
  is_withdraw_event boolean;
  kind text;
  verified boolean := false;
  judge_error text;
  rid uuid;
  mark text[];
  keeper uuid;
  claims jsonb;
  actor uuid;
  actor_label text;
  title text;
  body text;
  date_label text;
begin
  begin
    -- 같은 트랜잭션에서 한 학생에 경고 하나(같은 학생을 두 번 바꿔도 한 줄).
    warned := coalesce(current_setting('withdrawal_guard.warned', true), '');
    if position(new.id::text in warned) > 0 then return null; end if;

    -- 커밋 직전 그 학생의 지금 값 — 같은 트랜잭션에서 되돌렸거나 처리 함수가 뒤에 덧붙인 것까지 본다.
    select s.id, s.tenant_id, s.name, s.status::text as status, s.withdrawn_at, s.withdrawal_metadata, s.notes
      into cur from public.students s where s.id = new.id;
    if cur.id is null then return null; end if;

    if tg_op = 'UPDATE' then
      old_status := old.status::text; old_date := old.withdrawn_at; old_notes := old.notes;
    end if;
    is_withdraw_event := new.status::text = 'withdrawn' and old_status is distinct from 'withdrawn';

    if cur.status = 'withdrawn' then
      kind := 'withdraw';
      begin
        -- (가) 퇴원보고서 처리 — 이 트랜잭션에서 완료된 그 학생의 보고서 묶음(옛 단건 보고서는 그 보고서).
        if jsonb_typeof(cur.withdrawal_metadata) = 'object' and jsonb_typeof(cur.withdrawal_metadata->'reportId') = 'string'
          and (cur.withdrawal_metadata->>'reportId') ~ uuid_re then
          rid := (cur.withdrawal_metadata->>'reportId')::uuid;
          select exists(
            select 1 from public.withdrawal_reports r
            left join public.withdrawal_report_groups g on g.id = r.group_id
            where r.id = rid and r.tenant_id = cur.tenant_id and r.student_id = cur.id
              and case when r.group_id is null
                then r.status = 'completed' and r.exit_kind = 'withdrawal' and r.applied_at = now() and r.effective_date = cur.withdrawn_at
                else g.tenant_id = cur.tenant_id and g.student_id = cur.id and g.status = 'completed' and g.exit_kind = 'withdrawal'
                  and g.applied_at = now() and g.effective_date = cur.withdrawn_at
              end) into verified;
        end if;
        -- (나) 이미 걸려 있던 퇴원 예약의 당일 처리(cron) — 상태만 퇴원으로 · 예약일 그대로 · 그날이 됐다.
        if not verified and is_withdraw_event and old_date is not null and new.withdrawn_at = old_date
          and cur.withdrawn_at = old_date and old_date <= today then
          verified := true;
        end if;
        -- (다) 학생 병합(진 쪽 정리) — 이번에 새로 붙은 표식 · 남는 학생이 같은 지점 · 표식 날짜 = 퇴원일 · 진 쪽 수강 0건.
        if not verified and is_withdraw_event then
          mark := regexp_match(split_part(ltrim(coalesce(cur.notes, '')), E'\n', 1), '^중복 병합:\s*(\S+)와 통합됨 \((\d{4}-\d{2}-\d{2})\)');
          if mark is not null and mark[1] ~ uuid_re
            and split_part(ltrim(coalesce(old_notes, '')), E'\n', 1) is distinct from split_part(ltrim(coalesce(cur.notes, '')), E'\n', 1) then
            keeper := mark[1]::uuid;
            verified := keeper <> cur.id
              and mark[2]::date = cur.withdrawn_at
              and exists(select 1 from public.students k where k.id = keeper and k.tenant_id = cur.tenant_id)
              and not exists(select 1 from public.enrollments e where e.student_id = cur.id);
          end if;
        end if;
      exception when others then
        verified := false; judge_error := sqlstate;
      end;
      if verified then return null; end if;
    else
      -- 같은 트랜잭션에서 되돌렸다(퇴원 → 다시 재원 · 예약 → 취소 · 예약일을 원래대로).
      if is_withdraw_event or cur.withdrawn_at is null then return null; end if;
      if old_status is not null and old_status <> 'withdrawn' and cur.withdrawn_at is not distinct from old_date then return null; end if;
      kind := case when old_date is null or old_status is null or old_status = 'withdrawn' then 'schedule' else 'reschedule' end;
    end if;

    perform set_config('withdrawal_guard.warned', warned || new.id::text || ',', true);

    -- 처리한 사람 — 로그인 세션이면 그 계정(같은 지점 계정만 행위자로 적는다), 아니면 이름 없이.
    begin
      claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    exception when others then claims := null;
    end;
    begin
      select u.id, u.display_name into actor, actor_label
        from public.users u where u.id = auth.uid() and u.tenant_id = cur.tenant_id;
    exception when others then actor := null; actor_label := null;
    end;

    date_label := to_char(cur.withdrawn_at, 'FMMM"월" FMDD"일"');
    title := case kind
      when 'withdraw' then '퇴원보고서 없이 퇴원 처리됨'
      when 'schedule' then '퇴원보고서 없이 퇴원 예약됨'
      else '퇴원보고서 없이 퇴원 예약일 변경됨' end;
    body := cur.name || case kind
      when 'withdraw' then ' · 퇴원일 ' || coalesce(date_label, '미정')
      when 'schedule' then ' · 퇴원 예약 ' || coalesce(date_label, '미정')
      else ' · 퇴원 예약 ' || coalesce(to_char(old_date, 'FMMM"월" FMDD"일"'), '미정') || ' → ' || coalesce(date_label, '미정') end
      || coalesce(' · 처리한 사람 ' || nullif(btrim(actor_label), ''), '')
      || ' — 퇴원보고서를 거치지 않았습니다. 확인해 주세요.';

    begin
      insert into public.notifications(tenant_id, recipient_id, type, title, body, link, actor_id)
      select cur.tenant_id, u.id, 'withdrawal_bypass', title, body, '/withdrawals/' || cur.id::text, actor
        from public.users u
       where u.tenant_id = cur.tenant_id and u.status = 'active' and u.system_role::text = 'master'
         and not coalesce(public.is_super_admin(u.id), false)
         and u.id is distinct from actor;
    exception when others then null;
    end;

    begin
      insert into public.audit_logs(tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
      values (
        cur.tenant_id,
        actor,
        coalesce(nullif(btrim(actor_label), ''), '계정 확인 안 됨'),
        'student_withdrawn_without_report', -- audit-action
        'student', -- audit-target-type
        cur.name,
        jsonb_strip_nulls(jsonb_build_object(
          'studentId', cur.id,
          'kind', kind,
          'date', cur.withdrawn_at,
          'previousDate', old_date,
          'oldStatus', old_status,
          'newStatus', cur.status,
          'requestRole', claims->>'role',
          'unverifiedReportId', case when jsonb_typeof(cur.withdrawal_metadata) = 'object' then cur.withdrawal_metadata->>'reportId' end,
          'judgeError', judge_error)));
    exception when others then null;
    end;
  exception when others or query_canceled then
    return null;
  end;
  return null;
end
$function$;

comment on function withdrawal_guard_private.warn_unreported_withdrawal() is
  '퇴원보고서를 거치지 않은 퇴원·새 퇴원 예약 → 원장 벨 알림 + 감사로그(막지 않는다) · 0454a';

revoke all on function withdrawal_guard_private.warn_unreported_withdrawal() from public, anon, authenticated, service_role;

-- 제약 트리거는 OR REPLACE가 없다 — 지우고 다시 만든다.
drop trigger if exists zz_withdrawal_without_report_warning on public.students;
create constraint trigger zz_withdrawal_without_report_warning
  after update on public.students
  deferrable initially deferred
  for each row
  when ((new.status = 'withdrawn' and old.status <> 'withdrawn')
    or (new.status <> 'withdrawn' and new.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at))
  execute function withdrawal_guard_private.warn_unreported_withdrawal();

-- 새 원생을 퇴원 예약 모양(상태는 퇴원이 아닌데 퇴원일이 있음)으로 넣는 길 — 앱에는 없다(새 원생·엑셀 모두 예약을 거절한다).
-- 지난 퇴원 상태로 넣는 옛 기록 등록은 보지 않는다.
drop trigger if exists zz_withdrawal_without_report_warning_insert on public.students;
create constraint trigger zz_withdrawal_without_report_warning_insert
  after insert on public.students
  deferrable initially deferred
  for each row
  when (new.status <> 'withdrawn' and new.withdrawn_at is not null)
  execute function withdrawal_guard_private.warn_unreported_withdrawal();

notify pgrst, 'reload schema';

commit;
