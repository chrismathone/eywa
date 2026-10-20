-- 오늘 수학 월말평가 성적표 PDF → 그 학생 수업보고서 첨부(원장 2026-10-18 *"오늘 수학에 완성되면 pdf 첨부하는 방향으로"*).
--
-- aywa가 결과 동기화 뒤에 오늘 수학 `/api/integrations/eywa/v2/exam-reports/{날짜}`(확정된 성적표만)를 끌어와,
-- (학생, 반, 시험일)의 수학 보고서가 **아직 안 보낸 것**이면 PDF를 첨부에 붙인다. 보낸 보고서 · 보고서 없음은 붙이지 않고
-- 선생님에게 한 번 알린다(조용히 넘기지 않는다). 재채점·문장 수정으로 성적표 지문이 바뀌면 같은 시험의 옛 PDF를 새 것으로 바꾼다.
-- 이 표 = 성적표 하나(발행본 × 학생)가 지금 어디에 있는지. 붙이는 쓰기는 아래 함수 하나(보고서 줄 잠금 · 발송 상태 확인 · 교체를 한 거래로).
--
-- 새 표 하나 + 서버 전용 함수 둘. 기존 표·함수는 그대로(보고서의 발송 상태 칸은 건드리지 않는다 — 안 보낸 보고서라 되돌릴 것이 없다).
-- 🔴 정책 없는 RLS = 의도적이다(0371a와 같다) — 서버 키로만 읽고 쓴다. 앱보다 먼저 적용한다(표가 없으면 첨부는 "준비 전"으로 건너뛴다).
begin;
set local lock_timeout = '5s';

create table if not exists public.todays_math_exam_report_links (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  publication_id uuid not null,            -- 오늘 수학 월말평가 발행본 id
  student_id uuid not null,                -- aywa 학생
  class_id uuid not null,                  -- aywa 반(오늘 수학이 그 반의 연결 id로 준다)
  test_date date not null,
  source_test_id uuid not null,
  item_sha256 text not null check (item_sha256 ~ '^[0-9a-f]{64}$'),   -- 오늘 수학 목록의 지문(바뀌면 다시 받는다)
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  -- attached = 보고서에 붙음 · waiting_report = 그날 그 반 보고서가 아직 없음(나중에 생기면 붙인다)
  -- report_sent = 이미 보낸 보고서라 안 붙임 · report_busy = 발송 처리 중(다음 회차에 다시) · attach_full = 첨부 칸이 다 참
  state text not null check (state in ('attached', 'waiting_report', 'report_sent', 'report_busy', 'attach_full')),
  lesson_report_id uuid references public.lesson_reports(id) on delete set null,
  attachment_path text check (attachment_path is null or length(attachment_path) <= 300),
  attached_sha256 text check (attached_sha256 is null or attached_sha256 ~ '^[0-9a-f]{64}$'),  -- 지금 보고서에 붙은 PDF의 지문
  notified_state text,                     -- 선생님에게 마지막으로 알린 상태(같은 상태로는 두 번 알리지 않는다)
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (tenant_id, publication_id, student_id),
  foreign key (tenant_id, student_id) references public.students(tenant_id, id) on delete cascade
);
create index if not exists todays_math_exam_report_links_day on public.todays_math_exam_report_links (tenant_id, test_date);
alter table public.todays_math_exam_report_links enable row level security;
revoke all on public.todays_math_exam_report_links from public, anon, authenticated;
grant all on public.todays_math_exam_report_links to service_role;
comment on table public.todays_math_exam_report_links is
  '오늘 수학 월말평가 성적표(발행본 × 학생)가 붙은 수업보고서와 상태. 서버 전용.';

-- 성적표를 찾아볼 날 — 기간 안에 오늘 수학 월말평가 결과가 있는 날 + 아직 끝나지 않은(붙지 못한) 성적표의 날.
create or replace function public.todays_math_exam_report_dates(p_tenant uuid, p_from date, p_to date)
returns setof date language sql stable security invoker set search_path = public, pg_temp as $$
  select d from (
    select distinct test_date d from public.todays_math_test_results
      where tenant_id = p_tenant and kind = 'monthly' and not absent and test_date between p_from and p_to
    union
    select distinct test_date from public.todays_math_exam_report_links
      where tenant_id = p_tenant and state <> 'attached' and test_date between p_from and p_to
  ) x order by d desc
$$;
revoke all on function public.todays_math_exam_report_dates(uuid, date, date) from public, anon, authenticated;
grant execute on function public.todays_math_exam_report_dates(uuid, date, date) to service_role;

-- 성적표 하나를 보고서에 붙인다(또는 붙이지 못한 까닭을 남긴다). 두 번 부른다: ① 경로 없이(p_path null) — 붙일 수 있으면
--   'needs_pdf'만 돌려주고 아무것도 안 쓴다(PDF를 쓸데없이 받지 않게) ② 앱이 PDF를 받아 저장소에 올린 뒤 그 경로로 다시.
--   두 번째 부름도 이 순간의 보고서 상태를 다시 본다(그사이 보냈으면 report_sent — 앱이 올린 파일을 지운다).
--  · 보고서 = (학생, 반, 시험일)의 수학 보고서. 줄을 잠그고 발송 상태를 이 순간에 다시 본다(앱이 읽은 뒤 워커가 보냈을 수 있다).
--  · 붙일 수 있음 = 아직 안 보낸 보고서(상태 없음 · 대기 · 실패 · 기한 지남 · 이름 충돌). 처리 중이면 다음 회차에(busy).
--    보냄 · 회수 중 · 회수됨이면 붙이지 않는다(붙이면 학부모에게 같은 글이 다시 간다).
--  · 같은 성적표의 옛 PDF(이 표의 attachment_path)는 첨부 목록에서 빼고 새 것을 넣는다. 첨부는 6개까지(attach_full).
-- 돌려주는 값: {state, reportId, replacedPath, recipientId} — replacedPath는 앱이 저장소에서 지울 옛 파일(없으면 null),
--   recipientId는 알릴 사람(보고서를 쓴 선생님 → 없으면 그 반 담임). p_path가 쓰이지 않았으면(attached가 아님) 앱이 지운다.
create or replace function public.todays_math_attach_exam_report(
  p_tenant uuid, p_publication uuid, p_student uuid, p_class uuid, p_date date, p_source_test uuid,
  p_item_sha text, p_pdf_sha text, p_path text, p_name text, p_size integer
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_link public.todays_math_exam_report_links%rowtype;
  v_rid uuid;
  v_ratt jsonb;
  v_rstatus text;
  v_rby uuid;
  v_state text;
  v_list jsonb;
  v_replaced text;
  v_recipient uuid;
  v_used boolean := false;
begin
  if p_tenant is null or p_publication is null or p_student is null or p_class is null or p_date is null or p_source_test is null
    or p_item_sha !~ '^[0-9a-f]{64}$' or p_pdf_sha !~ '^[0-9a-f]{64}$'
    or (p_path is not null and (p_path not like p_tenant::text || '/report-attachments/%' or length(p_path) > 300
      or p_name is null or length(p_name) not between 1 and 200 or p_size is null or p_size not between 5 and 20000000)) then
    raise exception '오늘 수학 성적표 첨부 값이 올바르지 않습니다.';
  end if;
  if not exists (select 1 from public.classes c where c.tenant_id = p_tenant and c.id = p_class)
    or not exists (select 1 from public.students s where s.tenant_id = p_tenant and s.id = p_student) then
    raise exception '오늘 수학 성적표의 학생·반이 이 학원에 없습니다.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('todays_math_exam_report:' || p_tenant::text || ':' || p_publication::text || ':' || p_student::text, 0));
  select * into v_link from public.todays_math_exam_report_links
    where tenant_id = p_tenant and publication_id = p_publication and student_id = p_student for update;

  select r.id, r.attachments, r.classnote_status, r.created_by into v_rid, v_ratt, v_rstatus, v_rby
    from public.lesson_reports r
    where r.tenant_id = p_tenant and r.student_id = p_student and r.class_id = p_class and r.report_date = p_date
    order by r.created_at, r.id limit 1
    for update;

  if v_rid is null then
    v_state := 'waiting_report';
  elsif v_rstatus = 'processing' then
    v_state := 'report_busy';
  elsif v_rstatus in ('success', 'recall_requested', 'recalling', 'recall_failed', 'recalled') then
    v_state := 'report_sent';
  elsif v_link.attachment_path is not null and v_link.lesson_report_id = v_rid and v_link.attached_sha256 = p_pdf_sha then
    -- 같은 PDF를 이미 이 보고서에 붙였다 — 그대로 둔다(선생님이 첨부에서 지웠다면 다시 붙이지 않는다).
    v_state := 'attached';
  else
    v_list := coalesce(v_ratt, '[]'::jsonb);
    if jsonb_typeof(v_list) <> 'array' then v_list := '[]'::jsonb; end if;
    -- 같은 성적표의 옛 PDF(재채점 전) — 이 표가 기억하는 경로가 지금 이 보고서에 붙어 있으면 뺀다.
    if v_link.attachment_path is not null and v_link.lesson_report_id = v_rid
      and exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'path' = v_link.attachment_path) then
      v_replaced := v_link.attachment_path;
      select coalesce(jsonb_agg(e), '[]'::jsonb) into v_list from jsonb_array_elements(v_list) e where e ->> 'path' is distinct from v_replaced;
    end if;
    if jsonb_array_length(v_list) >= 6 then
      v_state := 'attach_full';
      v_replaced := null;  -- 빼지 않았다(저장 안 함)
    elsif p_path is null then
      -- 붙일 수 있다 — 앱이 PDF를 받아 올린 뒤 경로를 들고 다시 부른다(여기서는 아무것도 쓰지 않는다 · 가득 찬 보고서는 위에서 걸러 PDF를 받지 않는다).
      return jsonb_build_object('state', 'needs_pdf', 'reportId', v_rid, 'usedPath', false, 'replacedPath', null,
        'recipientId', null, 'notifiedState', v_link.notified_state);
    else
      v_list := v_list || jsonb_build_array(jsonb_build_object('path', p_path, 'name', p_name, 'size', p_size));
      update public.lesson_reports set attachments = v_list where id = v_rid;
      v_state := 'attached';
      v_used := true;
    end if;
  end if;

  if v_rid is not null then v_recipient := v_rby; end if;
  if v_recipient is null then
    select c.teacher_id into v_recipient from public.classes c where c.tenant_id = p_tenant and c.id = p_class;
  end if;

  insert into public.todays_math_exam_report_links as l (
    tenant_id, publication_id, student_id, class_id, test_date, source_test_id, item_sha256, pdf_sha256, state,
    lesson_report_id, attachment_path, attached_sha256, updated_at
  ) values (
    p_tenant, p_publication, p_student, p_class, p_date, p_source_test, p_item_sha, p_pdf_sha, v_state,
    v_rid,
    case when v_used then p_path else v_link.attachment_path end,
    case when v_used then p_pdf_sha else v_link.attached_sha256 end,
    now()
  )
  on conflict (tenant_id, publication_id, student_id) do update set
    class_id = excluded.class_id, test_date = excluded.test_date, source_test_id = excluded.source_test_id,
    item_sha256 = excluded.item_sha256, pdf_sha256 = excluded.pdf_sha256, state = excluded.state,
    lesson_report_id = case when v_used then excluded.lesson_report_id else coalesce(l.lesson_report_id, excluded.lesson_report_id) end,
    attachment_path = excluded.attachment_path, attached_sha256 = excluded.attached_sha256, updated_at = now();

  return jsonb_build_object(
    'state', v_state,
    'reportId', v_rid,
    'usedPath', v_used,
    'replacedPath', v_replaced,
    'recipientId', v_recipient,
    'notifiedState', v_link.notified_state
  );
end $$;
revoke all on function public.todays_math_attach_exam_report(uuid, uuid, uuid, uuid, date, uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.todays_math_attach_exam_report(uuid, uuid, uuid, uuid, date, uuid, text, text, text, text, integer) to service_role;

commit;
notify pgrst, 'reload schema';
