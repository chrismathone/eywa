-- 0392a — 수업보고서 발송 이력(추가만 하는 기록) (원장 2026-10-22 *"기록이 빠질 수 있는 곳은 보완해야겠네"*)
--
-- 왜: 지금은 보고서 행(lesson_reports)에 '마지막' 발송 상태·시각 한 벌만 남는다.
--   ① 다시 보내면 classnote_sent_at을 덮어쓴다 — 몇 번 나갔는지 모른다.
--   ② 첨부 변경·공유 링크 재발급·회수 뒤 재발송이 발송 표시를 null로 지운다(재발송을 여는 설계) —
--      '예전에 나갔다'는 사실이 행에서 사라지고, 활동 로그(log_activity)도 classnote_* 칸을 noise로 빼서 안 남긴다.
--   ③ 나간 내용의 사본이 없다 — 발송 뒤 내용을 고치면 그때 무엇이 나갔는지 모른다.
--   발송 요청 감사로그(classnote_send)는 2026-09-10부터만 있고 '큐에 넣음'일 뿐 게시 성공 기록이 아니다.
--
-- 무엇을: lesson_report_send_events = 발송 상태가 바뀔 때마다 한 줄(추가만).
--   event: requested(발송 요청 — 대기 중 다시 누른 것도) · claimed(연동 PC가 집음 = 캡처 직전 · 사본을 뜬다)
--          · retry(연동 PC 재시도) · sent(게시 성공 — 발송 시각이 새로 찍힐 때만) · failed(최종 실패)
--          · held(보류: too_old·name_conflict·blocked_shared) · recall_requested · recalled · recall_failed
--          · cleared(발송 표시 지움 — 지우기 직전의 발송 시각·공유 토큰·내용을 남긴다)
--          · sent_at_changed(상태는 그대로인데 발송 시각만 바뀜) · deleted(발송 흔적이 있는 보고서 삭제) · other
--   몇 번 나갔나 = sent 줄 + sent_at이 찍힌 failed 줄(연동 PC가 게시 뒤 교차 확인 이상으로 실패 처리한 것).
--     ⚠️ '일부 계정에만 게시'·'게시 응답 없음' 실패는 나갔을 수도 있다(sent_at 없음 — error 문구로 가른다).
--   snapshot = 학부모 카드가 그리는 칸(교재·진도·오늘 과제·일일/확인테스트·exam_info·지난 과제 수행률·수업 태도·
--              멘트·학습 추세·첨부 목록·공유 토큰·영상 숙제 칸·담임 표기) + 학생 이름·학교·학년 + 반 이름 + 카드 표시 설정.
--     sent·failed = 그 회차에 연동 PC가 집은 순간(claimed)의 사본 — 화면 캡처 수 초~수 분 전이다(한 번에 2건을 집어
--     둘째 건은 첫째 건 게시 뒤에 캡처한다 — 그 사이 고친 내용은 캡처엔 있고 사본엔 없을 수 있다). 게시하는 동안 고친
--     내용은 섞이지 않는다. 집은 줄이 없으면(이 파일 전에 집힌 회차) 그 순간의 행. snapshot_at = 사본을 뜬 시각.
--     cleared·deleted = 지우기 직전의 행 · recalled = 그 순간의 행.
--   ⚠️ 성적 추이 그래프·영어 동결본(JJ)·게시 글의 영상 줄·발송용 작성자 이름·카드 이미지·첨부 파일 자체는 사본에 없다
--      (첨부는 경로 목록뿐 — 첨부를 바꾸면 파일이 지워질 수 있다. 이미지 보관은 연동 앱 새 버전 몫).
--   ⚠️ 실제로 어느 ClassNote 보드로 갔는지는 연동 PC가 행에 적지 않는다 — 보낼 반(classnote_class_id)·반(class_id)·
--      보강 반(makeup_class_id)을 그 순간의 값으로 남긴다.
--   같은 자리를 도는 반복(연동 PC 비상 정지·시험 모드가 15초마다 집었다 놓는 것)은 처음 한 번만 남긴다 —
--   로그인 사용자가 하지 않은 것 중, 집은 지 2분 안에 같은 사유·횟수로 되돌린 retry · 10분 안에 같은 사본으로 다시 집은
--   claimed가 사이에 다른 일 없이 되풀이될 때만 건너뛴다(멈춤 복구·사람이 한 일은 늘 남긴다).
--
-- 🔑 기록은 DB 트리거가 쓴다 — 상태를 바꾸는 길이 여럿(원스크린·관리자 재발송·직접 작성·멈춤 복구·연동 PC)이라
--    앱 한 곳에서 쓰면 다른 길이 빠진다(#132와 같은 이유). 연동 앱을 고치지 않아도 된다.
--    누가: actor_id = 그 변화를 일으킨 로그인 사용자(auth.uid() — 연동 PC·관리 키 경로면 비어 있다).
--          db_role = 그 쓰기의 DB 역할(eywa_sync_agent = 연동 PC · authenticated = 로그인 화면 · service_role = 관리 키 ·
--          postgres 등 = SQL 직접) — actor_id가 빈 줄을 가른다.
--          sent·failed 줄의 requested_by = 그 보고서의 가장 최근 발송 요청자.
-- 🔴 기록이 원래 쓰기(발송 상태 저장)를 막지 않는다 — 막으면 연동 PC가 게시한 뒤 'success'를 못 써서 같은 글을
--    다시 올린다(ClassNote 글은 지울 수 없다). 대신 조용히 빠지지 않게 ① 사본을 못 뜨면 사본 없이 한 줄을 남기고
--    ② 그것도 못 하면 DB 로그에 WARNING을 남긴다. 빠진 발송은 0392b(다시 돌려도 같은 백필)가 메운다.
-- 🔴 지울 수 없다: 앱 역할(anon·authenticated)은 표·시퀀스 권한 0, service_role은 읽기만. 행 보호 트리거가 UPDATE·DELETE를
--    거절한다 — 예외는 지점(tenant)째 지울 때의 외래키 연쇄뿐.
-- 🔴 보고서가 지워져도 남는다: report_id·student_id·반 id에 외래키를 걸지 않는다(그때의 값을 그대로 둔다).
--    actor_id·requested_by도 외래키 없음 — 걸면 사용자 삭제의 set null이 행 보호에 막혀 사용자 삭제가 실패한다.
--    ⚠️ 학생 삭제의 연쇄로 지워진 보고서의 deleted 사본엔 학생 이름이 없다(학생 행이 먼저 사라진다 — 앞선 줄에는 있다).
--
-- 읽기: 서버 전용(정책 0개 · 0374a·0376a·0377a와 같은 방식) — 화면을 붙일 땐 앱이 사람을 확인한 뒤 관리 키로
--   tenant_id를 걸고 읽는다(사용자 클라이언트로 읽으면 에러 없이 0행 — #104).
--   정책으로 열지 않은 까닭: SQL 쪽 auth_menu_access 기본값에 수업보고서 메뉴가 없어 메뉴 게이트를 걸면
--   원장 외 전원이 막힌다(#92) — 화면이 생길 때 앱 게이트로 연다.
--
-- 잠금: lesson_reports에는 트리거를 `create or replace`로만 단다(SHARE ROW EXCLUSIVE — 읽기는 막지 않는다 · drop trigger는
--   ACCESS EXCLUSIVE라 쓰지 않는다). 잠금 대기는 5초에서 끊는다(lock_timeout — 실패하면 다시 돌리면 된다).
-- 배포 순서: 앱과 무관(앱은 이 표를 읽지도 쓰지도 않는다 · 트리거만). 다시 돌려도 같다(멱등).
-- 다음: 0392b(백필 — 이 표가 생기기 전의 발송·발송 요청 감사로그). 되돌리기는 별도 파일
--   scripts/_oneoff/revert-0392a-lesson-report-send-events.sql(이 파일에 붙이지 않는다).
begin;
set local lock_timeout = '5s';

create schema if not exists lesson_report_send_private;
revoke all on schema lesson_report_send_private from public, anon, authenticated;
grant usage on schema lesson_report_send_private to service_role;

create table if not exists public.lesson_report_send_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  report_id uuid not null,
  student_id uuid,
  report_date date,
  subject text,
  class_id uuid,
  makeup_class_id uuid,
  classnote_class_id uuid,
  event text not null check (event in (
    'requested', 'claimed', 'retry', 'sent', 'failed', 'held', 'recall_requested', 'recalled', 'recall_failed',
    'cleared', 'sent_at_changed', 'deleted', 'other')),
  origin text not null default 'trigger'
    check (origin in ('trigger', 'backfill_report', 'backfill_audit')),
  from_status text,
  to_status text,
  at timestamptz not null default now(),
  sent_at timestamptz,
  queued_at timestamptz,
  processing_at timestamptz,
  retry_count integer,
  error text,
  share_token uuid,
  actor_id uuid,
  actor_name text,
  db_role text,
  requested_by uuid,
  snapshot jsonb,
  snapshot_at timestamptz,
  source_id uuid,
  note text
);
create index if not exists lesson_report_send_events_report_idx
  on public.lesson_report_send_events (report_id, at, id);
create index if not exists lesson_report_send_events_tenant_at_idx
  on public.lesson_report_send_events (tenant_id, at desc);
create index if not exists lesson_report_send_events_student_idx
  on public.lesson_report_send_events (tenant_id, student_id, report_date);
-- 감사로그 백필의 멱등 키(감사로그 한 줄 × 보고서). ON CONFLICT로 쓰지 않는다(#113 — 백필은 not exists로 거른다).
create unique index if not exists lesson_report_send_events_audit_key
  on public.lesson_report_send_events (source_id, report_id) where origin = 'backfill_audit';

alter table public.lesson_report_send_events enable row level security;
-- 기본 권한이 anon·authenticated·service_role에 전부(쓰기 포함)를 주므로 셋 다 거두고 서버 키에 읽기만 준다.
revoke all on public.lesson_report_send_events from public, anon, authenticated, service_role;
grant select on public.lesson_report_send_events to service_role;
-- identity 시퀀스도 기본 권한으로 열려 있다 — setval로 번호를 꼬아 기록을 막지 못하게 거둔다.
do $do$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.lesson_report_send_events', 'id'));
end
$do$;

comment on table public.lesson_report_send_events is
  '수업보고서 발송 이력(추가만) — 발송 상태가 바뀔 때마다 트리거가 한 줄. 서버 전용(정책 0개 · 앱 역할 권한 0 · '
  'service_role 읽기만). 보고서가 지워져도 남는다(외래키 없음). 0392a';
comment on column public.lesson_report_send_events.sent_at is
  'sent = 새로 찍힌 발송 시각 · failed = 실패 처리하며 새로 찍힌 발송 시각(=게시됨)만 · recalled = 회수한 글의 발송 시각 · '
  'cleared·deleted = 지우기 직전의 발송 시각(행에서는 사라진 값).';
comment on column public.lesson_report_send_events.snapshot is
  '학부모 카드 칸 사본. sent·failed는 그 회차에 연동 PC가 집은 순간의 사본(snapshot_at). '
  'origin=backfill_report는 백필한 날의 내용이라 발송 당시와 다를 수 있다.';
comment on column public.lesson_report_send_events.db_role is
  '쓰기의 DB 역할 — eywa_sync_agent(연동 PC) · authenticated(로그인 화면) · service_role(관리 키) · 그 밖(SQL 직접).';
comment on column public.lesson_report_send_events.source_id is
  'origin=backfill_audit: 옮겨 온 audit_logs.id';

-- ── 사본 — 학부모 카드가 그리는 칸 ───────────────────────────────────────────
-- 행은 jsonb로 받는다(칸이 더해지거나 없는 DB에서도 깨지지 않게 — 없는 칸은 빠질 뿐).
-- 교차 조회(학생·반·설정)는 같은 지점 조건을 건다(0306a). p_settings = 카드 표시 설정을 함께 뜰지
-- (백필은 false — 지금 설정은 그때 설정이 아니다).
create or replace function lesson_report_send_private.snapshot(p_row jsonb, p_tenant uuid, p_settings boolean)
returns jsonb
language sql
stable
set search_path = public
as $fn$
  select (
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(p_row) e
    where e.key = any (array[
      'report_date', 'subject', 'teacher_name', 'textbook', 'progress', 'homework_today', 'daily_test',
      'check_test', 'exam_info', 'homework_score', 'attitude', 'notes', 'trend_note', 'attachments',
      'share_token', 'edutrix_share_token', 'makeup', 'video_homework', 'video_homework_due',
      'video_submit_link', 'class_id', 'makeup_class_id', 'classnote_class_id', 'covers_date',
      'revoked_at', 'source', 'ment_source'])
  )
  || jsonb_build_object(
    'student', (
      select jsonb_build_object('name', s.name, 'school', s.school, 'grade', s.grade)
      from public.students s
      where s.id = nullif(p_row ->> 'student_id', '')::uuid and s.tenant_id = p_tenant),
    'classes', (
      select jsonb_object_agg(c.id::text, c.class_name)
      from public.classes c
      where c.tenant_id = p_tenant
        and c.id in (nullif(p_row ->> 'class_id', '')::uuid, nullif(p_row ->> 'makeup_class_id', '')::uuid,
                     nullif(p_row ->> 'classnote_class_id', '')::uuid)),
    'card_settings', case when p_settings then (
      select jsonb_object_agg(e.key, e.value)
      from public.tenant_settings ts,
           jsonb_each(case when jsonb_typeof(ts.data -> 'report') = 'object' then ts.data -> 'report'
                           else '{}'::jsonb end) e
      where ts.tenant_id = p_tenant
        and (e.key like 'show%' or e.key in ('title', 'footerNote', 'classnoteMathRoute', 'classnoteMathRoutePilot')))
    end)
$fn$;
revoke all on function lesson_report_send_private.snapshot(jsonb, uuid, boolean) from public, anon, authenticated;

-- ── 기록 트리거 ───────────────────────────────────────────────────────────────
create or replace function lesson_report_send_private.capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(OLD) else '{}'::jsonb end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(NEW) else '{}'::jsonb end;
  v_ref jsonb;            -- 식별 칸을 읽을 행(지움·삭제 = 지우기 직전 행)
  v_snap_row jsonb;       -- 사본을 뜰 행(null = 사본 없음)
  v_from text := v_old ->> 'classnote_status';
  v_to text := v_new ->> 'classnote_status';
  v_old_sent timestamptz := nullif(v_old ->> 'classnote_sent_at', '')::timestamptz;
  v_new_sent timestamptz := nullif(v_new ->> 'classnote_sent_at', '')::timestamptz;
  v_stamped boolean := v_new_sent is not null and v_new_sent is distinct from v_old_sent;  -- 발송 시각이 새로 찍힘
  v_sent timestamptz;
  v_event text;
  v_tenant uuid;
  v_report uuid;
  v_actor uuid := auth.uid();
  v_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  v_actor_name text;
  v_requested_by uuid;
  v_snapshot jsonb;
  v_snapshot_at timestamptz;
  v_prev_id bigint;
  v_prev_at timestamptz;
  v_prev_error text;
  v_prev_retry integer;
  v_prev_snap jsonb;
begin
  if tg_op = 'DELETE' then
    v_ref := v_old;
    v_tenant := OLD.tenant_id;
    v_report := OLD.id;
    -- 지점째 지우는 중(외래키 연쇄) — 이력도 함께 지워지는 중이라 남기지 않는다.
    if not exists (select 1 from public.tenants t where t.id = v_tenant) then return null; end if;
    -- 발송 흔적이 없는 보고서 삭제는 남기지 않는다(지금 상태·발송 시각·이미 쌓인 이력 중 하나라도 있으면 남긴다).
    if v_from is null and v_old_sent is null and not exists (
      select 1 from public.lesson_report_send_events e where e.report_id = v_report and e.tenant_id = v_tenant
    ) then
      return null;
    end if;
    v_event := 'deleted';
    v_snap_row := v_old;
    v_sent := v_old_sent;
  else
    v_ref := v_new;
    v_tenant := NEW.tenant_id;
    v_report := NEW.id;
    if v_to is not distinct from v_from then
      if v_to = 'queued' and v_new_sent is not distinct from v_old_sent
         and (v_new ->> 'classnote_queued_at') is distinct from (v_old ->> 'classnote_queued_at') then
        v_event := 'requested';  -- 대기 중에 다시 누름(요청 시각이 새로 찍힘)
      elsif v_new_sent is not distinct from v_old_sent then
        return null;
      else
        v_event := 'sent_at_changed'; v_snap_row := v_new; v_sent := coalesce(v_new_sent, v_old_sent);
      end if;
    elsif v_to = 'processing' then
      v_event := 'claimed'; v_snap_row := v_new;  -- 연동 PC가 집음 = 캡처 직전 — 이 회차의 사본
    elsif v_to = 'recalling' then
      -- 회수 워커가 집은 순간 — 발송 시각이 함께 바뀐 때만 남긴다.
      if v_new_sent is not distinct from v_old_sent then return null; end if;
      v_event := 'sent_at_changed'; v_snap_row := v_new; v_sent := coalesce(v_new_sent, v_old_sent);
    elsif v_to is null then
      -- 표시 지움 — 지워지는 쪽(OLD)의 발송 시각·공유 토큰·오류·내용을 남긴다(행에서는 사라지는 값).
      v_event := 'cleared';
      v_ref := v_old;
      v_sent := v_old_sent;
      if v_old_sent is not null or v_from in ('success', 'recalled', 'recall_failed', 'recall_requested') then
        v_snap_row := v_old;
      end if;
    elsif v_to = 'queued' then
      v_event := case when v_from = 'processing' then 'retry' else 'requested' end;
    elsif v_to = 'success' then
      -- 발송 시각이 새로 찍힐 때만 '나갔다' — 같은 시각으로 상태만 되돌린 것은 새 발송이 아니다.
      if v_stamped or v_old_sent is null then
        v_event := 'sent'; v_sent := v_new_sent;
      else
        v_event := 'other';
      end if;
      v_snap_row := v_new;
    elsif v_to = 'failed' then
      -- 실패 처리하며 발송 시각을 새로 찍었으면(교차 확인 이상) 게시된 것 — 그때만 sent_at을 싣는다(옛 값은 안 물려받는다).
      v_event := 'failed'; v_snap_row := v_new; v_sent := case when v_stamped then v_new_sent end;
    elsif v_to in ('too_old', 'name_conflict', 'blocked_shared') then
      v_event := 'held';
    elsif v_to in ('recall_requested', 'recall_failed') then
      v_event := v_to;
    elsif v_to = 'recalled' then
      v_event := 'recalled'; v_snap_row := v_new; v_sent := v_new_sent;
    else
      v_event := 'other';
    end if;
  end if;

  begin
    if v_event in ('sent', 'failed') then
      -- 이 회차에 연동 PC가 집은 순간의 사본 = 직전 발송·실패(트리거 줄) 뒤의 **마지막** claimed 하나.
      -- 그 줄이 없거나 사본이 비었으면(사본 실패 대체 줄) 지금 행에서 뜬다 — 더 옛 시도의 사본으로 내려가지 않는다.
      select e.snapshot, e.at into v_prev_snap, v_prev_at
      from public.lesson_report_send_events e
      where e.report_id = v_report and e.tenant_id = v_tenant and e.event = 'claimed'
        and e.id > coalesce((
          select max(e2.id) from public.lesson_report_send_events e2
          where e2.report_id = v_report and e2.tenant_id = v_tenant and e2.origin = 'trigger'
            and e2.event in ('sent', 'failed')), 0)
      order by e.id desc
      limit 1;
      if v_prev_snap is not null then
        v_snapshot := v_prev_snap;
        v_snapshot_at := v_prev_at;
      end if;
      v_prev_snap := null;
      select e.actor_id into v_requested_by
      from public.lesson_report_send_events e
      where e.report_id = v_report and e.tenant_id = v_tenant and e.event = 'requested'
      order by e.at desc, e.id desc
      limit 1;
    end if;
    if v_snap_row is not null and v_snapshot is null then
      v_snapshot := lesson_report_send_private.snapshot(v_snap_row, v_tenant, true);
      v_snapshot_at := now();
    end if;
    if v_event in ('claimed', 'retry') and v_actor is null then
      -- 연동 PC가 집었다 곧바로 놓는 반복(비상 정지·시험 모드 — 15초마다)은 처음 한 번만 남긴다.
      -- 좁게 본다: 로그인 사용자가 한 일(멈춤 복구 등)은 늘 남기고, retry는 집은 지 2분 안에 되돌린 것만 ·
      -- claimed는 직전 claimed가 10분 안일 때만 · 사이에 claimed·retry 말고 다른 일이 없고 내용이 같을 때만.
      -- (15분 넘게 쥐고 있다 되돌린 멈춤 복구는 그 사이 게시됐을 수 있어 반드시 남긴다.)
      select e.id, e.at, e.error, e.retry_count, e.snapshot
        into v_prev_id, v_prev_at, v_prev_error, v_prev_retry, v_prev_snap
      from public.lesson_report_send_events e
      where e.report_id = v_report and e.tenant_id = v_tenant and e.event = v_event
      order by e.id desc
      limit 1;
      if v_prev_id is not null
         and not exists (
           select 1 from public.lesson_report_send_events e
           where e.report_id = v_report and e.tenant_id = v_tenant and e.id > v_prev_id
             and e.event not in ('claimed', 'retry'))
         and (case when v_event = 'retry'
                   then v_prev_error is not distinct from (v_ref ->> 'classnote_error')
                        and v_prev_retry is not distinct from nullif(v_ref ->> 'classnote_retry_count', '')::integer
                        and nullif(v_old ->> 'classnote_processing_at', '')::timestamptz > now() - interval '2 minutes'
                   else v_prev_snap is not distinct from v_snapshot
                        and v_prev_at > now() - interval '10 minutes' end) then
        return null;
      end if;
    end if;
    if v_actor is not null then
      select u.display_name into v_actor_name from public.users u where u.id = v_actor;
    end if;
    insert into public.lesson_report_send_events (
      tenant_id, report_id, student_id, report_date, subject, class_id, makeup_class_id, classnote_class_id,
      event, from_status, to_status, sent_at, queued_at, processing_at, retry_count, error, share_token,
      actor_id, actor_name, db_role, requested_by, snapshot, snapshot_at)
    values (
      v_tenant, v_report, nullif(v_ref ->> 'student_id', '')::uuid, nullif(v_ref ->> 'report_date', '')::date,
      v_ref ->> 'subject', nullif(v_ref ->> 'class_id', '')::uuid, nullif(v_ref ->> 'makeup_class_id', '')::uuid,
      nullif(v_ref ->> 'classnote_class_id', '')::uuid,
      v_event, v_from, v_to, v_sent,
      nullif(v_ref ->> 'classnote_queued_at', '')::timestamptz,
      nullif(v_ref ->> 'classnote_processing_at', '')::timestamptz,
      nullif(v_ref ->> 'classnote_retry_count', '')::integer, v_ref ->> 'classnote_error',
      nullif(v_ref ->> 'share_token', '')::uuid,
      v_actor, v_actor_name, v_role, v_requested_by, v_snapshot, v_snapshot_at);
  exception when others then
    -- 사본·이름 조회가 깨져도 '이 일이 있었다'는 남긴다(사본 없이).
    begin
      insert into public.lesson_report_send_events (
        tenant_id, report_id, student_id, report_date, subject, event, from_status, to_status, sent_at,
        actor_id, db_role, note)
      values (
        v_tenant, v_report, nullif(v_ref ->> 'student_id', '')::uuid, nullif(v_ref ->> 'report_date', '')::date,
        v_ref ->> 'subject', v_event, v_from, v_to, v_sent, v_actor, v_role,
        left('사본을 남기지 못함: ' || sqlstate || ' ' || sqlerrm, 500));
    exception when others then
      -- 🔴 여기서 다시 던지지 않는다 — 발송 상태 저장이 실패하면 연동 PC가 같은 글을 또 올린다.
      raise warning 'lesson_report_send_events 기록 실패(report %, event %): % %', v_report, v_event, sqlstate, sqlerrm;
    end;
  end;
  return null;
end;
$fn$;
revoke all on function lesson_report_send_private.capture() from public, anon, authenticated;

-- UPDATE: 발송 상태·발송 시각이 바뀐 줄 + 대기 중에 다시 누른 줄(요청 시각만 바뀜).
-- INSERT: 처음부터 발송 상태가 실린 줄(이관 등). DELETE: 함수 안에서 발송 흔적을 본다(WHEN에서는 이력 표를 볼 수 없다).
create or replace trigger lesson_report_send_events_u
  after update of classnote_status, classnote_sent_at, classnote_queued_at on public.lesson_reports
  for each row
  when (OLD.classnote_status is distinct from NEW.classnote_status
        or OLD.classnote_sent_at is distinct from NEW.classnote_sent_at
        or (NEW.classnote_status = 'queued' and OLD.classnote_queued_at is distinct from NEW.classnote_queued_at))
  execute function lesson_report_send_private.capture();
create or replace trigger lesson_report_send_events_i
  after insert on public.lesson_reports
  for each row
  when (NEW.classnote_status is not null or NEW.classnote_sent_at is not null)
  execute function lesson_report_send_private.capture();
create or replace trigger lesson_report_send_events_d
  after delete on public.lesson_reports
  for each row
  execute function lesson_report_send_private.capture();

-- ── 행 보호 — 추가만 ──────────────────────────────────────────────────────────
create or replace function lesson_report_send_private.guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- 지점째 지울 때만 통과(외래키 연쇄가 이 줄을 지운다 — 그때는 지점 행이 이미 안 보인다).
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants t where t.id = OLD.tenant_id) then
    return OLD;
  end if;
  raise exception '발송 이력은 고치거나 지울 수 없습니다' using errcode = '42501';
end;
$fn$;
revoke all on function lesson_report_send_private.guard() from public, anon, authenticated;

create or replace trigger lesson_report_send_events_guard
  before update or delete on public.lesson_report_send_events
  for each row execute function lesson_report_send_private.guard();

comment on function lesson_report_send_private.capture() is
  '수업보고서 발송 상태가 바뀔 때마다 lesson_report_send_events에 한 줄 — 원래 쓰기를 막지 않는다. 0392a';

commit;

notify pgrst, 'reload schema';
