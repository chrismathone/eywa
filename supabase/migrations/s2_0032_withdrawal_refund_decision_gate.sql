-- s2_0032 — 퇴원보고서: 원장 환불 결정 전에는 처리하지 않는다 · 데스크 담당자는 학원 설정 지정자만 · 이어진 요청서의 완료 입력은 담당 데스크와 원장만 (2026-11-06)
--
-- 왜(운영 읽기 전용 확인 2026-11-06): 데스크 환불 단계(s2_0025)는 원장급이 '환불 승인'을 눌러 요청서를 이어야만 생긴다.
--   ① 처리일이 오늘이거나 지난 묶음은 관리자 마지막 승인(승인 생략 보고서의 제출) 순간 바로 처리된다(처리 완료 13건 모두 '마지막 승인 시각 = 처리 시각').
--      그 뒤에 환불을 이으면 기다림이 걸리지 않는다(gates=false). ② 환불할 줄이 있어도 승인·처리를 막는 것이 없다.
--   ③ 데스크 담당 후보 = 수납 쓰기 권한자 전원이고, DB 연결은 '재직 직원'만 보며 null도 받았다. ④ 환불완료일자는 수납 쓰기 권한자 누구나 넣고,
--      이어진 요청서를 지우면 기다림이 풀려 바로 처리됐다.
-- 원장 결정(2026-11-06 · 셋 다 권장안):
--   1. 처리 보류 + 원장 결정 — 환불할 수 있는 줄(앱 lineRefundable · 과목 수강종료면 끝내는 반 줄·기타 항목 규칙 그대로)이 남았고 원장급이 그 줄을 정하지 않았으면
--      처리하지 않고 '환불 결정 대기'로 기다린다(전원 승인 · 처리 예약의 처리일 모두). 원장 결정 = '환불 승인'(고른 줄 → 데스크 요청서 · 고르지 않은 줄은
--      같은 동작에서 '환불하지 않음') 또는 '환불 없음'. 결정은 줄 키마다 남고, 결정 뒤 새로 생긴 환불 가능 줄은 다시 결정 안 됨이다.
--   2. 데스크 담당자 = 학원 설정 '데스크 담당자'(permissions.specialAccess.withdrawalDeskIds)로 지정한 사람만. 비면 환불 승인을 막는다(대체 없음).
--   3. 이어진 요청서의 환불완료일자는 그 요청서의 데스크 담당(desk_id)과 원장급만 넣거나 지운다. 이어진 요청서를 지우면 바로 처리하지 않고
--      그 줄들이 다시 결정 안 됨이 되어 '환불 결정 대기'로 돌아간다(원장 할 일 다시).
--
-- 🔴 불변식 — 처리하는 모든 길은 (ⅰ) 데스크 환불 미완료 (ⅱ) 결정 안 된 환불 가능 줄 (ⅲ) 그 요청이 함께 넘긴 환불 확인 값 없음 중 하나라도 있으면 처리하지 않는다.
--   환불 가능 줄 계산은 앱(loadLaterInvoices)에만 있다. 그래서 **처리 요청마다** 앱이 같은 요청에서 계산한 확인 값(refundCheck · 묶음의 환불 가능 줄 키)을
--   함께 넘기고, DB는 저장된 결정으로 결정 안 된 줄을 센다(withdrawal_report_refund_note). 확인 값이 없으면 '모름'이라 처리하지 않는다 —
--   앱 한 경로가 계산을 빠뜨려도 처리되지 않는다(실패하는 쪽으로 닫힘). 묶음의 '환불 결정 대기' 표시(refund_hold)는 화면·할 일·알림용이고,
--   원장급 결정 함수(DB가 행위자 역할을 본다) · 앱 재계산(확인 값을 넘긴 처리 요청)으로만 풀린다.
-- 경로별 막는 자리(전부 DB):
--   · 제출·승인으로 전원 승인 — transition_withdrawal_report: all_approved이면 refund_open(확인 값으로 센 결정 안 된 줄)이 0이 아니거나 데스크 환불이 남으면 기다린다.
--   · 처리일 cron('apply') — 같은 함수 apply 갈래: 미룸(오류 없이 그대로 돌려줌).
--   · release(수납 저장·삭제 · 원장 결정 뒤 · cron 안전망) — release_withdrawal_report_refunds: 확인 값이 있는 묶음만 · 결정 안 된 줄 0일 때만 'release'.
--   · 'release' 직접 호출 — 처리 함수 release 갈래: 확인 값 없거나 결정 안 된 줄이 있으면 그대로 돌려준다.
--   · 바로 처리 — direct_withdrawal_report(이 파일은 바꾸지 않는다)가 부르는 apply는 확인 값이 없어 미룬다(처리 예약으로 남음) → 앱이 이어서 확인 값과 apply.
--   · 옛 단건(_v1) — 작성·제출·반려·취소만 받는다('request'·'approve'·'apply' 거절 · 진행 중 0건).
-- 무엇:
--   1) withdrawal_report_groups 칸 넷 — refund_hold · refund_hold_report · refund_undecided · refund_checked_at(기본값 · 데이터 없음).
--   2) withdrawal_report_refund_decisions(묶음 × 줄 키 → 'refund'(요청서) | 'none') — RLS · service_role만.
--   3) withdrawal_report_refund_note(묶음, 확인 값, 행위자, 결정 여부) — 결정 안 된 줄 수(확인 값 없으면 null) · 표시 · 보고서 이력('refund_hold' ·
--      'refund_hold_clear') · 원장급 알림 '퇴원보고서 환불 결정 요청'(운영자 계정 · 행위자 제외) · 할 일 동기화.
--   4) transition_withdrawal_report — s2_0030 본문에서 일곱 자리만(선언 · apply · release · 취소 사유 · 자식 이력 · 전원 승인 · 끝난 묶음 표시 내림 · 시험이 글자로 대조).
--      취소 사유(원장 2026-11-06 *"요청 취소시에 '사유' 입력할 수 있고 마우스 올리면 사유 확인가능하게"*): 'cancel'에 p_payload->>'comment'가 있으면
--      앞뒤 공백을 빼고 1~500자를 검사해 묶음의 모든 보고서 이력 'cancel' 줄 comment에 남긴다. last_comment(반려 사유·재검토 안내 칸)는 건드리지 않는다.
--      없으면 종전처럼 사유 없이 취소(필수 여부는 앱이 정한다). 취소 알림 본문에는 붙이지 않는다 — 반려 사유도 알림 본문에 넣지 않는 규칙과 같다
--      (알림은 '이름 · 마지막 수업일'만 · 슬랙으로도 나간다). 데스크 '환불 진행 전 확인' 알림도 그대로.
--   5) transition_withdrawal_report_v1 — 받는 처리 한 줄 치환.
--   6) staff_tasks_private.withdrawal_sync_report — 원장 '환불 결정' 차례(refund:<원장 id>) 열기·닫기(세 줄 치환).
--   7) attach_withdrawal_report_refund — 6인자를 지우고 8인자(뒤 둘 기본값 null)로: 행위자 원장급 · 데스크 = 학원 설정 지정자(비거나 null이면 거절 ·
--      재직 사무 역할) · 고른 줄 '환불' · 고르지 않은 줄 '환불하지 않음' · 보고서 이력에 함께 · 표시 맞춤.
--   8) decide_withdrawal_report_refund — 원장 '환불 없음'(원장급만 · 처리 전 묶음 · 확인 값 안의 이 보고서 줄만) · 이력 'refund_decision' · 처리는 하지 않는다.
--   9) release_withdrawal_report_refunds — 3인자를 지우고 4인자(p_checks 기본값 null): 확인 값 없으면 빈 결과.
--  10) academy_documents BEFORE INSERT OR UPDATE 트리거 — 이어진 요청서의 환불완료일자 변경은 세션 행위자가 그 요청서 데스크 담당·원장일 때만(42501) ·
--      이어진 요청서의 번호·지점·서식·표식 변경과 같은 번호로 다시 넣기는 누구도 못 한다(트리거 우회·표식 위조 막기).
-- 원장급 = 원장 역할(master · 운영자 계정 포함 — 기존 환불 승인·취소 규칙 그대로). 알림·할 일 받는 사람만 운영자 계정을 뺀다(기존 원장 승인자 규칙).
-- 순서: 🔴 앱보다 먼저(#95) · 🔴 s2_0030 적용 뒤에만(처리 함수·_v1 지문이 s2_0030 적용 뒤 값이어야 한다 — 다르면 멈춘다).
--   운영은 2026-11-06 읽기 전용 확인 때 s2_0030 적용 뒤였다(처리 함수·_v1 지문이 아래 검사 값과 같음 · attach·release·할 일 동기화는 s2_0025 그대로).
-- 번호: 가지에서는 s2_0031로 만들었으나 main의 학원 비서(s2_0031_academy_assistant · 운영 적용 2026-11-06 17:37)와 겹쳐 s2_0032로 옮겼다.
--   두 파일은 서로 다른 객체만 건드린다(순서 무관 · 이 파일의 검사는 위 다섯 함수 지문만 본다).
-- 옛 앱이 도는 동안(적용 ~ 새 앱 배포) — 옛 앱은 확인 값을 넘기지 않는다. 처리는 하지 않는 쪽으로 닫힌다:
--   · 제출·승인: 승인은 그대로 기록된다. 전원 승인이 되어도 처리하지 않고 기다린다(알림 '퇴원보고서 승인 완료 · 처리 확인 대기').
--   · 처리일 cron(apply): 미룬다(오류 없음 — 옛 앱은 '미룸'으로 센다).
--   · 수납 저장·삭제(release 3인자): 4인자 기본값으로 와서 빈 결과(옛 앱은 아무것도 기록하지 않는다).
--   · 바로 처리: 보고서는 만들어지고 처리일이 지났어도 처리 예약으로 남는다.
--   · 환불 승인(attach 6인자): 원장급만 · 데스크가 학원 설정 지정 명단에 있어야 한다 — 명단은 처음에 비어 있으니 옛 앱의 환불 승인은 거절되고
--     옛 앱이 방금 만든 요청서를 지운다(감사로그 '요청서 삭제'). 고른 줄은 '환불'로 남지 않는다(거절이라 아무것도 남지 않는다).
--   · 완료 입력(수납 저장): 세션 쓰기는 트리거가 막는다(이어진 요청서만 · 운영 0건).
--   · 요청 취소: 옛 앱은 사유를 보내지 않는다 — 종전처럼 사유 없이 취소된다(이력 comment 비움 · 목록의 취소 정보는 '사유 기록 없음').
--   새 앱 배포 뒤 처리일 cron(00:05)이 기다리던 묶음을 다시 계산해 처리하거나 원장 결정을 요청한다. 배포 직후 /api/cron/apply-due-withdrawals를
--   한 번 부르면 바로 정리된다.
-- 남은 틈(그대로 · 팀장 2026-11-06): 이어진 요청서 삭제와 release가 같은 순간(ms)에 겹치면 처리될 틈 — 잠금 순서상 매우 드묾.
-- 진행 중(2026-11-06 읽기 전용 조회): 묶음 pending 2건(둘 다 처리일 지남 · 아직 승인 전 — 걸리는 처리 없음) · 처리 예약 0 · 보고서 환불 연결 0 ·
--   보고서에서 만든 환불 요청서 0 · 옛 단건 진행 0 · 학원 설정 데스크 명단 0곳.
-- 확인(로컬 PGlite 0.3.16 · PG 17.5 — 운영 표 구조와 운영 함수 정의를 올림 · 운영 지문과 같음을 먼저 확인): 운영 정의 → s2_0030 → 이 파일 →
--   경로별 30개 사례(전원 승인 · release 직접 호출 · release 함수(옛 3인자 포함) · 처리일 apply · 바로 처리 · 옛 단건 · 원장 '환불 없음'(원장만) ·
--   환불 승인(원장만 · 지정 데스크만 · null 거절 · 고르지 않은 줄 환불하지 않음) · 완료 입력(담당 데스크·원장만 · 그 밖 세션 42501) · 요청서 삭제 → 다시 대기 ·
--   결정 뒤 새 줄 → 다시 대기 · 재계산으로 줄이 사라지면 해제 · 취소 → 할 일 취소 · 잘못된 확인 값 → 거절 · 트리거 우회(같은 번호로 다시 넣기 · 서식·표식 바꾸기) 거절 · 요청 취소 사유(공백뿐·501자 거절 · 두 보고서 묶음 이력에 같은 사유 · 사유 없는 옛 호출 통과) ·
--   묶음 경계(팀장 결정 2026-11-06 — 새 묶음은 자기 묶음의 결정만 센다: 취소된 묶음의 요청서가 담은 줄 → 결정 안 됨 → 전원 승인·release여도 대기 · 새 묶음에서 다시 환불 승인 →
--   데스크 완료 뒤 처리 · 다른 묶음에서 환불을 마친 줄도 대기 → '환불 없음' 뒤 처리)) ·
--   되돌리기 왕복 · CRLF/LF 줄바꿈 모두 통과.
-- 적용 확인(읽기만):
--   select to_regprocedure('public.decide_withdrawal_report_refund(uuid,uuid,uuid,jsonb,jsonb)') is not null
--      and to_regprocedure('public.release_withdrawal_report_refunds(uuid,uuid,uuid)') is null;  -- 기대: true
--   적용 뒤 지문(공백 뺀 md5 · 위 PGlite 값):
--     transition_withdrawal_report f122700633df18f0f784453843816027 · transition_withdrawal_report_v1 c8d87498a853195d7c86de12b21ae6d8 ·
--     attach_withdrawal_report_refund(8인자) a8db90811a3a6ab1a15efbc4d1540c18 · release_withdrawal_report_refunds(4인자) 2516d0340b850c14faa4f91e9ea673ca ·
--     staff_tasks_private.withdrawal_sync_report 577ba3f3c9f2c429b051b8656a660cb0 · withdrawal_report_refund_note 68a2408187a7c53c87d9ee3787fd1734 ·
--     decide_withdrawal_report_refund 5d2702c73c9f625ab25384aeb8e5a572 · withdrawal_report_refund_complete_guard cb6524d746a305a5931abe3ede48d982
-- 적용할 때: 기본 search_path 세션(운영 기본값 = 사용자 이름 스키마 · public · extensions)에서 아래 begin…commit 그대로 실행한다
--   (빈 search_path면 지문이 달라져 멈춘다 — 안전한 쪽 실패). 중간에 실패하면 ROLLBACK 하거나 연결을 닫는다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0032-withdrawal-refund-decision-gate.sql(앱을 먼저 되돌린 뒤 · 진행 중 '환불 결정 대기'나 승인이 끝났는데 처리 안 된 묶음이 있으면 멈춘다).
-- 🔴 한 번만 적용한다(다시 돌리면 지문 검사로 멈춘다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 운영 정의 지문(s2_0030 적용 뒤 · 공백 뺀 md5) — 하나라도 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
declare
  want constant jsonb := jsonb_build_object(
    'public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)', 'a105bba84b9630353d04729397e190d9',
    'public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)', '5a11f3fc0e920c413902ba2f137d0666',
    'public.attach_withdrawal_report_refund(uuid,uuid,uuid,uuid,uuid,boolean)', '846a34cb47bf901eb959c3e51f2b87e5',
    'public.release_withdrawal_report_refunds(uuid,uuid,uuid)', 'b03844a446c9db506fef5669c552c187',
    'staff_tasks_private.withdrawal_sync_report(uuid)', 'a8a0fb1aa5b897ff1eac199a33b03a5f');
  fn text;
  got text;
begin
  for fn in select jsonb_object_keys(want) loop
    select md5(regexp_replace(pg_get_functiondef(fn::regprocedure), '[[:space:]]+', '', 'g')) into got;
    if got is distinct from want->>fn then
      raise exception 's2_0032: % 의 운영 정의가 기준(s2_0030 적용 뒤 · 2026-11-06)과 다릅니다(%). s2_0030을 먼저 적용했는지 보고, 바뀐 내용을 이 파일에 옮긴 뒤 지문을 갱신하세요.', fn, got;
    end if;
  end loop;
end $$;

-- ── 1) 묶음의 '환불 결정 대기' 표시 ─────────────────────────────────────────────────────────────────────
-- refund_hold = 앱이 마지막으로 넘긴 환불 확인에서 원장이 결정하지 않은 환불 가능 줄이 있었다(처리 전 묶음만). 처리 여부는 이 표시가 아니라
-- **그 처리 요청이 함께 넘긴 확인 값**으로 정한다(표시는 화면·할 일·알림용). refund_hold_report = 결정할 줄을 보이는 보고서(할 일·알림 링크).
alter table public.withdrawal_report_groups
  add column if not exists refund_hold boolean not null default false,
  add column if not exists refund_hold_report uuid,
  add column if not exists refund_undecided text[] not null default '{}',
  add column if not exists refund_checked_at timestamptz;
comment on column public.withdrawal_report_groups.refund_hold is '환불 결정 대기(s2_0032) — 원장이 결정하지 않은 환불 가능 청구 줄이 있어 퇴원·수강종료를 처리하지 않고 기다린다.';

-- ── 2) 원장 환불 결정 — 묶음의 청구 줄 키마다 '환불'(그 요청서) 또는 '환불하지 않음' ─────────────────────────────
create table if not exists public.withdrawal_report_refund_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  group_id uuid not null references public.withdrawal_report_groups(id) on delete cascade,
  report_id uuid not null references public.withdrawal_reports(id) on delete cascade,
  line_key text not null check (line_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|[0-9a-z]{1,8}(-[0-9]{1,2})?)$'),
  decision text not null check (decision in ('refund', 'none')),
  -- '환불'이면 그 줄을 잡은 환불 요청서(외래키 없음 — s2_0025처럼 요청서 삭제를 막지 않는다 · 지워지면 그 줄은 다시 '결정 안 됨').
  document_id uuid,
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  unique (group_id, line_key),
  check ((decision = 'refund') = (document_id is not null))
);
comment on table public.withdrawal_report_refund_decisions is '퇴원보고서 원장 환불 결정(s2_0032) — 줄 키(<청구 id>#<줄 식별값>)마다. 결정 뒤 새로 생긴 줄 · 요청서가 지워진 줄은 다시 결정 안 됨.';
alter table public.withdrawal_report_refund_decisions enable row level security;
revoke all on public.withdrawal_report_refund_decisions from public, anon, authenticated;
grant select, insert, update on public.withdrawal_report_refund_decisions to service_role;

-- ── 3) 환불 결정 대기 판정·표시 ──────────────────────────────────────────────────────────────────────────
-- p_check = 앱이 같은 요청에서 계산한 **지금 환불할 수 있는 줄**(`{"refundable":[{"key":…,"report":…}]}` · 앱 loadLaterInvoices·lineRefundable — 과목 수강종료면
--   끝내는 반 줄·기타 항목 규칙 그대로). 결정 안 됨 = 그 줄 중 '환불하지 않음' 결정도, 아직 남은 요청서의 '환불' 결정도 없는 줄.
-- 반환 = 결정 안 된 줄 수 · null = 확인 값 없음(모름 — 부르는 쪽은 처리하지 않는다). 처리 전 묶음(진행 중·처리 예약)만 표시를 바꾼다.
-- 새로 기다리게 되면: 결정할 줄을 보이는 보고서에 이력 '환불 결정 대기' · 원장급(운영자 계정 제외)에게 '퇴원보고서 환불 결정 요청' 알림 · 할 일(원장 환불 결정).
-- 풀리면: 할 일을 닫는다(처리됨) · 결정이 아닌 재계산으로 풀렸으면 이력 '환불 결정 대기 해제'.
create or replace function public.withdrawal_report_refund_note(p_tenant uuid, p_group uuid, p_check jsonb, p_actor uuid, p_decided boolean default false)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  g public.withdrawal_report_groups; undecided text[]; hold_report uuid; n integer; was boolean; was_report uuid; rid uuid; recipient uuid; report_status text;
begin
  if p_check is null or jsonb_typeof(p_check) is distinct from 'object' then return null; end if;
  select * into g from public.withdrawal_report_groups where tenant_id = p_tenant and id = p_group;
  if g.id is null then raise exception '퇴원보고서 묶음을 찾을 수 없습니다.'; end if;
  if jsonb_typeof(p_check->'refundable') is distinct from 'array' or jsonb_array_length(p_check->'refundable') > 500
     or exists(select 1 from jsonb_array_elements(p_check->'refundable') e
       where jsonb_typeof(e) is distinct from 'object'
          or coalesce(e->>'key', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|[0-9a-z]{1,8}(-[0-9]{1,2})?)$'
          or not exists(select 1 from public.withdrawal_reports q where q.tenant_id = p_tenant and q.group_id = g.id and q.id::text = lower(coalesce(e->>'report', ''))))
  then raise exception '환불 확인 값이 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.'; end if;
  with lines as (
    select e->>'key' k, (select q.id from public.withdrawal_reports q where q.group_id = g.id and q.id::text = lower(e->>'report')) rid, ord
      from jsonb_array_elements(p_check->'refundable') with ordinality x(e, ord)
  ), open_lines as (
    select l.* from lines l
     where not exists(select 1 from public.withdrawal_report_refund_decisions d
       where d.tenant_id = p_tenant and d.group_id = g.id and d.line_key = l.k
         and (d.decision = 'none' or exists(select 1 from public.academy_documents doc where doc.tenant_id = p_tenant and doc.id = d.document_id and doc.form_type = 'refund_request')))
  )
  select coalesce((select array_agg(distinct o.k order by o.k) from open_lines o), '{}'),
         (select o.rid from open_lines o join public.withdrawal_reports q on q.id = o.rid order by q.group_leader desc, o.ord limit 1)
    into undecided, hold_report;
  n := cardinality(undecided);
  was := g.refund_hold; was_report := g.refund_hold_report;
  if g.status not in ('pending', 'scheduled') then
    if was then update public.withdrawal_report_groups set refund_hold = false where id = g.id; end if;
    return n;
  end if;
  update public.withdrawal_report_groups
     set refund_hold = n > 0, refund_hold_report = case when n > 0 then hold_report else refund_hold_report end,
         refund_undecided = undecided, refund_checked_at = now()
   where id = g.id;
  if n > 0 and (not was or was_report is distinct from hold_report) then
    select q.status into report_status from public.withdrawal_reports q where q.id = hold_report;
    insert into public.withdrawal_report_events(tenant_id, report_id, actor_id, action, from_status, to_status, comment)
      values (p_tenant, hold_report, p_actor, 'refund_hold', report_status, report_status,
        '원장 환불 결정 대기 — 결정하지 않은 환불 가능 청구 줄 ' || n || '건. 원장이 환불 승인 또는 환불 없음을 정하면 처리합니다.');
  elsif n = 0 and was and not p_decided and was_report is not null then
    select q.status into report_status from public.withdrawal_reports q where q.id = was_report;
    if report_status is not null then
      insert into public.withdrawal_report_events(tenant_id, report_id, actor_id, action, from_status, to_status, comment)
        values (p_tenant, was_report, p_actor, 'refund_hold_clear', report_status, report_status, '결정할 환불 가능 청구 줄이 남지 않아 환불 결정 대기를 풀었습니다.');
    end if;
  end if;
  if (n > 0) is distinct from was or (n > 0 and was_report is distinct from hold_report) then
    for rid in select q.id from public.withdrawal_reports q where q.tenant_id = p_tenant and q.group_id = g.id order by q.id loop
      perform staff_tasks_private.withdrawal_sync_report(rid);
    end loop;
  end if;
  if n > 0 and not was then
    for recipient in select u.id from public.users u
        where u.tenant_id = p_tenant and u.status = 'active' and u.system_role::text = 'master' and not coalesce(public.is_super_admin(u.id), false)
          and u.id is distinct from p_actor order by u.id loop
      insert into public.notifications(tenant_id, recipient_id, type, title, body, link, actor_id)
        values (p_tenant, recipient, 'approval_requested', '퇴원보고서 환불 결정 요청', coalesce(g.snapshot->>'name', '학생') || ' · ' || g.effective_date::text,
          '/withdrawal-reports/' || hold_report::text, p_actor);
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.withdrawal_report_refund_note(uuid, uuid, jsonb, uuid, boolean) from public, anon, authenticated;
grant execute on function public.withdrawal_report_refund_note(uuid, uuid, jsonb, uuid, boolean) to service_role;

-- ── 4) 처리 함수 — s2_0030 본문에서 처리하는 세 자리(전원 승인 · 처리일 apply · release)에 환불 결정을 건다 ─────────────────
create or replace function public.transition_withdrawal_report(p_tenant uuid, p_actor uuid, p_report uuid, p_action text, p_payload jsonb default '{}'::jsonb)
 returns public.withdrawal_reports
 language plpgsql
 set search_path to 'public'
as $function$
declare
 r public.withdrawal_reports; g public.withdrawal_report_groups; actor public.users; snap jsonb;
 gid uuid; prior text; recipient uuid; recipients uuid[]:='{}'; headline text; comment_text text;
 field text; child public.withdrawal_reports; valid boolean; targets uuid[]; affected integer; cmp_subjects text[]; all_approved boolean; mgrs uuid[];
 -- 결정하지 않은 환불 가능 줄 수(s2_0032 · withdrawal_report_refund_note) — null = 앱이 환불 확인 값을 넘기지 않음(모름 → 처리하지 않는다).
 refund_open integer;
 today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if p_action='request' then
  perform 1 from public.students where tenant_id=p_tenant and id=(p_payload->>'studentId')::uuid for update;
  if exists(select 1 from public.withdrawal_report_groups where tenant_id=p_tenant and student_id=(p_payload->>'studentId')::uuid and status not in ('completed','canceled')) then raise exception '이 학생의 진행 중인 보고서가 있습니다.'; end if;
  return public.transition_withdrawal_report_v1(p_tenant,p_actor,p_report,p_action,p_payload);
 end if;
 select group_id into gid from public.withdrawal_reports where tenant_id=p_tenant and id=p_report;
 if gid is null then return public.transition_withdrawal_report_v1(p_tenant,p_actor,p_report,p_action,p_payload); end if;
 select * into g from public.withdrawal_report_groups where tenant_id=p_tenant and id=gid for update;
 select * into r from public.withdrawal_reports where tenant_id=p_tenant and id=p_report for update;
 prior:=r.status;
 -- 이 보고서의 승인 관리자(s2_0025 — 보고서마다 · 옛 보고서는 묶음 것). 빈 목록 = 관리자 승인 생략.
 mgrs:=coalesce(r.manager_ids,g.manager_ids);
 if p_action not in ('save','submit','approve','reject','cancel','apply','release') then raise exception '지원하지 않는 처리입니다.'; end if;
 if p_action not in ('apply','release') then
  select * into actor from public.users where tenant_id=p_tenant and id=p_actor and status='active';
  if actor.id is null then raise exception '작업 권한을 확인할 수 없습니다.'; end if;
  if coalesce((p_payload->>'revision')::integer,0)<>r.revision then raise exception '보고서가 변경되었습니다. 새로고침 후 다시 진행해 주세요.'; end if;
 elsif p_action='release' and p_actor is not null then
  -- release = 데스크 환불 완료 뒤 처리 — 행위자는 환불 완료를 저장한 사람(시스템이면 null).
  select * into actor from public.users where tenant_id=p_tenant and id=p_actor and status='active';
  if actor.id is null then raise exception '작업 권한을 확인할 수 없습니다.'; end if;
 end if;
 if p_action in ('save','submit') then
  if r.teacher_id<>p_actor or r.status not in ('requested','revision') or g.status<>'pending' then raise exception '작성 요청을 받은 강사만 작성할 수 있습니다.'; end if;
  if jsonb_typeof(p_payload->'body') is distinct from 'object' then raise exception '보고서 본문을 확인해 주세요.'; end if;
  foreach field in array array['detail','studentConsultation','parentConsultation','teacherOpinion','attendance','tuition','arrearsNote'] loop
   if jsonb_typeof(p_payload->'body'->field) is distinct from 'string' or char_length(p_payload->'body'->>field)>5000 then raise exception '보고서 항목을 확인해 주세요.'; end if;
  end loop;
  if coalesce(p_payload->'body'->>'reason','') not in ('graduated','relocation','illness','competitor','financial','schedule','dissatisfaction','grades','motivation','method','career','peers','advised','other') or coalesce(p_payload->'body'->>'arrears','') not in ('unknown','yes','no') then raise exception '퇴원사유와 미납 여부를 확인해 주세요.'; end if;
  if p_action='submit' and (char_length(btrim(p_payload->'body'->>'detail'))<100 or btrim(p_payload->'body'->>'studentConsultation')='' or btrim(p_payload->'body'->>'parentConsultation')='' or btrim(p_payload->'body'->>'teacherOpinion')='') then raise exception '상세사유 100자 이상과 상담 결과·담임 의견을 작성해 주세요.'; end if;
  -- 반려 사유는 **다시 제출할 때** 지운다(원장 2026-11-05 실시간 저장 — 자동 저장이 한 글자마다 'save'라, 저장에서 지우면 반려 배너가
  -- 첫 글자에 사라졌다. 고쳐 쓰는 동안 사유를 보고 쓴다).
  r.body:=p_payload->'body'; r.manager_decisions:='{}'; r.director_decisions:='{}'; r.manager_approved_at:=null; r.director_approved_at:=null;
  if p_action='submit' then r.last_comment:=null; end if;
  if p_action='submit' then
   if cardinality(mgrs)=0 then
    -- 관리자 승인 생략(작성 강사가 그 보고서 과목의 관리자 · 원장 2026-11-03) — 제출이 곧 관리자 승인이다.
    r.status:='approved'; r.manager_approved_at:=now(); recipients:=array[g.requested_by]; headline:='퇴원보고서 제출 · 관리자 승인 생략';
   else
    r.status:='manager_pending'; recipients:=mgrs; headline:='퇴원보고서 관리자 승인 요청';
   end if;
  end if;
 elsif p_action in ('approve','reject') then
  if g.status<>'pending' or not ((r.status='manager_pending' and p_actor=any(mgrs) and not r.manager_decisions ? p_actor::text and actor.system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(actor.id),false)) or (r.status='director_pending' and p_actor=any(g.director_ids) and not r.director_decisions ? p_actor::text and actor.system_role::text='master' and not coalesce(public.is_super_admin(actor.id),false))) then raise exception '지정된 승인자의 순서가 아닙니다.'; end if;
  if p_action='reject' then
   comment_text:=btrim(coalesce(p_payload->>'comment',''));
   if char_length(comment_text) not between 1 and 1000 then raise exception '반려 사유를 1~1,000자로 작성해 주세요.'; end if;
   r.status:='revision'; r.last_comment:=comment_text; r.manager_decisions:='{}'; r.director_decisions:='{}'; r.manager_approved_at:=null; r.director_approved_at:=null;
   recipients:=array[r.teacher_id,g.requested_by]||mgrs||g.director_ids; headline:='퇴원보고서 수정 요청';
  elsif r.status='manager_pending' then
   r.manager_decisions:=r.manager_decisions||jsonb_build_object(p_actor::text,now());
   if not exists(select 1 from unnest(mgrs) x where not r.manager_decisions ? x::text) then
    r.manager_approved_at:=now();
    if cardinality(g.director_ids)=0 then r.status:='approved'; recipients:=array[r.teacher_id,g.requested_by]; headline:='퇴원보고서 승인 완료';
    else r.status:='director_pending'; recipients:=g.director_ids; headline:='퇴원보고서 원장 승인 요청'; end if;
   end if;
  else
   r.director_decisions:=r.director_decisions||jsonb_build_object(p_actor::text,now());
   if not exists(select 1 from unnest(g.director_ids) x where not r.director_decisions ? x::text) then r.director_approved_at:=now(); r.status:='approved'; recipients:=array[r.teacher_id,g.requested_by]||mgrs; headline:='퇴원보고서 승인 완료'; end if;
  end if;
 elsif p_action='cancel' then
  if ((p_actor is distinct from g.requested_by) and not exists(select 1 from public.users u where u.tenant_id=p_tenant and u.id=p_actor and u.status='active' and u.system_role::text='master')) or g.status in ('completed','canceled') then raise exception '이 요청을 취소할 수 없습니다.'; end if;
  -- 취소 사유(원장 2026-11-06 · s2_0032) — 있으면 앞뒤 공백을 빼고 1~500자 · 묶음의 모든 보고서 이력 'cancel' 줄에 같은 사유가 남는다(아래 반복).
  -- 없으면(옛 앱) 종전처럼 사유 없이 취소한다 — 필수 여부는 앱이 정한다.
  if p_payload->>'comment' is not null then
   comment_text:=btrim(p_payload->>'comment');
   if char_length(comment_text) not between 1 and 500 then raise exception '취소 사유를 1~500자로 작성해 주세요.'; end if;
  end if;
  g.status:='canceled'; headline:='퇴원보고서 요청 취소';
  -- 연결된 미완료 환불 요청서 — 데스크 할 일 취소 · 데스크 담당자에게 '환불 진행 전 확인'(요청서는 남긴다).
  perform public.withdrawal_report_refunds_on_cancel(p_tenant,g.id,p_actor,g.snapshot->>'name');
 elsif p_action='apply' then
  if (p_actor is not null and not (r.direct and p_actor=g.requested_by)) or g.status<>'scheduled' or g.effective_date>today then raise exception '처리일이 된 승인 보고서만 처리할 수 있습니다.'; end if;
  -- 환불 결정(s2_0032 · 원장 2026-11-06) — 앱이 같은 요청에서 계산한 환불 가능 줄(refundCheck)로 '환불 결정 대기'를 맞춘다.
  refund_open:=public.withdrawal_report_refund_note(p_tenant,g.id,p_payload->'refundCheck',p_actor);
  -- 데스크 환불이 남았거나 · 원장이 결정하지 않은 환불 가능 줄이 있거나 · 환불 확인 값이 없으면(옛 앱 · 계산 빠뜨림) 처리일이 돼도 미룬다 —
  -- 오류 없이 그대로 돌려준다(앱 cron이 '미룸'으로 세고 다음 날 다시 · 원장 결정·환불 완료 때 release).
  if public.withdrawal_report_refund_pending(g.id) or refund_open is distinct from 0 then return r; end if;
 elsif p_action='release' then
  if public.withdrawal_report_refund_pending(g.id) or not ((g.status='pending' and not exists(select 1 from public.withdrawal_reports q where q.group_id=g.id and q.status<>'approved')) or (g.status='scheduled' and g.effective_date<=today)) then raise exception '데스크 환불이 끝난 승인 완료 보고서만 처리할 수 있습니다.'; end if;
  -- 환불 결정(s2_0032) — 결정하지 않은 환불 가능 줄이 있거나 환불 확인 값이 없으면(직접 호출 포함) 처리하지 않고 그대로 돌려준다(표시는 남는다).
  refund_open:=public.withdrawal_report_refund_note(p_tenant,g.id,p_payload->'refundCheck',p_actor);
  if refund_open is distinct from 0 then return r; end if;
 end if;
 update public.withdrawal_reports set body=r.body,status=r.status,manager_decisions=r.manager_decisions,director_decisions=r.director_decisions,
  manager_approved_at=r.manager_approved_at,director_approved_at=r.director_approved_at,last_comment=r.last_comment,revision=revision+1,updated_at=now() where id=r.id;
 all_approved:=r.status='approved' and p_action in ('approve','submit') and not exists(select 1 from public.withdrawal_reports where group_id=g.id and status<>'approved');
 -- 환불 결정(s2_0032) — 제출·승인 때 앱이 넘긴 환불 확인으로 '환불 결정 대기'를 맞춘다(원장에게 미리 알린다). 전원 승인이면 이 값으로 처리 여부를 정한다.
 if p_action in ('submit','approve') and g.status='pending' then refund_open:=public.withdrawal_report_refund_note(p_tenant,g.id,p_payload->'refundCheck',p_actor); end if;
 if all_approved and (public.withdrawal_report_refund_pending(g.id) or refund_open is distinct from 0) then
  -- 승인은 모두 끝났고 환불 결정·데스크 환불이 남았다 — 묶음은 기다린다(원장 2026-11-03 '데스크 환불 요청' · 2026-11-06 '환불 결정 대기').
  -- 원장 결정·환불 완료 때 release가 처리한다. 환불 확인 값이 없으면(옛 앱 · 계산 빠뜨림) 처리하지 않고 다음 확인(처리일 cron)을 기다린다.
  recipients:=array[r.teacher_id,g.requested_by];
  headline:=case when refund_open>0 then '퇴원보고서 환불 결정 대기' when public.withdrawal_report_refund_pending(g.id) then '퇴원보고서 데스크 환불 요청' else '퇴원보고서 승인 완료 · 처리 확인 대기' end;
 elsif all_approved or p_action in ('apply','release') then
  perform 1 from public.students where id=g.student_id and tenant_id=p_tenant for update;
  perform 1 from public.enrollments where tenant_id=p_tenant and student_id=g.student_id for update;
  perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=g.student_id and e.tenant_id=p_tenant for share of c;
  snap:=public.withdrawal_report_snapshot(p_tenant,g.student_id);
  -- 퇴원 묶음은 학생 전체, 과목 수강종료 묶음은 학생 정보 + 자기 과목 수강(s2_0014) · 표시용 칸은 대조하지 않는다(s2_0025).
  cmp_subjects:=case when g.exit_kind='withdrawal' then null else g.subjects end;
  valid:=public.withdrawal_report_compare_key(snap,cmp_subjects) is not distinct from public.withdrawal_report_compare_key(g.snapshot,cmp_subjects)
   and not exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.tenant_id=p_tenant and e.student_id=g.student_id and e.id=any(g.enrollment_ids) and (not c.is_active or c.closed_at is not null))
   and (select count(*) from public.withdrawal_reports where group_id=g.id)=cardinality(g.teacher_ids)
   and not exists(select 1 from public.withdrawal_reports q where q.group_id=g.id and (q.status not in ('approved','scheduled') or exists(select 1 from unnest(coalesce(q.manager_ids,g.manager_ids)) x where not q.manager_decisions ? x::text) or exists(select 1 from unnest(g.director_ids) x where not q.director_decisions ? x::text)))
   -- 승인 관리자는 관리자·매니저(원장급·운영자 계정 아님 · s2_0030). 바로 처리 보고서는 처리한 사람이 승인 칸이라 종전대로 둔다(원장·운영자 바로 처리 그대로).
   and not exists(select 1 from public.withdrawal_reports q, unnest(coalesce(q.manager_ids,g.manager_ids)) x where q.group_id=g.id and not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master') and (q.direct or (system_role::text<>'master' and not coalesce(public.is_super_admin(id),false)))))
   and not exists(select 1 from unnest(g.director_ids) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text='master' and not coalesce(public.is_super_admin(id),false)))
   and not exists(select 1 from unnest(g.teacher_ids) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('teacher','admin','manager','master')))
   -- 관리자 승인을 생략한 보고서는 작성 강사가 승인자 몫이다 — 아직 관리자·매니저(원장급·운영자 계정 아님)인지 본다(요청 때와 같은 조건 · s2_0030).
   and not exists(select 1 from public.withdrawal_reports q where q.group_id=g.id and cardinality(coalesce(q.manager_ids,g.manager_ids))=0 and not exists(select 1 from public.users where id=q.teacher_id and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(id),false)));
  if not coalesce(valid,false) then
   if p_action not in ('apply','release') then raise exception '요청 이후 학생·수강·승인자 정보가 변경되었습니다. 요청을 취소한 뒤 다시 작성해 주세요.'; end if;
   g.status:='blocked'; headline:='퇴원보고서 재검토 필요';
   comment_text:='승인 이후 학생·수강·승인자 정보가 변경되어 자동 처리를 멈췄습니다. 요청을 취소한 뒤 다시 작성해 주세요.';
  elsif g.effective_date>today then g.status:='scheduled'; headline:='퇴원보고서 전체 승인 완료';
  else
   targets:=g.enrollment_ids;
   if targets is null then raise exception '종료할 반을 확인하지 못했습니다. 요청 내용을 다시 확인해 주세요.'; end if;
   if coalesce(cardinality(targets),0)=0 and not (r.direct and g.exit_kind='withdrawal') then raise exception '종료할 수강을 찾을 수 없습니다.'; end if;
   update public.enrollments e set end_date=greatest(e.start_date,g.effective_date),is_transferred=false,
    withdrawal_reason=(select q.body->>'reason' from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id order by coalesce(e.id=any(q.enrollment_ids),false) desc,q.group_leader desc,q.id limit 1),
    withdrawal_detail=(select nullif(q.body->>'reasonDetail','') from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id order by coalesce(e.id=any(q.enrollment_ids),false) desc,q.group_leader desc,q.id limit 1),
    withdrawal_memo=(select nullif(btrim(q.body->>'detail'),'') from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id order by coalesce(e.id=any(q.enrollment_ids),false) desc,q.group_leader desc,q.id limit 1)
    where e.tenant_id=p_tenant and e.student_id=g.student_id and e.id=any(targets);
   get diagnostics affected=row_count;
   if affected<>cardinality(targets) then raise exception '수강 정보가 변경되었습니다. 다시 확인해 주세요.'; end if;
   if g.exit_kind<>'withdrawal' and not exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id and c.tenant_id=p_tenant where e.tenant_id=p_tenant and e.student_id=g.student_id and not e.id=any(coalesce(targets,'{}'::uuid[])) and c.is_active and c.closed_at is null and (e.end_date is null or e.end_date>greatest(g.effective_date,today))) then g.exit_kind:='withdrawal'; update public.withdrawal_report_groups set exit_kind='withdrawal' where id=g.id; update public.withdrawal_reports set exit_kind='withdrawal' where group_id=g.id; end if; if g.exit_kind='withdrawal' then
    update public.students set status='withdrawn',withdrawn_at=g.effective_date,
     withdrawal_metadata=(select jsonb_build_object('reason',q.body->>'reason','detail',nullif(q.body->>'reasonDetail',''),'memo',q.body->>'detail','reportId',q.id,'reportGroupId',g.id,'reportIds',(select jsonb_agg(id order by id) from public.withdrawal_reports where group_id=g.id),'consultation',jsonb_build_object('adminCalledParent',false,'teacherCalledParent',false,'talkedWithStudent',false)) from public.withdrawal_reports q where q.group_id=g.id and q.group_leader)
     where tenant_id=p_tenant and id=g.student_id;
   end if;
   g.status:='completed'; g.applied_at:=now(); headline:='퇴원·수강종료 처리 완료';
  end if;
 end if;
 if g.status in ('scheduled','completed','blocked','canceled') then
  -- Each child keeps a complete audit trail and its own notification link.
  for child in select * from public.withdrawal_reports where group_id=g.id order by id loop
   -- 취소 사유는 이력에만 남긴다(last_comment = 반려 사유·재검토 안내 칸 — 상세의 안내 상자로 읽히지 않게 · s2_0032).
   update public.withdrawal_reports set status=g.status,applied_at=g.applied_at,last_comment=coalesce(case when p_action='cancel' then null else comment_text end,last_comment),revision=revision+1,updated_at=now() where id=child.id;
   insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,from_status,to_status,comment) values(p_tenant,child.id,p_actor,p_action,child.status,g.status,comment_text);
   -- 받는 사람 = 요청자 · 그 보고서 작성 강사 · **그 보고서의** 승인 관리자(묶음 합집합이면 다른 과목 관리자에게 무관한 링크가 간다) · 옛 원장.
   for recipient in select distinct x from unnest(array[g.requested_by,child.teacher_id]||coalesce(child.manager_ids,g.manager_ids)||g.director_ids) x where x<>coalesce(p_actor,'00000000-0000-0000-0000-000000000000') loop
    insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,recipient,'approval_decided',headline,g.snapshot->>'name'||' · '||g.effective_date::text,'/withdrawal-reports/'||child.id::text,p_actor);
   end loop;
  end loop;
  -- 끝난 묶음(처리 예약 밖 · 처리 완료·재검토·취소)엔 기다릴 환불 결정이 없다 — 표시를 내린다(s2_0032).
  update public.withdrawal_report_groups set status=g.status,applied_at=g.applied_at,refund_hold=refund_hold and g.status in ('pending','scheduled') where id=g.id;
 else
  -- 자동 저장(원장 2026-11-05 "실시간으로 입력되고 저장되게") — 마지막 이력이 같은 사람의 10분 안 '임시 저장'이면 새 줄을 넣지 않는다
  -- (이력 표는 덧붙임 전용 — 고치지 않고 건너뛴다. 본문·revision은 위에서 이미 저장했다).
  if not (p_action='save' and exists(select 1 from (select e.action,e.actor_id,e.created_at from public.withdrawal_report_events e where e.tenant_id=p_tenant and e.report_id=r.id order by e.created_at desc,e.id desc limit 1) last
          where last.action='save' and last.actor_id is not distinct from p_actor and last.created_at>now()-interval '10 minutes')) then
   insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,from_status,to_status,body,comment) values(p_tenant,r.id,p_actor,p_action,prior,r.status,case when p_action in ('submit','approve','reject') then r.body end,comment_text);
  end if;
  for recipient in select distinct x from unnest(recipients) x where x<>coalesce(p_actor,'00000000-0000-0000-0000-000000000000') loop
   insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,recipient,'approval_requested',headline,g.snapshot->>'name'||' · '||g.effective_date::text,'/withdrawal-reports/'||r.id::text,p_actor);
  end loop;
 end if;
 select * into r from public.withdrawal_reports where id=r.id;
 return r;
end $function$;

-- ── 5) 옛 단건 처리 함수(_v1) — 작성·제출·반려·취소만 받는다(운영 정의에서 그 줄만 치환 · 정확히 한 번) ──────────────────────
-- 옛 단건(묶음 없음)은 환불 결정을 지나지 않는다 — 'request'(처리 함수 'request'도 여기로 온다)·'approve'·'apply'를 받지 않아 처리할 길을 닫는다.
-- 진행 중 옛 단건 0건(2026-11-06 읽기 전용 조회) · 앱은 옛 단건을 만들지 않는다.
do $$
declare
  definition text;
  pairs constant text[] := array[
    $o$if p_action not in ('request','save','submit','approve','reject','cancel','apply') then raise exception '지원하지 않는 처리입니다.'; end if;$o$,
    $n$if p_action not in ('save','submit','reject','cancel') then raise exception '옛 단건 퇴원보고서는 작성·제출·반려·취소만 할 수 있습니다. 요청을 취소한 뒤 작성 요청 창에서 다시 요청해 주세요.'; end if;$n$];
  hits int;
begin
  select pg_get_functiondef('public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  for i in 1 .. array_length(pairs, 1) / 2 loop
    hits := (length(definition) - length(replace(definition, pairs[2*i-1], ''))) / length(pairs[2*i-1]);
    if hits <> 1 then raise exception 's2_0032: _v1의 바꿀 줄 %번이 하나가 아닙니다(%건)', i, hits; end if;
    definition := replace(definition, pairs[2*i-1], pairs[2*i]);
  end loop;
  execute definition;
end $$;

-- ── 6) 할 일 동기화 — 원장 '환불 결정' 차례(퇴원보고서 할 일 · 차례 이름 refund:<원장 id>) ───────────────────────────────
-- 열기: 묶음이 환불 결정 대기이고 이 보고서가 결정할 줄을 보이는 보고서면 원장급(운영자 계정 제외)마다. 닫기: 대기가 풀리면 처리됨('refund_settled'),
-- 취소·다른 보고서로 옮김이면 취소. 운영 정의에서 세 줄만 치환한다(정확히 한 번 — 선언 · 닫기 반복 앞 · 닫기 반복 안).
do $$
declare
  definition text;
  pairs constant text[] := array[
    $o$  v_today date := (now() at time zone 'Asia/Seoul')::date;$o$,
    $n$  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_refund_hold boolean;
  v_refund_settled boolean;$n$,
    $o$  for x in$o$,
    $n$  select coalesce(g.refund_hold, false) and g.status in ('pending', 'scheduled') and g.refund_hold_report = r.id and r.status not in ('canceled', 'completed', 'blocked'),
         not coalesce(g.refund_hold, false) and g.status <> 'canceled' and r.status <> 'canceled'
    into v_refund_hold, v_refund_settled
    from public.withdrawal_report_groups g where g.id = r.group_id and g.tenant_id = r.tenant_id;
  if coalesce(v_refund_hold, false) then
    for v_user in select u.id from public.users u
        where u.tenant_id = r.tenant_id and u.status = 'active' and u.system_role::text = 'master' and not coalesce(public.is_super_admin(u.id), false) order by u.id loop
      v_cycle := 'refund:' || v_user::text;
      v_want := v_want || v_cycle;
      perform staff_tasks_private.open_task(r.tenant_id, 'withdrawal_step', r.id, v_cycle,
        '퇴원보고서 환불 결정', v_student || ' · 원장 환불 결정 차례',
        '/withdrawal-reports/' || r.id::text, ((v_today + 1)::timestamp at time zone 'Asia/Seoul'), array[v_user], null);
    end loop;
  end if;
  for x in$n$,
    $o$    v_user := nullif(split_part(x.cycle, ':', 2), '')::uuid;$o$,
    $n$    v_user := nullif(split_part(x.cycle, ':', 2), '')::uuid;
    if v_stage = 'refund' then
      v_n := v_n + staff_tasks_private.close_task(r.tenant_id, 'withdrawal_step', r.id, x.cycle,
        case when coalesce(v_refund_settled, false) then 'done' else 'cancelled' end,
        case when coalesce(v_refund_settled, false) then 'refund_settled' when r.status = 'canceled' then 'withdrawal_canceled' else 'turn_changed' end, null);
      continue;
    end if;$n$];
  hits int;
begin
  select pg_get_functiondef('staff_tasks_private.withdrawal_sync_report(uuid)'::regprocedure) into definition;
  for i in 1 .. array_length(pairs, 1) / 2 loop
    hits := (length(definition) - length(replace(definition, pairs[2*i-1], ''))) / length(pairs[2*i-1]);
    if hits <> 1 then raise exception 's2_0032: 할 일 동기화의 바꿀 줄 %번이 하나가 아닙니다(%건)', i, hits; end if;
    definition := replace(definition, pairs[2*i-1], pairs[2*i]);
  end loop;
  execute definition;
end $$;

-- ── 7) 데스크 환불 연결 — 원장급만 · 데스크 = 학원 설정 '데스크 담당자'로 지정한 사람만(비면·null이면 거절) · 줄마다 결정을 남긴다 ─────────
-- 인자 둘을 더한다(기본값 null): p_none = 같은 화면에서 고르지 않은 줄(환불하지 않음) · p_check = 앱이 같은 요청에서 계산한 환불 확인(표시 맞춤).
-- 옛 6인자 호출(옛 앱)도 이 함수로 온다 — 결정은 고른 줄('환불')만 남고 표시는 그대로. 데스크 지정 검사는 옛 앱에도 걸린다.
drop function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean);
create function public.attach_withdrawal_report_refund(p_tenant uuid, p_actor uuid, p_report uuid, p_document uuid, p_desk uuid, p_expect_gate boolean,
  p_none jsonb default null, p_check jsonb default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  gid uuid; g public.withdrawal_report_groups; r public.withdrawal_reports; doc_description text; desk_name text; gates boolean := false; link uuid;
  desks jsonb; picked text[] := '{}'; skipped text[] := '{}'; open_n integer;
begin
  -- 환불 승인은 원장급만(원장 2026-10-29 · 앱 canRequestRefund와 같은 축 = 원장 역할).
  if not exists(select 1 from public.users where tenant_id = p_tenant and id = p_actor and status = 'active' and system_role::text = 'master') then raise exception '환불 승인은 원장만 할 수 있습니다.'; end if;
  -- 데스크 담당자 = 학원 설정 '데스크 담당자'(specialAccess.withdrawalDeskIds)로 지정한 사람만 — 비었으면 막는다(원장 등으로 대신하지 않는다 · 원장 2026-11-06).
  select ts.data #> '{permissions,specialAccess,withdrawalDeskIds}' into desks from public.tenant_settings ts where ts.tenant_id = p_tenant;
  if jsonb_typeof(desks) is distinct from 'array' or jsonb_array_length(desks) = 0 then raise exception '학원 설정에서 데스크 담당자를 먼저 지정해 주세요.'; end if;
  if p_desk is null or not (desks ? p_desk::text) then raise exception '학원 설정에 지정된 데스크 담당자만 고를 수 있습니다. 데스크 담당자를 다시 골라 주세요.'; end if;
  -- 요청서(restricted)를 열 수 있는 재직 직원(DB 요청서 RLS의 사무 역할과 같다 — 앱 REFUND_DOCUMENT_ROLES).
  select display_name into desk_name from public.users where tenant_id = p_tenant and id = p_desk and status = 'active' and system_role::text in ('master','admin','manager','accountant');
  if desk_name is null then raise exception '데스크 담당자를 다시 골라 주세요.'; end if;
  -- 처리 함수와 같은 잠금 순서(묶음 → 보고서).
  select group_id into gid from public.withdrawal_reports where tenant_id = p_tenant and id = p_report;
  if gid is not null then select * into g from public.withdrawal_report_groups where tenant_id = p_tenant and id = gid for update; end if;
  select * into r from public.withdrawal_reports where tenant_id = p_tenant and id = p_report for update;
  if r.id is null or r.status = 'canceled' or g.status = 'canceled' then raise exception '환불을 연결할 수 있는 퇴원보고서가 아닙니다.'; end if;
  select description into doc_description from public.academy_documents where tenant_id = p_tenant and id = p_document and form_type = 'refund_request';
  if doc_description is null or position(('report:' || p_report::text || ' ') in doc_description) = 0 then raise exception '이 보고서에서 만든 환불 요청서가 아닙니다.'; end if;
  -- 묶음이 아직 처리 전(진행 중 · 처리 예약)이면 이 환불이 끝나야 처리한다. 끝난 보고서에 붙인 환불은 기다리게 하지 않는다.
  gates := gid is not null and g.status in ('pending', 'scheduled');
  if p_expect_gate is not null and gates is distinct from p_expect_gate then
    raise exception '퇴원보고서가 그 사이 ''%'' 상태가 되었습니다. 새로고침 후 다시 확인해 주세요.',
      case coalesce(g.status, r.status) when 'completed' then '처리 완료' when 'blocked' then '재검토 필요' when 'scheduled' then '처리 예약' when 'pending' then '진행 중' else coalesce(g.status, r.status) end;
  end if;
  -- 고른 줄 = 요청서 표식의 줄(lines:…) · 고르지 않은 줄 = 앱이 같은 요청에서 계산한 이 보고서의 환불 가능 줄 안에서만.
  select coalesce(array_agg(distinct k), '{}') into picked
    from unnest(string_to_array(substring(doc_description from 'lines:([^[:space:]·]+)'), ',')) k
   where k ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|[0-9a-z]{1,8}(-[0-9]{1,2})?)$';
  -- 옛 단건(묶음 없음)은 결정이 처리를 막지 않는다 — '환불하지 않음'을 남기지 않는다.
  if p_none is not null and gid is not null then
    if jsonb_typeof(p_none) is distinct from 'array' or jsonb_array_length(p_none) > 200 then raise exception '환불하지 않을 건을 확인해 주세요.'; end if;
    select coalesce(array_agg(distinct v), '{}') into skipped from jsonb_array_elements_text(p_none) v;
    if skipped && picked or exists(select 1 from unnest(skipped) k
         where k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|[0-9a-z]{1,8}(-[0-9]{1,2})?)$'
            or not exists(select 1 from jsonb_array_elements(coalesce(p_check->'refundable', '[]'::jsonb)) e where e->>'key' = k and lower(e->>'report') = r.id::text))
      then raise exception '퇴원월 뒤 청구가 바뀌었습니다. 새로고침 후 다시 골라 주세요.'; end if;
  end if;
  insert into public.withdrawal_report_refunds(tenant_id, report_id, group_id, document_id, desk_id, created_by)
    values (p_tenant, r.id, gid, p_document, p_desk, p_actor) on conflict (document_id) do nothing returning id into link;
  if link is null then raise exception '이미 연결된 환불 요청서입니다.'; end if;
  if gid is not null then
    insert into public.withdrawal_report_refund_decisions(tenant_id, group_id, report_id, line_key, decision, document_id, decided_by)
      select p_tenant, gid, r.id, k, 'refund', p_document, p_actor from unnest(picked) k
      on conflict (group_id, line_key) do update set decision = 'refund', document_id = excluded.document_id, report_id = excluded.report_id, decided_by = excluded.decided_by, decided_at = now();
    insert into public.withdrawal_report_refund_decisions(tenant_id, group_id, report_id, line_key, decision, document_id, decided_by)
      select p_tenant, gid, r.id, k, 'none', null, p_actor from unnest(skipped) k
      on conflict (group_id, line_key) do update set decision = 'none', document_id = null, report_id = excluded.report_id, decided_by = excluded.decided_by, decided_at = now();
  end if;
  insert into public.withdrawal_report_events(tenant_id, report_id, actor_id, action, from_status, to_status, comment)
    values (p_tenant, r.id, p_actor, 'refund', r.status, r.status,
      '데스크 환불 요청 · ' || desk_name || case when gates then ' — 환불 처리(환불완료일자) 뒤 퇴원·수강종료' else '' end
        || case when cardinality(skipped) > 0 then ' · 고르지 않은 ' || cardinality(skipped) || '건은 환불하지 않음' else '' end);
  if gid is not null then open_n := public.withdrawal_report_refund_note(p_tenant, gid, p_check, p_actor, true); end if;
  return jsonb_build_object('attached', true, 'groupId', gid, 'groupStatus', g.status, 'gates', gates, 'undecided', open_n);
end $$;
revoke all on function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean, jsonb, jsonb) to service_role;

-- ── 8) 원장 '환불 없음' — 처리 전 묶음의 고른 줄(앱이 같은 요청에서 계산한 이 보고서의 환불 가능 줄 안)을 '환불하지 않음'으로 ───────────────
-- 행위자 = 원장급(원장 역할 · 앱 canRequestRefund와 같은 축)만. 처리는 하지 않는다 — 앱이 이어서 release(새 확인 값)로 처리한다(ready).
create or replace function public.decide_withdrawal_report_refund(p_tenant uuid, p_actor uuid, p_report uuid, p_none jsonb, p_check jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  gid uuid; g public.withdrawal_report_groups; r public.withdrawal_reports; keys text[]; n integer; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not exists(select 1 from public.users where tenant_id = p_tenant and id = p_actor and status = 'active' and system_role::text = 'master') then raise exception '환불 결정은 원장만 할 수 있습니다.'; end if;
  select group_id into gid from public.withdrawal_reports where tenant_id = p_tenant and id = p_report;
  if gid is null then raise exception '환불을 결정할 수 있는 퇴원보고서가 아닙니다.'; end if;
  select * into g from public.withdrawal_report_groups where tenant_id = p_tenant and id = gid for update;
  select * into r from public.withdrawal_reports where tenant_id = p_tenant and id = p_report for update;
  if g.status not in ('pending', 'scheduled') or r.status in ('canceled', 'completed', 'blocked') then raise exception '처리 전 퇴원보고서에서만 환불 없음을 정할 수 있습니다.'; end if;
  if jsonb_typeof(p_none) is distinct from 'array' or jsonb_array_length(p_none) not between 1 and 200 then raise exception '환불하지 않을 건을 확인해 주세요.'; end if;
  select coalesce(array_agg(distinct v), '{}') into keys from jsonb_array_elements_text(p_none) v;
  if p_check is null or exists(select 1 from unnest(keys) k
       where k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|[0-9a-z]{1,8}(-[0-9]{1,2})?)$'
          or not exists(select 1 from jsonb_array_elements(coalesce(p_check->'refundable', '[]'::jsonb)) e where e->>'key' = k and lower(e->>'report') = r.id::text))
    then raise exception '퇴원월 뒤 청구가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.'; end if;
  insert into public.withdrawal_report_refund_decisions(tenant_id, group_id, report_id, line_key, decision, document_id, decided_by)
    select p_tenant, g.id, r.id, k, 'none', null, p_actor from unnest(keys) k
    on conflict (group_id, line_key) do update set decision = 'none', document_id = null, report_id = excluded.report_id, decided_by = excluded.decided_by, decided_at = now();
  insert into public.withdrawal_report_events(tenant_id, report_id, actor_id, action, from_status, to_status, comment)
    values (p_tenant, r.id, p_actor, 'refund_decision', r.status, r.status, '환불 없음 ' || cardinality(keys) || '건 — 퇴원월 뒤 청구를 환불하지 않습니다.');
  n := public.withdrawal_report_refund_note(p_tenant, g.id, p_check, p_actor, true);
  return jsonb_build_object('groupId', g.id, 'undecided', n,
    'ready', n = 0 and not public.withdrawal_report_refund_pending(g.id)
      and ((g.status = 'pending' and not exists(select 1 from public.withdrawal_reports q where q.group_id = g.id and q.status <> 'approved'))
           or (g.status = 'scheduled' and g.effective_date <= today)));
end $$;
revoke all on function public.decide_withdrawal_report_refund(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.decide_withdrawal_report_refund(uuid, uuid, uuid, jsonb, jsonb) to service_role;

-- ── 9) 환불 확인 뒤 처리 — 묶음마다 앱이 같은 요청에서 계산한 확인 값(p_checks: 묶음 id → 확인)이 있는 묶음만 ─────────────────────────
-- 확인 값이 없으면 아무것도 처리하지 않는다(옛 앱의 3인자 호출도 기본값 null로 여기 와서 빈 결과). 확인 값이 있는 처리 전 묶음은 표시를 먼저 맞추고
-- (이어진 요청서를 지우면 다시 '환불 결정 대기'), 결정 안 된 줄 0 · 데스크 환불 끝 · 승인 끝(또는 처리일이 된 예약)일 때만 release로 처리한다.
-- 결과 = 처리한 묶음(뒤 상태)과 실패한 묶음(error)만. 묶음을 skip locked로 잡는다(release끼리·cron과 겹치면 늦은 쪽은 건너뛴다) · 묶음마다 따로.
drop function public.release_withdrawal_report_refunds(uuid, uuid, uuid);
create function public.release_withdrawal_report_refunds(p_tenant uuid, p_document uuid, p_actor uuid, p_checks jsonb default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  x record; res public.withdrawal_reports; out jsonb := '[]'::jsonb; locked uuid; n integer; after_status text; actor uuid;
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_checks is null or jsonb_typeof(p_checks) is distinct from 'object' then return out; end if;
  actor := case when p_tenant is null then null else p_actor end;
  for x in
    select g.id gid, g.tenant_id tid,
      (select q.id from public.withdrawal_reports q where q.group_id = g.id order by q.group_leader desc, q.id limit 1) rid
      from public.withdrawal_report_groups g
     where (p_tenant is null or g.tenant_id = p_tenant)
       and p_checks ? g.id::text
       and (p_document is null or exists(select 1 from public.withdrawal_report_refunds f where f.group_id = g.id and f.document_id = p_document))
       and g.status in ('pending', 'scheduled')
     order by g.created_at
     limit 200
  loop
    locked := null;
    select g.id into locked from public.withdrawal_report_groups g where g.id = x.gid for update skip locked;
    continue when locked is null;
    begin
      n := public.withdrawal_report_refund_note(x.tid, x.gid, p_checks->(x.gid::text), actor);
      continue when n is distinct from 0 or public.withdrawal_report_refund_pending(x.gid)
        or not exists(select 1 from public.withdrawal_report_groups g where g.id = x.gid
          and ((g.status = 'pending' and not exists(select 1 from public.withdrawal_reports q where q.group_id = g.id and q.status <> 'approved'))
               or (g.status = 'scheduled' and g.effective_date <= today)));
      res := public.transition_withdrawal_report(x.tid, actor, x.rid, 'release', jsonb_build_object('refundCheck', p_checks->(x.gid::text)));
      select g.status into after_status from public.withdrawal_report_groups g where g.id = x.gid;
      out := out || jsonb_build_array(jsonb_build_object('reportId', res.id, 'groupId', x.gid, 'tenantId', x.tid, 'status', res.status, 'groupStatus', after_status));
    exception when others then
      -- 한 묶음의 실패가 다른 묶음을 막지 않는다(그 묶음만 되돌린다) — 앱이 오류 보고로 넘긴다.
      out := out || jsonb_build_array(jsonb_build_object('reportId', x.rid, 'groupId', x.gid, 'tenantId', x.tid, 'error', sqlerrm));
    end;
  end loop;
  return out;
end $$;
revoke all on function public.release_withdrawal_report_refunds(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.release_withdrawal_report_refunds(uuid, uuid, uuid, jsonb) to service_role;

-- ── 10) 이어진 요청서 지키기 — 환불완료일자는 그 요청서의 데스크 담당자와 원장급만 · 번호·지점·서식·표식은 아무도 못 바꾼다 ─────────
-- 앱 서버(관리 키 — auth.uid() 없음)는 완료일자 판정을 먼저 본다(saveRefundRequest). 세션 쓰기가 막히면 42501(강사뷰는 앱 판정 뒤 관리 키로 다시 쓴다).
-- 번호·지점·서식·표식(description)과 '같은 번호로 다시 넣기'는 관리 키로도 막는다 — 지운 뒤 같은 번호로 완료된 요청서를 넣거나, 서식을 바꿔 이 검사를
-- 피한 뒤 되돌리거나, 표식을 고쳐 다른 줄을 잡는 길(검토 2026-11-06). 앱은 이 칸들을 고치지 않는다(삭제는 그대로 된다 — 지우면 그 줄은 다시 결정 안 됨).
-- SECURITY DEFINER = 연결 표(withdrawal_report_refunds)는 직원 세션이 읽을 수 없다. 트리거 함수라 RPC로 부를 수 없다.
create or replace function public.withdrawal_report_refund_complete_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_desk uuid; v_linked boolean := false;
begin
  if tg_op = 'INSERT' then
    if exists(select 1 from public.withdrawal_report_refunds f where f.document_id = NEW.id) then
      raise exception using errcode = '42501', message = '퇴원보고서에 이어진 환불 요청서 번호로 새 문서를 만들 수 없습니다.';
    end if;
    return NEW;
  end if;
  select true, f.desk_id into v_linked, v_desk from public.withdrawal_report_refunds f where f.document_id = OLD.id or f.document_id = NEW.id limit 1;
  if not coalesce(v_linked, false) then return NEW; end if;
  if NEW.id is distinct from OLD.id or NEW.tenant_id is distinct from OLD.tenant_id or NEW.form_type is distinct from OLD.form_type or NEW.description is distinct from OLD.description then
    raise exception using errcode = '42501', message = '퇴원보고서에 이어진 환불 요청서의 번호·서식·표식은 바꿀 수 없습니다.';
  end if;
  if coalesce(btrim(OLD.form_data #>> '{result,completedDate}'), '') = coalesce(btrim(NEW.form_data #>> '{result,completedDate}'), '') or v_uid is null then return NEW; end if;
  if v_uid = v_desk or exists(select 1 from public.users u where u.tenant_id = NEW.tenant_id and u.id = v_uid and u.status = 'active' and u.system_role::text = 'master') then return NEW; end if;
  raise exception using errcode = '42501', message = '퇴원보고서에서 이어진 환불 요청서의 환불완료일자는 그 요청서의 데스크 담당자와 원장만 넣거나 지울 수 있습니다.';
end $$;
revoke all on function public.withdrawal_report_refund_complete_guard() from public, anon, authenticated;
drop trigger if exists withdrawal_report_refund_complete_guard on public.academy_documents;
create trigger withdrawal_report_refund_complete_guard before insert or update on public.academy_documents
  for each row execute function public.withdrawal_report_refund_complete_guard();

notify pgrst, 'reload schema';
commit;
