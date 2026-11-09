-- s2_0036 — 퇴원보고서: 원장 환불 결정 전에는 처리하지 않는다 · 데스크 담당자는 학원 설정 지정자만 · 이어진 요청서의 완료 입력은 담당 데스크와 원장만 (2026-11-06)
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
--   3) withdrawal_report_refund_note(묶음, 확인 값, 행위자, 결정 여부) — 결정 안 된 줄 수(확인 값 없으면 · 낡았으면(asOf 뒤 청구가 바뀜) · 처리 범위가 다르면 null) · 표시 · 보고서 이력
--      'refund_hold_clear') · 원장급 알림 '퇴원보고서 환불 결정 요청'(운영자 계정 · 행위자 제외) · 할 일 동기화.
--   4) transition_withdrawal_report — s2_0030 본문에서 일곱 자리만(선언 · apply · release · 취소 사유 · 자식 이력 · 전원 승인 · 끝난 묶음 표시 내림 · 시험이 글자로 대조).
--      취소 사유(원장 2026-11-06 *"요청 취소시에 '사유' 입력할 수 있고 마우스 올리면 사유 확인가능하게"*): 'cancel'에 p_payload->>'comment'가 있으면
--      앞뒤 공백을 빼고 1~500자를 검사해 묶음의 모든 보고서 이력 'cancel' 줄 comment에 남긴다. last_comment(반려 사유·재검토 안내 칸)는 건드리지 않는다.
--      없으면 종전처럼 사유 없이 취소(필수 여부는 앱이 정한다). 취소 알림 본문에는 붙이지 않는다 — 반려 사유도 알림 본문에 넣지 않는 규칙과 같다
--      (알림은 '이름 · 마지막 수업일'만 · 슬랙으로도 나간다). 데스크 '환불 진행 전 확인' 알림도 그대로.
--   5) transition_withdrawal_report_v1 — 받는 처리 한 줄 치환.
--   6) staff_tasks_private.withdrawal_sync_report — 원장 '환불 결정' 차례(refund:<원장 id>) 열기·닫기(세 줄 치환).
--   7) attach_withdrawal_report_refund — 6인자를 지우고 8인자(뒤 둘 기본값 null)로: 행위자 원장급 · 데스크 = 학원 설정 지정자(비거나 null이면 거절 · 행위자 본인·운영자 계정 아님 ·
--      재직 사무 역할) · 고른 줄 '환불' · 고르지 않은 줄 '환불하지 않음'(이 묶음 확인 값 안 · 대표 아닌 보고서 화면도) · 다른 요청의 요청서가 이미 담은 줄(환불을 마쳤거나
--      취소되지 않은 요청)은 거절 · 결정 때 낸 돈(paid_net) · 보고서 이력에 함께 · 표시 맞춤.
--   8) decide_withdrawal_report_refund — 원장 '환불 없음'(원장급만 · 처리 전 묶음 · 확인 값 안의 이 묶음 줄 — 대표 아닌 보고서 화면도) · 이력 'refund_decision' · 결정 때 낸 돈(paid_net).
--   9) release_withdrawal_report_refunds — 3인자를 지우고 4인자(p_checks 기본값 null): 확인 값 없으면 빈 결과.
--  10) academy_documents BEFORE INSERT OR UPDATE 트리거 — 이어진 요청서의 환불완료일자 변경은 세션 행위자가 그 요청서 데스크 담당·원장일 때만(42501) ·
--      이어진 요청서의 번호·지점·서식·표식 변경과 같은 번호로 다시 넣기는 누구도 못 한다(트리거 우회·표식 위조 막기). 담당 데스크는 재직 중일 때만.
--      🔴 원장 결정(C.3): 같은 청구 줄에 새 퇴원 요청의 요청서가 있으면, 취소된 요청에만 이어진 옛 미완료 요청서의 완료일자는 누구도(관리 키 포함) 넣지 못한다.
--      경합 = 학생 단위 거래 잠금(pg_advisory_xact_lock) 하나로 이 트리거와 연결 함수(attach)를 줄 세운다 — attach는 그 잠금 아래 반대쪽(환불을 마쳤거나 취소되지 않은
--      요청의 요청서가 담은 줄을 다시 고름)을 거절한다. 잠금 순서: attach = 묶음 → 보고서 → 학생 잠금 · 트리거 = 요청서 행 → 학생 잠금(attach는 요청서 행을 잠그지 않는다).
--  11) 사후 확인(함정 #155) — 바꾼 함수·새 함수마다 service_role 실행권이 있고 anon·authenticated는 없는지 · 트리거가 있는지. 아니면 거래 취소.
-- 확인 값(리뷰 2026-11-06 수리판) = refundable[{key, report, paid}] · claimed[{key, doc}](이 묶음 요청서가 잡은 줄 — 처리 순간 그 요청서가 없거나 그 줄을 안 담으면 결정 안 됨)
--   · asOf(학생의 퇴원월 뒤 청구 max(updated_at) — DB 값이 더 새것이면 보류 · 다음 cron이 다시 계산) · scope(처리 범위 — 처리 함수가 과목 수강종료를 전체 퇴원으로 바꿀 조건이면
--   withdrawal · 다르면 보류). 결정 뒤 같은 줄의 낸 돈이 늘면 다시 결정 안 됨. 관문은 '퇴원월 뒤 청구'만 본다(퇴원월 일할 환불은 관문 밖 · 원장 결정 2026-11-06).
-- 원장급 = 원장 역할(master · 운영자 계정 포함 — 기존 환불 승인·취소 규칙 그대로). 알림·할 일 받는 사람만 운영자 계정을 뺀다(기존 원장 승인자 규칙).
-- 순서: 🔴 앱보다 먼저(#95) · 🔴 s2_0030 적용 뒤에만(처리 함수·_v1 지문이 s2_0030 적용 뒤 값이어야 한다 — 다르면 멈춘다).
--   운영은 2026-11-06 읽기 전용 확인 때 s2_0030 적용 뒤였다(처리 함수·_v1 지문이 아래 검사 값과 같음 · attach·release·할 일 동기화는 s2_0025 그대로).
-- 번호: 가지에서는 s2_0031로 만들었으나 main의 학원 비서(s2_0031_academy_assistant · 운영 적용 2026-11-06 17:37)와 겹쳐 s2_0032로, 다시 main의 연동 PC 실행권
--   (s2_0032_sync_agent_helper_grants · 운영 적용 2026-11-06 19:16)과 겹쳐 s2_0033으로, 다시 main의 금액 이월 연쇄(s2_0033_money_carry_chain · 운영 적용 2026-11-09)·
--   학원 비서 마무리(s2_0034_assistant_parallel_finish · 운영 적용 2026-11-09)·원생 충성도(s2_0035_student_loyalty_factors · 운영 적용 2026-11-09)와 겹쳐
--   s2_0036으로 옮겼다(2026-11-09 병합 두 번). 이 파일들은 서로 다른 객체만 건드린다
--   (이 파일의 검사는 위 함수 지문만 본다 · 금액 이월은 invoices를 읽기만 하고 · 학원 비서 마무리는 assistant_messages만 · 원생 충성도는 새 표 student_contribution_factor_records만 바꾼다).
-- 옛 앱이 도는 동안(적용 ~ 새 앱 배포) — 옛 앱은 확인 값을 넘기지 않는다. 처리는 하지 않는 쪽으로 닫힌다:
--   · 제출·승인: 승인은 그대로 기록된다. 전원 승인이 되어도 처리하지 않고 기다린다(알림 '퇴원보고서 승인 완료 · 처리 확인 대기').
--   · 처리일 cron(apply): 미룬다(오류 없음 — 옛 앱은 '미룸'으로 센다).
--   · 수납 저장·삭제(release 3인자): 4인자 기본값으로 와서 빈 결과(옛 앱은 아무것도 기록하지 않는다).
--   · 바로 처리: 보고서는 만들어지고 처리일이 지났어도 처리 예약으로 남는다.
--   · 환불 승인(attach 6인자): 원장급만 · 데스크가 학원 설정 지정 명단에 있어야 한다 — 명단은 처음에 비어 있으니 옛 앱의 환불 승인은 거절되고
--     옛 앱이 방금 만든 요청서를 지운다(감사로그 '요청서 삭제'). 고른 줄은 '환불'로 남지 않는다(거절이라 아무것도 남지 않는다).
--   · 완료 입력(수납 저장): 세션 쓰기는 트리거가 막는다(이어진 요청서만 · 운영 0건).
--   · 요청 취소: 옛 앱은 사유를 보내지 않는다 — 종전처럼 사유 없이 취소된다(이력 comment 비움 · 목록의 취소 정보는 '사유 기록 없음').
--   · 학원 설정 '데스크 담당자': 🔴 새 앱 배포가 끝난 뒤에 지정한다 — 옛 앱은 '역할·권한'을 저장할 때 모르는 칸(withdrawalDeskIds)을 버린다(zod).
-- 새 앱 + 옛 DB(배포 순서 위반): 새 앱은 제출·승인·바로 처리·release·cron 전에 DB 준비(refund_hold 칸)를 보고, 없으면 'DB 적용 전'으로 거절한다(처리하지 않는 쪽).
--   새 앱 배포 뒤 처리일 cron(00:05)이 기다리던 묶음을 다시 계산해 처리하거나 원장 결정을 요청한다. 배포 직후 /api/cron/apply-due-withdrawals를
--   한 번 부르면 바로 정리된다.
-- 요청서 삭제 경합(리뷰 #3 — 앞판의 'ms 경합 · 매우 드묾' 설명은 틀렸다: 앱이 확인 값을 계산한 뒤 요청서가 지워지면 낡은 확인 값으로 처리될 수 있었다)
--   → 확인 값의 claimed를 처리 순간 DB가 다시 본다(요청서가 없거나 · 이 묶음에 이어지지 않았거나 · 그 줄을 안 담으면 결정 안 됨) · 청구가 바뀌었으면 asOf로 보류.
-- 진행 중(2026-11-06 읽기 전용 조회): 묶음 pending 2건(둘 다 처리일 지남 · 아직 승인 전 — 걸리는 처리 없음) · 처리 예약 0 · 보고서 환불 연결 0 ·
--   보고서에서 만든 환불 요청서 0 · 옛 단건 진행 0 · 학원 설정 데스크 명단 0곳.
-- 확인(로컬 PGlite 0.3.16 · PG 17.5 — 운영 표 구조와 운영 함수 정의를 올림 · 운영 지문과 같음을 먼저 확인): 운영 정의 → s2_0030 → 이 파일 →
--   경로별 41개 사례(전원 승인 · release 직접 호출 · release 함수(옛 3인자 포함) · 처리일 apply · 바로 처리 · 옛 단건 · 원장 '환불 없음'(원장만) ·
--   환불 승인(원장만 · 지정 데스크만 · null 거절 · 고르지 않은 줄 환불하지 않음) · 완료 입력(담당 데스크·원장만 · 그 밖 세션 42501) · 요청서 삭제 → 다시 대기 ·
--   결정 뒤 새 줄 → 다시 대기 · 재계산으로 줄이 사라지면 해제 · 취소 → 할 일 취소 · 잘못된 확인 값 → 거절 · 트리거 우회(같은 번호로 다시 넣기 · 서식·표식 바꾸기) 거절 · 요청 취소 사유(공백뿐·501자 거절 · 두 보고서 묶음 이력에 같은 사유 · 사유 없는 옛 호출 통과) ·
--   묶음 경계(팀장 결정 2026-11-06 — 새 묶음은 자기 묶음의 결정만 센다: 취소된 묶음의 요청서가 담은 줄 → 결정 안 됨 → 전원 승인·release여도 대기 · 새 묶음에서 다시 환불 승인 →
--   데스크 완료 뒤 처리 · 다른 묶음에서 환불을 마친 줄도 대기 → '환불 없음' 뒤 처리)) ·
--   리뷰 수리(요청서 삭제 경합 claimed · 낡은 확인 값 asOf · 처리 범위 scope · 결정 뒤 낸 돈 증가 · 대표 아닌 보고서의 환불 없음·일부 승인 · 취소 사유 줄바꿈·탭 ·
--   데스크 본인·운영자 계정·퇴사) · C.3 ①~⑤(새 요청서가 있으면 옛 요청서 완료 거절 — 세션·관리 키 · 새 요청서 지우면 됨 · 옛 것이 먼저 완료면 새 승인 거절 · 줄 겹침)) ·
--   역할 시험(운영 실행권을 옮겨 service_role로 경로 전체 · authenticated·anon·eywa_sync_agent·student_status_lifecycle은 못 부름) · 되돌리기 왕복 · CRLF/LF 줄바꿈 모두 통과.
-- 적용 확인(읽기만):
--   select to_regprocedure('public.decide_withdrawal_report_refund(uuid,uuid,uuid,jsonb,jsonb,jsonb)') is not null
--      and to_regprocedure('public.decide_withdrawal_report_refund(uuid,uuid,uuid,jsonb,jsonb)') is null
--      and to_regprocedure('public.release_withdrawal_report_refunds(uuid,uuid,uuid)') is null;  -- 기대: true(리뷰 r3 R3-2 — decide는 r3부터 6인자)
--   적용 뒤 지문(공백 뺀 md5 · 위 PGlite 값):
--     transition_withdrawal_report 99c4175fd9f02dab3091086f456890b1 · transition_withdrawal_report_v1 c8d87498a853195d7c86de12b21ae6d8 · attach_withdrawal_report_refund(9인자) f87f992c7ce096a2e5c1dd44c278ce39 ·
--     release_withdrawal_report_refunds(4인자) 2516d0340b850c14faa4f91e9ea673ca · staff_tasks_private.withdrawal_sync_report 577ba3f3c9f2c429b051b8656a660cb0 · withdrawal_report_refund_note dce627cbb631b2160ebd8d74b7a46384 ·
--     decide_withdrawal_report_refund 7da06d12497b76d8d11fd846d5d31e43 · withdrawal_report_refund_complete_guard 690c049376af96d280680c168c20199c · withdrawal_report_refund_pending 8950ddbc8a25c4229996235e12a2593e ·
--     staff_tasks_private.tg_refund_task 25ac92f780f3741fd98f82a8d6eeee5f · withdrawal_report_refunds_on_cancel bc3ed5062ec278a6f015635c7d098e4d
-- 적용할 때: 기본 search_path 세션(운영 기본값 = 사용자 이름 스키마 · public · extensions)에서 아래 begin…commit 그대로 실행한다
--   (빈 search_path면 지문이 달라져 멈춘다 — 안전한 쪽 실패). 중간에 실패하면 ROLLBACK 하거나 연결을 닫는다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0036-withdrawal-refund-decision-gate.sql(앱을 먼저 되돌린 뒤 · 진행 중 '환불 결정 대기'나 승인이 끝났는데 처리 안 된 묶음이 있으면 멈춘다).
-- 🔴 한 번만 적용한다(다시 돌리면 지문 검사로 멈춘다).
-- ── 리뷰 수리 r2(2026-11-09 · DB 리뷰 r1 D-1~D-13 · 화면 리뷰 r1 B1·I5·I6) ─────────────────────────────────────────────
--   · 줄 키 겹침 규칙 한 벌(withdrawal_refund_keys_overlap · 앱 refund-keys.ts lineIdsOverlap과 같은 사례표): all ↔ 모두 · 미배분(unalloc) ↔ 실제 줄 모두 ·
--     미배분끼리(청구 전체 · 과목 몫 unalloc:<과목> · 나머지 unalloc:~<과목>) · 실제 줄끼리 -N 뗀 식별값. C.3 트리거와 attach 반대쪽이 쓴다(D-1 ⅱ).
--   · 결정 표 supersedes uuid[] — 다시 환불 승인으로 대체한 옛 요청서 id(앱이 본 다른 묶음 요청서 + 겹침으로 찾은 것). C.3가 문서 id로도 막는다(수납명이 바뀌어도 · D-1 ⅰ).
--   · 결정 표 paid_seen — 원장이 마지막으로 본 낸 돈. '환불' 결정 줄도 낸 돈이 늘면 다시 결정 대기(D-4). '환불'(그 요청서) 줄의 '환불 없음'은 상한(paid_net)을 그대로 두고 paid_seen만.
--   · note claimed 갈래: 그 요청서가 이 묶음에 이어져 있고 같은 청구를 담았으면 · 결정 행이 있으면 본 낸 돈 이하 · 없으면 표식에 키가 정확히 있어야 결정됨(D-2 — 막다른 대기 없음:
--     원장이 '환불 없음'으로 정하면 풀린다 · decide·attach의 '환불하지 않음'이 claimed 줄도 받는다).
--   · asOf = 퇴원월 뒤 청구 **내용 지문**(withdrawal_refund_later_fingerprint — 시각 비교는 늦게 커밋된 긴 거래를 놓친다 · D-12).
--   · attach 9인자(p_supersedes) · 완료일자가 든 요청서 거절(D-6) · 같은 묶음 안 겹침은 막지 않는다(다른 묶음만 — 앱과 같은 규칙).
--   · 완료 판정 공백 = 앱 String.trim()과 같은 글자 집합(withdrawal_refund_blank · refund_pending·트리거·attach — D-11).
--   · 트리거: DELETE 갈래(맨 앞 · return OLD — 이어지지 않은 문서는 그대로 지운다) · 완료된 이어진 요청서는 누구도 못 지움(지점 삭제 연쇄는 예외) · 미완료는 세션이면 담당 데스크(재직)·원장 ·
--     수정(form_data·title)은 세션이면 담당 데스크(재직)·원장(분류·고정·직원 연쇄는 막지 않음) · 완료일자 비우기 = 원장만(D-13) · 상한(총 환불금액 숫자 ≤ '환불' 결정 paid_net 합 —
--     관리 키 포함 · 모르면 금액 칸 변경만 거절) · 오류코드 23514(42501이면 강사뷰 쓰기가 관리 키로 다시 써 우회한다).
--   · 결정 표 service_role delete·truncate·references·trigger 회수(Supabase 표 기본 권한 · D-5) · 관문 준비 표식 함수 withdrawal_refund_gate_ready(되돌리기가 지운다 · D-7).
--   · 🔴 s2_0036 전에 이어진 요청서(결정 행 없음)는 C.3·상한 밖이다 — 운영 0건(2026-11-09 읽기 전용 · 연결 0). 적용 직전 `select count(*) from withdrawal_report_refunds`가 0인지 다시 본다.
-- ── 리뷰 수리 r3(2026-11-09 · DB 재리뷰 r2 R-1~R-9 · 화면 재리뷰 r2 R2-I2 · 원장 결정 '늘어난 몫은 따로 환불') ──────────────────
--   · 같은 묶음이어도 살아 있는 다른 요청서가 **같은 키**를 담았으면 attach가 거절(R-1 — r2에서 같은 묶음을 통째로 빼 이중 환불이 됐다 · 형제·과목 몫은 그대로 둔다).
--   · 총 환불금액 = `숫자(쉼표 세 자리)` + 선택 `원`만(앞뒤 빈칸 허용 · 앱 parseWonStrict와 같은 규칙) — '300만원'·'1.5백만원'·'삼백만 원'은 못 읽음 → 금액 칸 변경 거절(R-2).
--     결제내역이 바뀌면 그 안의 금액 표기도 같은 규칙으로 읽고(못 읽으면 거절) · 이번에 새로 들어온 금액은 상한 이하여야 한다.
--   · attach의 대체 옛 요청서는 고른 줄과 같은 청구를 담은 것만(R-4) · note claimed 갈래의 결정 행은 그 요청서가 남아 있을 때만 결정으로 친다(R-5).
--   · 연결 표(withdrawal_report_refunds) service_role update·delete·truncate·references·trigger 회수(R-6 — 연결 행이 사라지면 잠금이 다 풀린다 · 앱·워커는 읽기·attach 넣기만).
--   · 완료일자는 빈칸 또는 YYYY-MM-DD만(R-9) · 할 일 닫기(staff_tasks_private.tg_refund_task)·취소 알림(withdrawal_report_refunds_on_cancel)의 빈칸 판정도 withdrawal_refund_blank로.
--   · 원장 결정(2026-11-09) — 환불을 마친 줄에 낸 돈이 늘면 '환불하지 않음 — 늘어난 몫은 수납에서 따로 처리'(decide p_separate): 결정 행에 따로 처리할 금액·시각·결정자를 남긴다.
--     완료일자가 처음 들어갈 때 그 요청서의 '환불' 결정 금액을 결정 행에 '환불 완료 기록'(refunded_total · refunded_docs)으로 남긴다(완료일자를 비워도 남는다).
--     같은 줄을 다시 환불 승인하면 상한(paid_net) = 낸 돈 − 따로 처리한 금액 − 환불 완료 기록(이미 돌려준 돈을 다시 돌려주지 않게 · R2-I2).
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
    'staff_tasks_private.withdrawal_sync_report(uuid)', 'a8a0fb1aa5b897ff1eac199a33b03a5f',
    'public.withdrawal_report_refund_pending(uuid)', 'e0eab20d959cd68364cd4a7c349385cd',
    -- r3 — 빈칸 판정을 바꾸는 할 일 닫기(s2_0011)·취소 알림(s2_0025) · 운영 지문 2026-11-09 읽기 전용 확인 = 같음.
    'staff_tasks_private.tg_refund_task()', '7ba5b00c225d849f5368182b8ffaee06',
    'public.withdrawal_report_refunds_on_cancel(uuid,uuid,uuid,text)', '9e3981d9e2cb7e319c308adf193efbbe');
  fn text;
  got text;
begin
  for fn in select jsonb_object_keys(want) loop
    select md5(regexp_replace(pg_get_functiondef(fn::regprocedure), '[[:space:]]+', '', 'g')) into got;
    if got is distinct from want->>fn then
      raise exception 's2_0036: % 의 운영 정의가 기준(s2_0030 적용 뒤 · 2026-11-06)과 다릅니다(%). s2_0030을 먼저 적용했는지 보고, 바뀐 내용을 이 파일에 옮긴 뒤 지문을 갱신하세요.', fn, got;
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
comment on column public.withdrawal_report_groups.refund_hold is '환불 결정 대기(s2_0036) — 원장이 결정하지 않은 환불 가능 청구 줄이 있어 퇴원·수강종료를 처리하지 않고 기다린다.';

-- ── 1b) 앱과 같은 규칙 한 벌(리뷰 r2) — 앱 파일 이름을 함께 적는다(바꿀 땐 같이) ───────────────────────────────────────
-- 완료일자 '빈칸' = 앱 String.prototype.trim()이 지우는 글자만 있음(공백·탭·줄바꿈·NBSP·전각 공백 등 · 앱 refund.ts·refund-steps.ts·수납 저장 — D-11).
create or replace function public.withdrawal_refund_blank(v text) returns boolean language sql immutable set search_path = public as $$
  select coalesce(v, '') ~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$'
$$;
-- 금액 글 → 원(리뷰 r3 R-2 — 앱 linked-request.ts parseWonStrict와 같은 규칙): 앞뒤 빈칸(withdrawal_refund_blank와 같은 글자)을 떼고
--   `숫자(쉼표 세 자리 · 최대 15자리)` + 선택 공백 + 선택 `원`이면 그 값 · 비면 0 · 그 밖(단위 글자 '만'·'천' · 소수점 · 한글 숫자)은 null(못 읽음).
create or replace function public.withdrawal_refund_won(v text) returns numeric language sql immutable set search_path = public as $$
  select case
    when public.withdrawal_refund_blank(v) then 0
    when regexp_replace(v, '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g')
         ~ '^([0-9]{1,3}(,[0-9]{3}){1,4}|[0-9]{1,15}) *원?$'
      then regexp_replace(v, '[^0-9]', '', 'g')::numeric
    else null end
$$;
-- 두 줄 키가 같은 돈일 수 있나(겹침 · 앱 refund-keys.ts lineIdsOverlap · keysOverlap — 같은 사례표를 vitest·PGlite가 돌린다).
create or replace function public.withdrawal_refund_keys_overlap(a text, b text) returns boolean language plpgsql immutable set search_path = public as $$
declare
  la text := split_part(a, '#', 2); lb text := split_part(b, '#', 2); ua boolean; ub boolean; ea boolean; eb boolean; sa text[]; sb text[];
begin
  if a is null or b is null or lower(split_part(a, '#', 1)) <> lower(split_part(b, '#', 1)) then return false; end if;
  if la = lb or la in ('all', '*') or lb in ('all', '*') then return true; end if;
  ua := la ~ '^unalloc(:|$)'; ub := lb ~ '^unalloc(:|$)';
  if ua <> ub then return true; end if;                                   -- 미배분 ↔ 실제 줄
  if not ua then return regexp_replace(la, '-[0-9]+$', '') = regexp_replace(lb, '-[0-9]+$', ''); end if;  -- 형제(번호 밀림)
  if la = 'unalloc' or lb = 'unalloc' then return true; end if;           -- 청구 전체 몫
  ea := la like 'unalloc:~%'; eb := lb like 'unalloc:~%';
  sa := string_to_array(regexp_replace(la, '^unalloc:~?', ''), '.'); sb := string_to_array(regexp_replace(lb, '^unalloc:~?', ''), '.');
  if ea and eb then return true; end if;                                  -- 나머지끼리
  if not ea and not eb then return sa && sb; end if;                      -- 과목 몫끼리: 과목이 하나라도 같으면
  if ea then return exists(select 1 from unnest(sb) x where not x = any(sa)); end if;  -- 나머지(~sa) ↔ 과목 몫(sb): sa 밖 과목이 있으면
  return exists(select 1 from unnest(sa) x where not x = any(sb));
end $$;
-- 학생의 퇴원월 뒤 청구 내용 지문(void 포함 · 앱이 확인 값을 계산하기 전에 이 함수로 받고, note가 처리 순간 다시 낸다 · D-12).
create or replace function public.withdrawal_refund_later_fingerprint(p_tenant uuid, p_student uuid, p_month text) returns text language sql stable set search_path = public as $$
  select md5(coalesce(string_agg(concat_ws('|', i.id, i.period, i.category, i.status, i.amount_total, i.amount_discount, i.amount_paid, i.line_items::text), ',' order by i.id), ''))
    from public.invoices i where i.tenant_id = p_tenant and i.student_id = p_student and i.period > p_month
$$;
-- 관문 준비 표식(앱 refundGateReady — 되돌리기가 지운다 · 칸은 되돌려도 남아 '새 앱 + 되돌린 DB'에서 참이 됐다 · D-7).
create or replace function public.withdrawal_refund_gate_ready() returns boolean language sql immutable set search_path = public as $$ select true $$;
revoke all on function public.withdrawal_refund_blank(text) from public, anon, authenticated;
revoke all on function public.withdrawal_refund_won(text) from public, anon, authenticated;
revoke all on function public.withdrawal_refund_keys_overlap(text, text) from public, anon, authenticated;
revoke all on function public.withdrawal_refund_later_fingerprint(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.withdrawal_refund_gate_ready() from public, anon, authenticated;
grant execute on function public.withdrawal_refund_blank(text), public.withdrawal_refund_won(text), public.withdrawal_refund_keys_overlap(text, text),
  public.withdrawal_refund_later_fingerprint(uuid, uuid, text), public.withdrawal_refund_gate_ready() to service_role;

-- ── 2) 원장 환불 결정 — 묶음의 청구 줄 키마다 '환불'(그 요청서) 또는 '환불하지 않음' ─────────────────────────────
create table if not exists public.withdrawal_report_refund_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  group_id uuid not null references public.withdrawal_report_groups(id) on delete cascade,
  report_id uuid not null references public.withdrawal_reports(id) on delete cascade,
  line_key text not null check (line_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|unalloc(:~?[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}){0,9})?|[0-9a-z]{1,8}(-[0-9]{1,2})?)$'),
  decision text not null check (decision in ('refund', 'none')),
  -- '환불'이면 그 줄을 잡은 환불 요청서(외래키 없음 — s2_0025처럼 요청서 삭제를 막지 않는다 · 지워지면 그 줄은 다시 '결정 안 됨').
  document_id uuid,
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  -- 결정 때 그 줄의 낸 돈(확인 값의 paid) — '환불'이면 그 요청서 상한(I6)에 드는 돈. 옛 6인자 연결은 비어 있다.
  paid_net numeric,
  -- 원장이 마지막으로 본 낸 돈(리뷰 r2 D-4) — 지금 낸 돈이 더 크면 다시 결정 안 됨('환불' 결정도). 비면 paid_net.
  paid_seen numeric,
  -- 다시 환불 승인으로 대체한 옛 요청서(취소된 요청의 미완료 · 리뷰 r2 D-1 ⅰ) — C.3가 문서 id로 그 옛 요청서의 완료일자를 막는다.
  supersedes uuid[] not null default '{}',
  unique (group_id, line_key),
  check ((decision = 'refund') = (document_id is not null))
);
comment on table public.withdrawal_report_refund_decisions is '퇴원보고서 원장 환불 결정(s2_0036) — 줄 키(<청구 id>#<줄 식별값>)마다. 결정 뒤 새로 생긴 줄 · 요청서가 지워진 줄 · 본 뒤 낸 돈이 는 줄은 다시 결정 안 됨.';
alter table public.withdrawal_report_refund_decisions add column if not exists paid_net numeric;
alter table public.withdrawal_report_refund_decisions add column if not exists paid_seen numeric;
alter table public.withdrawal_report_refund_decisions add column if not exists supersedes uuid[] not null default '{}';
-- r3(원장 결정 2026-11-09) — 환불을 마친 줄의 늘어난 몫을 수납에서 따로 환불하기로 한 금액(누계)·시각·결정자(decide p_separate).
alter table public.withdrawal_report_refund_decisions add column if not exists separate_amount numeric;
alter table public.withdrawal_report_refund_decisions add column if not exists separate_at timestamptz;
alter table public.withdrawal_report_refund_decisions add column if not exists separate_by uuid;
-- r3 — 이어진 요청서에 완료일자가 처음 들어갈 때 그 요청서 '환불' 결정 금액(paid_net)의 누계와 그 요청서들(완료일자를 비워도 남는다 — 다시 승인할 때 상한에서 뺀다).
alter table public.withdrawal_report_refund_decisions add column if not exists refunded_total numeric;
alter table public.withdrawal_report_refund_decisions add column if not exists refunded_docs uuid[] not null default '{}';
alter table public.withdrawal_report_refund_decisions enable row level security;
-- 🔴 Supabase는 public 표에 anon·authenticated·service_role 모두 전 권한을 기본으로 준다(리뷰 r2 D-5 — 같은 방식의 s2_0025 연결 표가 운영에서 service_role DELETE·TRUNCATE).
--    결정은 지우지 않는다(앱은 select·insert·update만 · 외래키 연쇄 삭제는 표 주인 권한으로 돈다) → service_role도 select·insert·update만 남긴다.
revoke all on public.withdrawal_report_refund_decisions from public, anon, authenticated, service_role;
grant select, insert, update on public.withdrawal_report_refund_decisions to service_role;
-- r3 R-6 — 연결 표(s2_0025)도 Supabase 기본 권한으로 service_role이 고치고·지우고·비울 수 있었다. 연결 행이 사라지거나 바뀌면 그 요청서는 '이어지지 않은 문서'가 되어
--   삭제·수정 잠금·C.3·데스크 대기가 모두 풀린다. 앱·워커·스크립트는 이 표를 읽고 attach 함수로 넣기만 한다(2026-11-09 grep · 외래키 연쇄는 표 주인 권한) → 넣기·읽기만 남긴다.
revoke update, delete, truncate, references, trigger on public.withdrawal_report_refunds from service_role;
revoke all on public.withdrawal_report_refunds from public, anon, authenticated;  -- 운영은 이미 없음(2026-11-09 읽기 전용) — 같은 상태를 못박는다.

-- ── 3) 환불 결정 대기 판정·표시 ──────────────────────────────────────────────────────────────────────────
-- p_check = 앱이 같은 요청에서 계산한 환불 확인(리뷰 수리판 · r2):
--   refundable[{key, report, paid}] = 지금 환불할 수 있는 줄(앱 loadLaterInvoices·lineRefundable — 낸 돈이 있는 퇴원월 뒤 청구 줄 · 미배분 납부(과목 몫) · 부분 환불의 남은 돈 포함)
--   claimed[{key, doc, paid, report?}] = 이 묶음 요청서가 잡아 확인 값에서 뺀 줄 · 그 요청서 · 지금 낸 돈 · 그 줄을 보이는 보고서
--   asOf = 그 학생의 퇴원월 뒤 청구 내용 지문(withdrawal_refund_later_fingerprint) · scope = 처리 범위(withdrawal | subject_end)
-- 결정 안 됨 = refundable 줄 중 '환불하지 않음'도, 아직 남은 요청서의 '환불'도 없는 줄 · 본 낸 돈(paid_seen)보다 지금 낸 돈이 큰 줄
--   + claimed 줄 중 ① 그 요청서가 없거나 · 이 묶음에 이어지지 않았거나 · 같은 청구를 담지 않음(삭제 경합 #3) ② 결정 행이 있고 본 낸 돈보다 지금이 큼(D-4)
--     ③ 결정 행이 없고 그 요청서 표식에 그 키가 정확히 없음(앱이 낡은 표식·형제로 넓혀 담은 줄 — 원장이 한 번 정한다 · D-2).
-- 반환 = 결정 안 된 줄 수 · null = 모름(확인 값 없음 · 낡음(지문이 다름) · 처리 범위가 다름) — 부르는 쪽은 처리하지 않는다(실패하는 쪽으로 닫힘).
-- 처리 전 묶음(진행 중·처리 예약)만 표시를 바꾼다. 새로 기다리게 되면: 결정할 줄을 보이는 보고서에 이력 '환불 결정 대기' · 원장급(운영자 계정 제외)에게
-- '퇴원보고서 환불 결정 요청' 알림 · 할 일(원장 환불 결정). 풀리면: 할 일을 닫는다(처리됨) · 결정이 아닌 재계산으로 풀렸으면 이력 '환불 결정 대기 해제'.
create or replace function public.withdrawal_report_refund_note(p_tenant uuid, p_group uuid, p_check jsonb, p_actor uuid, p_decided boolean default false)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  g public.withdrawal_report_groups; undecided text[]; hold_report uuid; n integer; was boolean; was_report uuid; rid uuid; recipient uuid; report_status text;
  scope_now text; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_check is null or jsonb_typeof(p_check) is distinct from 'object' then return null; end if;
  select * into g from public.withdrawal_report_groups where tenant_id = p_tenant and id = p_group;
  if g.id is null then raise exception '퇴원보고서 묶음을 찾을 수 없습니다.'; end if;
  if jsonb_typeof(p_check->'refundable') is distinct from 'array' or jsonb_array_length(p_check->'refundable') > 500
     or jsonb_typeof(p_check->'claimed') is distinct from 'array' or jsonb_array_length(p_check->'claimed') > 500
     or coalesce(p_check->>'scope', '') not in ('withdrawal', 'subject_end')
     or (jsonb_typeof(p_check->'asOf') is distinct from 'string' and jsonb_typeof(p_check->'asOf') is distinct from 'null')
     or exists(select 1 from jsonb_array_elements(p_check->'refundable') e
       where jsonb_typeof(e) is distinct from 'object'
          or coalesce(e->>'key', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|unalloc(:~?[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}){0,9})?|[0-9a-z]{1,8}(-[0-9]{1,2})?)$'
          or jsonb_typeof(e->'paid') is distinct from 'number' or (e->>'paid')::numeric < 0
          or not exists(select 1 from public.withdrawal_reports q where q.tenant_id = p_tenant and q.group_id = g.id and q.id::text = lower(coalesce(e->>'report', ''))))
     or exists(select 1 from jsonb_array_elements(p_check->'claimed') e
       where jsonb_typeof(e) is distinct from 'object' or coalesce(e->>'key', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|unalloc(:~?[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}){0,9})?|[0-9a-z]{1,8}(-[0-9]{1,2})?)$'
          or coalesce(e->>'doc', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or (e ? 'paid' and (jsonb_typeof(e->'paid') is distinct from 'number' or (e->>'paid')::numeric < 0)))
  then raise exception '환불 확인 값이 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.'; end if;
  with lines as (
    select e->>'key' k, (e->>'paid')::numeric paid, (select q.id from public.withdrawal_reports q where q.group_id = g.id and q.id::text = lower(e->>'report')) rid, ord
      from jsonb_array_elements(p_check->'refundable') with ordinality x(e, ord)
  ), open_lines as (
    select l.k, l.rid, l.ord from lines l
     where not exists(select 1 from public.withdrawal_report_refund_decisions d
       where d.tenant_id = p_tenant and d.group_id = g.id and d.line_key = l.k
         and (d.decision = 'none' or exists(select 1 from public.academy_documents doc where doc.tenant_id = p_tenant and doc.id = d.document_id and doc.form_type = 'refund_request'))
         and (coalesce(d.paid_seen, d.paid_net) is null or l.paid <= coalesce(d.paid_seen, d.paid_net)))
    union all
    -- 이 묶음 요청서가 잡아 뺀 줄(리뷰 #3 · r2 D-2·D-4 — 위 머리말 ①②③).
    select e->>'key', (select q.id from public.withdrawal_reports q where q.group_id = g.id and q.id::text = lower(coalesce(e->>'report', ''))), 1000000 + ord
      from jsonb_array_elements(p_check->'claimed') with ordinality x(e, ord)
     where not exists(select 1 from public.academy_documents a
             join public.withdrawal_report_refunds f on f.tenant_id = a.tenant_id and f.document_id = a.id and f.group_id = g.id
            where a.tenant_id = p_tenant and a.id::text = lower(e->>'doc') and a.form_type = 'refund_request'
              and exists(select 1 from unnest(string_to_array(substring(a.description from 'lines:([^[:space:]·]+)'), ',')) t
                          where lower(split_part(t, '#', 1)) = lower(split_part(e->>'key', '#', 1))))
        or exists(select 1 from public.withdrawal_report_refund_decisions d
            where d.tenant_id = p_tenant and d.group_id = g.id and d.line_key = e->>'key'
              and (d.decision = 'none' or exists(select 1 from public.academy_documents doc where doc.tenant_id = p_tenant and doc.id = d.document_id and doc.form_type = 'refund_request'))
              and coalesce(d.paid_seen, d.paid_net) is not null and jsonb_typeof(e->'paid') = 'number' and (e->>'paid')::numeric > coalesce(d.paid_seen, d.paid_net))
        or (not exists(select 1 from public.withdrawal_report_refund_decisions d where d.tenant_id = p_tenant and d.group_id = g.id and d.line_key = e->>'key'
                         and (d.decision = 'none' or exists(select 1 from public.academy_documents doc where doc.tenant_id = p_tenant and doc.id = d.document_id and doc.form_type = 'refund_request')))
            and not exists(select 1 from public.academy_documents a
                  join public.withdrawal_report_refunds f on f.tenant_id = a.tenant_id and f.document_id = a.id and f.group_id = g.id
                 where a.tenant_id = p_tenant and a.id::text = lower(e->>'doc') and a.form_type = 'refund_request'
                   and (e->>'key') = any(string_to_array(substring(a.description from 'lines:([^[:space:]·]+)'), ','))))
  )
  select coalesce((select array_agg(distinct o.k order by o.k) from open_lines o), '{}'),
         coalesce((select o.rid from open_lines o join public.withdrawal_reports q on q.id = o.rid order by q.group_leader desc, o.ord limit 1),
                  (select q.id from public.withdrawal_reports q where q.group_id = g.id order by q.group_leader desc, q.id limit 1))
    into undecided, hold_report;
  n := cardinality(undecided);
  was := g.refund_hold; was_report := g.refund_hold_report;
  if g.status not in ('pending', 'scheduled') then
    if was then update public.withdrawal_report_groups set refund_hold = false where id = g.id; end if;
    return n;
  end if;
  -- 낡은 확인 값(#3 · r2 D-12) — 확인 값을 계산하기 전에 받은 청구 내용 지문과 지금 지문이 다르면(동기화·수납 저장) 모른다. 표시도 그대로 두고 다음 확인이 다시 계산한다.
  --   시각(max(updated_at))은 거래 시작 시각이라, 앱이 읽은 뒤에 커밋된 긴 거래의 변경을 놓쳤다 — 내용 지문은 커밋된 값 자체를 비교한다.
  if p_check->>'asOf' is distinct from public.withdrawal_refund_later_fingerprint(p_tenant, g.student_id, to_char(g.effective_date, 'YYYY-MM')) then return null; end if;
  -- 처리 범위(#13) — 과목 수강종료인데 남는 수강이 없으면 처리 함수가 전체 퇴원으로 바꾼다(아래 처리 갈래와 같은 판정). 확인 값의 범위가 다르면 모른다.
  scope_now := case when g.exit_kind = 'withdrawal' or not exists(select 1 from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = p_tenant
      where e.tenant_id = p_tenant and e.student_id = g.student_id and not e.id = any(coalesce(g.enrollment_ids, '{}'::uuid[]))
        and c.is_active and c.closed_at is null and (e.end_date is null or e.end_date > greatest(g.effective_date, today)))
    then 'withdrawal' else 'subject_end' end;
  if p_check->>'scope' is distinct from scope_now then return null; end if;
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

-- '환불하지 않음' 한 줄 기록(attach의 고르지 않은 줄 · decide 공용 · 리뷰 r2 D-2·D-4) — p_doc = 그 줄을 담은 이 묶음 요청서(claimed · 이 묶음에 이어진 것만 · 아니면 없음으로 본다).
--   담은 요청서가 없으면 '환불하지 않음'(paid_net = paid_seen = 지금 낸 돈).
--   담은 요청서가 있으면 그 요청서가 담은 것으로 보고 더 환불하지 않음 — 기존 '환불 없음'은 그대로 · 그 요청서의 '환불'은 상한(paid_net)을 그대로 두고 본 낸 돈(paid_seen)만 올린다 ·
--   행이 없거나 다른(지워진) 요청서 행이면 그 요청서의 '환불'(paid_net 0 — 상한에 더하지 않음 · 그 요청서를 지우면 다시 결정 안 됨).
create or replace function public.withdrawal_refund_record_none(p_tenant uuid, p_group uuid, p_report uuid, p_key text, p_paid numeric, p_doc uuid, p_actor uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_doc uuid := p_doc;
begin
  if v_doc is not null and not exists(select 1 from public.withdrawal_report_refunds f where f.tenant_id = p_tenant and f.document_id = v_doc and f.group_id = p_group) then v_doc := null; end if;
  if v_doc is null then
    insert into public.withdrawal_report_refund_decisions(tenant_id, group_id, report_id, line_key, decision, document_id, decided_by, paid_net, paid_seen)
      values (p_tenant, p_group, p_report, p_key, 'none', null, p_actor, p_paid, p_paid)
      on conflict (group_id, line_key) do update set decision = 'none', document_id = null, supersedes = '{}', report_id = excluded.report_id,
        decided_by = excluded.decided_by, decided_at = now(), paid_net = excluded.paid_net, paid_seen = excluded.paid_seen;
  else
    insert into public.withdrawal_report_refund_decisions as t (tenant_id, group_id, report_id, line_key, decision, document_id, decided_by, paid_net, paid_seen)
      values (p_tenant, p_group, p_report, p_key, 'refund', v_doc, p_actor, 0, p_paid)
      on conflict (group_id, line_key) do update set
        document_id = case when t.decision = 'none' then null when t.document_id = v_doc then t.document_id else v_doc end,
        paid_net = case when t.decision = 'none' or t.document_id = v_doc then t.paid_net else 0 end,
        paid_seen = excluded.paid_seen, report_id = excluded.report_id, decided_by = excluded.decided_by, decided_at = now();
  end if;
end $$;
revoke all on function public.withdrawal_refund_record_none(uuid, uuid, uuid, text, numeric, uuid, uuid) from public, anon, authenticated;
grant execute on function public.withdrawal_refund_record_none(uuid, uuid, uuid, text, numeric, uuid, uuid) to service_role;

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
 -- 결정하지 않은 환불 가능 줄 수(s2_0036 · withdrawal_report_refund_note) — null = 앱이 환불 확인 값을 넘기지 않음(모름 → 처리하지 않는다).
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
  -- 취소 사유(원장 2026-11-06 · s2_0036) — 있으면 앞뒤 공백을 빼고 1~500자(공백·줄바꿈·탭만이면 거절 · 리뷰 #11) · 묶음의 모든 보고서 이력 'cancel' 줄에 같은 사유가 남는다(아래 반복).
  -- 없으면(옛 앱) 종전처럼 사유 없이 취소한다 — 필수 여부는 앱이 정한다.
  if p_payload->>'comment' is not null then
   comment_text:=btrim(p_payload->>'comment');
   if char_length(comment_text) not between 1 and 500 or comment_text !~ '[^[:space:]]' then raise exception '취소 사유를 1~500자로 작성해 주세요.'; end if;
  end if;
  g.status:='canceled'; headline:='퇴원보고서 요청 취소';
  -- 연결된 미완료 환불 요청서 — 데스크 할 일 취소 · 데스크 담당자에게 '환불 진행 전 확인'(요청서는 남긴다).
  perform public.withdrawal_report_refunds_on_cancel(p_tenant,g.id,p_actor,g.snapshot->>'name');
 elsif p_action='apply' then
  if (p_actor is not null and not (r.direct and p_actor=g.requested_by)) or g.status<>'scheduled' or g.effective_date>today then raise exception '처리일이 된 승인 보고서만 처리할 수 있습니다.'; end if;
  -- 환불 결정(s2_0036 · 원장 2026-11-06) — 앱이 같은 요청에서 계산한 환불 가능 줄(refundCheck)로 '환불 결정 대기'를 맞춘다.
  refund_open:=public.withdrawal_report_refund_note(p_tenant,g.id,p_payload->'refundCheck',p_actor);
  -- 데스크 환불이 남았거나 · 원장이 결정하지 않은 환불 가능 줄이 있거나 · 환불 확인 값이 없으면(옛 앱 · 계산 빠뜨림) 처리일이 돼도 미룬다 —
  -- 오류 없이 그대로 돌려준다(앱 cron이 '미룸'으로 세고 다음 날 다시 · 원장 결정·환불 완료 때 release).
  if public.withdrawal_report_refund_pending(g.id) or refund_open is distinct from 0 then return r; end if;
 elsif p_action='release' then
  if public.withdrawal_report_refund_pending(g.id) or not ((g.status='pending' and not exists(select 1 from public.withdrawal_reports q where q.group_id=g.id and q.status<>'approved')) or (g.status='scheduled' and g.effective_date<=today)) then raise exception '데스크 환불이 끝난 승인 완료 보고서만 처리할 수 있습니다.'; end if;
  -- 환불 결정(s2_0036) — 결정하지 않은 환불 가능 줄이 있거나 환불 확인 값이 없으면(직접 호출 포함) 처리하지 않고 그대로 돌려준다(표시는 남는다).
  refund_open:=public.withdrawal_report_refund_note(p_tenant,g.id,p_payload->'refundCheck',p_actor);
  if refund_open is distinct from 0 then return r; end if;
 end if;
 update public.withdrawal_reports set body=r.body,status=r.status,manager_decisions=r.manager_decisions,director_decisions=r.director_decisions,
  manager_approved_at=r.manager_approved_at,director_approved_at=r.director_approved_at,last_comment=r.last_comment,revision=revision+1,updated_at=now() where id=r.id;
 all_approved:=r.status='approved' and p_action in ('approve','submit') and not exists(select 1 from public.withdrawal_reports where group_id=g.id and status<>'approved');
 -- 환불 결정(s2_0036) — 제출·승인 때 앱이 넘긴 환불 확인으로 '환불 결정 대기'를 맞춘다(원장에게 미리 알린다). 전원 승인이면 이 값으로 처리 여부를 정한다.
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
   -- 취소 사유는 이력에만 남긴다(last_comment = 반려 사유·재검토 안내 칸 — 상세의 안내 상자로 읽히지 않게 · s2_0036).
   update public.withdrawal_reports set status=g.status,applied_at=g.applied_at,last_comment=coalesce(case when p_action='cancel' then null else comment_text end,last_comment),revision=revision+1,updated_at=now() where id=child.id;
   insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,from_status,to_status,comment) values(p_tenant,child.id,p_actor,p_action,child.status,g.status,comment_text);
   -- 받는 사람 = 요청자 · 그 보고서 작성 강사 · **그 보고서의** 승인 관리자(묶음 합집합이면 다른 과목 관리자에게 무관한 링크가 간다) · 옛 원장.
   for recipient in select distinct x from unnest(array[g.requested_by,child.teacher_id]||coalesce(child.manager_ids,g.manager_ids)||g.director_ids) x where x<>coalesce(p_actor,'00000000-0000-0000-0000-000000000000') loop
    insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,recipient,'approval_decided',headline,g.snapshot->>'name'||' · '||g.effective_date::text,'/withdrawal-reports/'||child.id::text,p_actor);
   end loop;
  end loop;
  -- 끝난 묶음(처리 예약 밖 · 처리 완료·재검토·취소)엔 기다릴 환불 결정이 없다 — 표시를 내린다(s2_0036).
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
    if hits <> 1 then raise exception 's2_0036: _v1의 바꿀 줄 %번이 하나가 아닙니다(%건)', i, hits; end if;
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
    if hits <> 1 then raise exception 's2_0036: 할 일 동기화의 바꿀 줄 %번이 하나가 아닙니다(%건)', i, hits; end if;
    definition := replace(definition, pairs[2*i-1], pairs[2*i]);
  end loop;
  execute definition;
end $$;

-- ── 7) 데스크 환불 연결 — 원장급만 · 데스크 = 학원 설정 '데스크 담당자'로 지정한 사람만(비면·null이면 거절) · 줄마다 결정을 남긴다 ─────────
-- 인자 셋을 더한다(기본값 null): p_none = 같은 화면에서 고르지 않은 줄(환불하지 않음 — 환불 가능 줄 · 다시 정할 이 묶음 요청서 줄) · p_check = 앱이 같은 요청에서 계산한 환불 확인 ·
-- p_supersedes = 다시 환불 승인으로 대체하는 옛 요청서(앱이 화면에서 본 다른 묶음 요청서 — 취소된 요청의 미완료만 · 리뷰 r2 D-1 ⅰ).
-- 옛 6인자 호출(옛 앱)도 이 함수로 온다 — 결정은 고른 줄('환불')만 남고 표시는 그대로. 데스크 지정 검사는 옛 앱에도 걸린다.
drop function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean);
create function public.attach_withdrawal_report_refund(p_tenant uuid, p_actor uuid, p_report uuid, p_document uuid, p_desk uuid, p_expect_gate boolean,
  p_none jsonb default null, p_check jsonb default null, p_supersedes jsonb default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  gid uuid; g public.withdrawal_report_groups; r public.withdrawal_reports; doc_description text; doc_done text; desk_name text; gates boolean := false; link uuid;
  desks jsonb; picked text[] := '{}'; skipped text[] := '{}'; open_n integer; old_docs uuid[] := '{}'; k text;
  cap numeric; cap_known boolean; first_total numeric;
begin
  -- 환불 승인은 원장급만(원장 2026-10-29 · 앱 canRequestRefund와 같은 축 = 원장 역할).
  if not exists(select 1 from public.users where tenant_id = p_tenant and id = p_actor and status = 'active' and system_role::text = 'master') then raise exception '환불 승인은 원장만 할 수 있습니다.'; end if;
  -- 데스크 담당자 = 학원 설정 '데스크 담당자'(specialAccess.withdrawalDeskIds)로 지정한 사람만 — 비었으면 막는다(원장 등으로 대신하지 않는다 · 원장 2026-11-06).
  select ts.data #> '{permissions,specialAccess,withdrawalDeskIds}' into desks from public.tenant_settings ts where ts.tenant_id = p_tenant;
  if jsonb_typeof(desks) is distinct from 'array' or jsonb_array_length(desks) = 0 then raise exception '학원 설정에서 데스크 담당자를 먼저 지정해 주세요.'; end if;
  if p_desk is null or not (desks ? p_desk::text) then raise exception '학원 설정에 지정된 데스크 담당자만 고를 수 있습니다. 데스크 담당자를 다시 골라 주세요.'; end if;
  -- 요청서(restricted)를 열 수 있는 재직 직원(DB 요청서 RLS의 사무 역할과 같다 — 앱 REFUND_DOCUMENT_ROLES) · 운영자 계정 아님 · 행위자 본인 아님(앱 loadDeskStaff와 같은 판정 · 리뷰 #9).
  select display_name into desk_name from public.users where tenant_id = p_tenant and id = p_desk and status = 'active' and system_role::text in ('master','admin','manager','accountant')
    and not coalesce(public.is_super_admin(id), false) and id is distinct from p_actor;
  if desk_name is null then raise exception '데스크 담당자를 다시 골라 주세요.'; end if;
  -- 처리 함수와 같은 잠금 순서(묶음 → 보고서).
  select group_id into gid from public.withdrawal_reports where tenant_id = p_tenant and id = p_report;
  if gid is not null then select * into g from public.withdrawal_report_groups where tenant_id = p_tenant and id = gid for update; end if;
  select * into r from public.withdrawal_reports where tenant_id = p_tenant and id = p_report for update;
  if r.id is null or r.status = 'canceled' or g.status = 'canceled' then raise exception '환불을 연결할 수 있는 퇴원보고서가 아닙니다.'; end if;
  -- 같은 학생의 청구 줄을 다루는 두 자리(이 연결 · 이어진 요청서의 완료일자 트리거)를 줄 세운다(원장 C.3 · 경합). 묶음·보고서 다음에 잡는다 — 잠금 순서 고정.
  perform pg_advisory_xact_lock(hashtextextended('withdrawal_refund_lines:' || p_tenant::text || ':' || r.student_id::text, 0));
  select description, form_data #>> '{result,completedDate}' into doc_description, doc_done from public.academy_documents where tenant_id = p_tenant and id = p_document and form_type = 'refund_request';
  if doc_description is null or position(('report:' || p_report::text || ' ') in doc_description) = 0 then raise exception '이 보고서에서 만든 환불 요청서가 아닙니다.'; end if;
  -- 완료일자가 이미 든 요청서는 잇지 않는다(데스크 단계 없이 처리되는 길 · 리뷰 r2 D-6).
  if not public.withdrawal_refund_blank(doc_done) then raise exception '환불완료일자가 이미 들어간 요청서는 이을 수 없습니다. 새로고침 후 다시 확인해 주세요.'; end if;
  -- 묶음이 아직 처리 전(진행 중 · 처리 예약)이면 이 환불이 끝나야 처리한다. 끝난 보고서에 붙인 환불은 기다리게 하지 않는다.
  gates := gid is not null and g.status in ('pending', 'scheduled');
  if p_expect_gate is not null and gates is distinct from p_expect_gate then
    raise exception '퇴원보고서가 그 사이 ''%'' 상태가 되었습니다. 새로고침 후 다시 확인해 주세요.',
      case coalesce(g.status, r.status) when 'completed' then '처리 완료' when 'blocked' then '재검토 필요' when 'scheduled' then '처리 예약' when 'pending' then '진행 중' else coalesce(g.status, r.status) end;
  end if;
  -- 고른 줄 = 요청서 표식의 줄(lines:…) · 고르지 않은 줄 = 앱이 같은 요청에서 계산한 이 묶음의 정할 줄 안에서만(환불 가능 줄 + 다시 정할 이 묶음 요청서 줄 · 결정은 묶음 단위 — 리뷰 #4).
  select coalesce(array_agg(distinct x), '{}') into picked
    from unnest(string_to_array(substring(doc_description from 'lines:([^[:space:]·]+)'), ',')) x
   where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|unalloc(:~?[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}){0,9})?|[0-9a-z]{1,8}(-[0-9]{1,2})?)$';
  -- 옛 단건(묶음 없음)은 결정이 처리를 막지 않는다 — '환불하지 않음'을 남기지 않는다.
  if p_none is not null and gid is not null then
    if jsonb_typeof(p_none) is distinct from 'array' or jsonb_array_length(p_none) > 200 then raise exception '환불하지 않을 건을 확인해 주세요.'; end if;
    select coalesce(array_agg(distinct v), '{}') into skipped from jsonb_array_elements_text(p_none) v;
    if skipped && picked or exists(select 1 from unnest(skipped) x
         where x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|unalloc(:~?[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}){0,9})?|[0-9a-z]{1,8}(-[0-9]{1,2})?)$'
            or (not exists(select 1 from jsonb_array_elements(coalesce(p_check->'refundable', '[]'::jsonb)) e where e->>'key' = x)
                and not exists(select 1 from jsonb_array_elements(coalesce(p_check->'claimed', '[]'::jsonb)) e where e->>'key' = x)))
      then raise exception '퇴원월 뒤 청구가 바뀌었습니다. 새로고침 후 다시 골라 주세요.'; end if;
  end if;
  -- 확인 값을 넘겼으면 고른 줄도 그 안에서만(화면이 본 줄과 지금 줄이 다르면 다시 보게).
  if p_check is not null and gid is not null and exists(select 1 from unnest(picked) x
       where not exists(select 1 from jsonb_array_elements(coalesce(p_check->'refundable', '[]'::jsonb)) e where e->>'key' = x))
    then raise exception '퇴원월 뒤 청구가 바뀌었습니다. 새로고침 후 다시 골라 주세요.'; end if;
  -- 대체하는 옛 요청서(앱이 넘김) — '취소된 요청에만 이어진 미완료 요청서'여야 한다(같은 돈 두 번 막기 · 리뷰 r2 D-1 ⅰ).
  if p_supersedes is not null then
    if jsonb_typeof(p_supersedes) is distinct from 'array' or jsonb_array_length(p_supersedes) > 50
       or exists(select 1 from jsonb_array_elements(p_supersedes) e where jsonb_typeof(e) is distinct from 'string' or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      then raise exception '환불 확인 값이 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.'; end if;
    select coalesce(array_agg(distinct (e #>> '{}')::uuid), '{}') into old_docs from jsonb_array_elements(p_supersedes) e;
    if exists(select 1 from unnest(old_docs) od
         where od = p_document
            or not exists(select 1 from public.academy_documents a where a.tenant_id = p_tenant and a.id = od and a.form_type = 'refund_request'
                            and public.withdrawal_refund_blank(a.form_data #>> '{result,completedDate}'))
            or not exists(select 1 from public.withdrawal_report_refunds f where f.tenant_id = p_tenant and f.document_id = od)
            or exists(select 1 from public.withdrawal_report_refunds f join public.withdrawal_reports q on q.id = f.report_id where f.document_id = od and q.status <> 'canceled'))
      then raise exception '다른 요청의 요청서가 이미 담은 건이 있습니다. 그 건은 고르지 말고(환불하지 않음) 요청서를 확인해 주세요.'; end if;
    -- 넘긴 옛 요청서는 고른 줄과 같은 청구를 담은 것만(리뷰 r3 R-4 — 무관한 옛 요청서의 완료일자를 막지 않게) · 옛 표식(invoice:)도 읽는다.
    if exists(select 1 from unnest(old_docs) od join public.academy_documents a on a.tenant_id = p_tenant and a.id = od
         where not exists(select 1 from unnest(picked) y
                 where lower(split_part(y, '#', 1)) in (select lower(split_part(t, '#', 1)) from unnest(string_to_array(substring(a.description from 'lines:([^[:space:]·]+)'), ',')) t)
                    or lower(split_part(y, '#', 1)) = lower(substring(a.description from 'invoice:([0-9a-fA-F-]{36})'))))
      then raise exception '대체할 옛 요청서가 고른 청구를 담고 있지 않습니다. 새로고침 후 다시 확인해 주세요.'; end if;
  end if;
  -- 같은 묶음이어도 살아 있는 다른 요청서가 **같은 키**를 담았으면 거절(리뷰 r3 R-1 — 같은 돈 두 번 · 형제 줄·미배분 과목 몫은 따로 정할 다른 돈이라 그대로 둔다).
  if gid is not null and exists(select 1 from unnest(picked) x
      join public.withdrawal_report_refund_decisions o on o.tenant_id = p_tenant and o.group_id = gid and o.line_key = x and o.decision = 'refund' and o.document_id is distinct from p_document
      join public.academy_documents a on a.tenant_id = p_tenant and a.id = o.document_id and a.form_type = 'refund_request')
    then raise exception '이 요청의 다른 환불 요청서가 이미 담은 건이 있습니다. 같은 돈을 두 번 환불하지 않게 그 요청서를 확인해 주세요.'; end if;
  -- 같은 돈 두 번 막기(원장 C.3 반대쪽 · 앱 reapprovable과 같은 판정 · 겹침 규칙 withdrawal_refund_keys_overlap — 리뷰 r2 D-1 ⅱ) — 고른 줄과 겹치는 **다른 묶음**의 '환불' 결정이
  -- 환불을 마쳤거나 취소되지 않은 요청의 것이면 거절. 같은 묶음 안 겹침(형제·미배분 과목 몫)은 막지 않는다(앱도 이 묶음 요청서는 표식에 있는 줄만 잡는다).
  if exists(select 1 from unnest(picked) x
      join public.withdrawal_report_refund_decisions o on o.tenant_id = p_tenant and o.decision = 'refund' and o.document_id is distinct from p_document
        and o.group_id is distinct from gid and public.withdrawal_refund_keys_overlap(o.line_key, x)
      join public.academy_documents a on a.tenant_id = p_tenant and a.id = o.document_id and a.form_type = 'refund_request'
      join public.withdrawal_report_groups og on og.id = o.group_id
     where og.status <> 'canceled' or not public.withdrawal_refund_blank(a.form_data #>> '{result,completedDate}'))
    then raise exception '다른 요청의 요청서가 이미 담은 건이 있습니다. 그 건은 고르지 말고(환불하지 않음) 요청서를 확인해 주세요.'; end if;
  -- 겹치는 취소된 요청의 미완료 요청서도 대체 목록에 더한다(앱이 빠뜨려도 C.3가 문서 id로 막게).
  select coalesce(array_agg(distinct x), '{}') into old_docs from (
    select unnest(old_docs) x
    union
    select o.document_id from unnest(picked) y
      join public.withdrawal_report_refund_decisions o on o.tenant_id = p_tenant and o.decision = 'refund' and o.document_id is distinct from p_document
        and o.group_id is distinct from gid and public.withdrawal_refund_keys_overlap(o.line_key, y)
      join public.academy_documents a on a.tenant_id = p_tenant and a.id = o.document_id and a.form_type = 'refund_request') s;
  insert into public.withdrawal_report_refunds(tenant_id, report_id, group_id, document_id, desk_id, created_by)
    values (p_tenant, r.id, gid, p_document, p_desk, p_actor) on conflict (document_id) do nothing returning id into link;
  if link is null then raise exception '이미 연결된 환불 요청서입니다.'; end if;
  if gid is not null then
    -- 다시 환불 승인(앞 요청서가 지워진 줄) — 상한 = 낸 돈 − 따로 처리하기로 한 금액 − 환불 완료 기록(원장 결정 2026-11-09 · 리뷰 r3 · 이미 돌려준 돈을 다시 담지 않게).
    insert into public.withdrawal_report_refund_decisions as t (tenant_id, group_id, report_id, line_key, decision, document_id, decided_by, paid_net, paid_seen, supersedes)
      select p_tenant, gid, r.id, s.k, 'refund', p_document, p_actor, s.pv, s.pv, old_docs
        from (select x k, (select (e->>'paid')::numeric from jsonb_array_elements(coalesce(p_check->'refundable', '[]'::jsonb)) e where e->>'key' = x limit 1) pv from unnest(picked) x) s
      on conflict (group_id, line_key) do update set decision = 'refund', document_id = excluded.document_id, report_id = excluded.report_id, decided_by = excluded.decided_by,
        decided_at = now(), paid_net = greatest(0, excluded.paid_net - coalesce(t.separate_amount, 0) - coalesce(t.refunded_total, 0)), paid_seen = excluded.paid_seen,
        supersedes = excluded.supersedes;
    foreach k in array skipped loop
      perform public.withdrawal_refund_record_none(p_tenant, gid, r.id, k,
        coalesce((select (e->>'paid')::numeric from jsonb_array_elements(coalesce(p_check->'refundable', '[]'::jsonb)) e where e->>'key' = k limit 1),
                 (select (e->>'paid')::numeric from jsonb_array_elements(coalesce(p_check->'claimed', '[]'::jsonb)) e where e->>'key' = k and jsonb_typeof(e->'paid') = 'number' limit 1)),
        (select (e->>'doc')::uuid from jsonb_array_elements(coalesce(p_check->'claimed', '[]'::jsonb)) e where e->>'key' = k
           and coalesce(e->>'doc', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' limit 1),
        p_actor);
    end loop;
    -- 요청서의 첫 총액도 상한과 맞댄다(리뷰 r3 R3-1 — 상한 = 이 요청서 '환불' 결정 paid_net 합 · 다시 승인이면 낸 돈 − 따로 − 완료 기록 · 그 뒤 수정은 트리거가 본다).
    -- 상한을 모르거나(확인 값 없음 — 옛 6인자 호출) 총액을 못 읽거나(엄격 꼴 — R-2) 넘으면 거절 — 앱은 같은 공식으로 총액을 만든다(refundDeduction).
    select count(*) > 0 and bool_and(d.paid_net is not null), sum(d.paid_net) into cap_known, cap
      from public.withdrawal_report_refund_decisions d where d.tenant_id = p_tenant and d.document_id = p_document and d.decision = 'refund';
    first_total := public.withdrawal_refund_won((select a.form_data #>> '{refund,totalAmount}' from public.academy_documents a where a.tenant_id = p_tenant and a.id = p_document));
    if not coalesce(cap_known, false) or first_total is null or first_total > cap then
      raise exception using errcode = '23514', message = format('환불 요청서의 총 환불금액이 원장이 승인한 줄의 낸 돈 합계(상한 %s)를 넘거나 읽을 수 없습니다. 새로고침 후 다시 확인해 주세요.',
        coalesce(to_char(cap, 'FM999,999,999,999,999') || '원', '모름'));
    end if;
  end if;
  insert into public.withdrawal_report_events(tenant_id, report_id, actor_id, action, from_status, to_status, comment)
    values (p_tenant, r.id, p_actor, 'refund', r.status, r.status,
      '데스크 환불 요청 · ' || desk_name || case when gates then ' — 환불 처리(환불완료일자) 뒤 퇴원·수강종료' else '' end
        || case when cardinality(skipped) > 0 then ' · 고르지 않은 ' || cardinality(skipped) || '건은 환불하지 않음' else '' end);
  if gid is not null then open_n := public.withdrawal_report_refund_note(p_tenant, gid, p_check, p_actor, true); end if;
  return jsonb_build_object('attached', true, 'groupId', gid, 'groupStatus', g.status, 'gates', gates, 'undecided', open_n);
end $$;
-- 연동 역할 실행권 확인: attach_withdrawal_report_refund·release_withdrawal_report_refunds는 새 인자 판(옛 판은 위에서 지움)이고 s2_0025부터 PUBLIC·anon·authenticated 회수 · service_role만(앱 서버·처리일 cron) — 운영 읽기 전용 2026-11-09: eywa_sync_agent 실행권 없음 · RLS 정책·다른 함수 본문이 부르지 않음 · 연동 앱 코드가 부르지 않음(가드 sync-agent-execute-grants).
revoke all on function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean, jsonb, jsonb, jsonb) to service_role;

-- ── 8) 원장 '환불 없음' — 처리 전 묶음의 고른 줄(앱이 같은 요청에서 계산한 이 묶음의 정할 줄 안 — 환불 가능 줄 · 다시 정할 이 묶음 요청서 줄 · 대표 아닌 보고서 화면도 — 리뷰 #4 · r2 D-2)을
--     '환불하지 않음'으로 ───────────────
-- 행위자 = 원장급(원장 역할 · 앱 canRequestRefund와 같은 축)만. 처리는 하지 않는다 — 앱이 이어서 release(새 확인 값)로 처리한다(ready).
-- 이 묶음 요청서가 담은 줄(claimed)은 그 요청서가 담은 것으로 보고 더 환불하지 않음(withdrawal_refund_record_none — '환불' 상한은 그대로 · 본 낸 돈만).
-- r3 p_separate(원장 결정 2026-11-09) = 환불을 마친 이 묶음 요청서의 줄 중 낸 돈이 는 줄 — '환불하지 않음 — 늘어난 몫은 수납에서 따로 처리'.
--   늘어난 금액(지금 낸 돈 − 본 낸 돈)을 결정 행 separate_amount에 더하고 시각·결정자를 남긴다(다시 환불 승인할 때 상한에서 뺀다 · 첫 환불 기록은 그대로).
create or replace function public.decide_withdrawal_report_refund(p_tenant uuid, p_actor uuid, p_report uuid, p_none jsonb, p_check jsonb, p_separate jsonb default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  gid uuid; g public.withdrawal_report_groups; r public.withdrawal_reports; keys text[]; k text; n integer; today date := (now() at time zone 'Asia/Seoul')::date;
  sep text[] := '{}'; sep_doc uuid; sep_paid numeric; sep_inc numeric; sep_total numeric := 0; sep_incs jsonb := '{}';
begin
  if not exists(select 1 from public.users where tenant_id = p_tenant and id = p_actor and status = 'active' and system_role::text = 'master') then raise exception '환불 결정은 원장만 할 수 있습니다.'; end if;
  select group_id into gid from public.withdrawal_reports where tenant_id = p_tenant and id = p_report;
  if gid is null then raise exception '환불을 결정할 수 있는 퇴원보고서가 아닙니다.'; end if;
  select * into g from public.withdrawal_report_groups where tenant_id = p_tenant and id = gid for update;
  select * into r from public.withdrawal_reports where tenant_id = p_tenant and id = p_report for update;
  if g.status not in ('pending', 'scheduled') or r.status in ('canceled', 'completed', 'blocked') then raise exception '처리 전 퇴원보고서에서만 환불 없음을 정할 수 있습니다.'; end if;
  if jsonb_typeof(p_none) is distinct from 'array' or jsonb_array_length(p_none) not between 1 and 200 then raise exception '환불하지 않을 건을 확인해 주세요.'; end if;
  select coalesce(array_agg(distinct v), '{}') into keys from jsonb_array_elements_text(p_none) v;
  if p_check is null or exists(select 1 from unnest(keys) x
       where x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#(all|unalloc(:~?[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}){0,9})?|[0-9a-z]{1,8}(-[0-9]{1,2})?)$'
          or (not exists(select 1 from jsonb_array_elements(coalesce(p_check->'refundable', '[]'::jsonb)) e where e->>'key' = x)
              and not exists(select 1 from jsonb_array_elements(coalesce(p_check->'claimed', '[]'::jsonb)) e where e->>'key' = x)))
    then raise exception '퇴원월 뒤 청구가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.'; end if;
  if p_separate is not null then
    if jsonb_typeof(p_separate) is distinct from 'array' or jsonb_array_length(p_separate) > 200 then raise exception '따로 환불할 건을 확인해 주세요.'; end if;
    select coalesce(array_agg(distinct v), '{}') into sep from jsonb_array_elements_text(p_separate) v;
    if not sep <@ keys then raise exception '따로 환불할 건은 환불하지 않을 건 안에서만 고를 수 있습니다.'; end if;
  end if;
  -- 따로 처리할 줄 = 환불을 마친 이 묶음 요청서(claimed)의 '환불' 줄이고 그 뒤 낸 돈이 늘었다 — 아니면 거절(늘어난 몫을 기록하기 전에 본다).
  foreach k in array sep loop
    select (e->>'doc')::uuid, (e->>'paid')::numeric into sep_doc, sep_paid from jsonb_array_elements(coalesce(p_check->'claimed', '[]'::jsonb)) e
     where e->>'key' = k and coalesce(e->>'doc', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and jsonb_typeof(e->'paid') = 'number' limit 1;
    select sep_paid - coalesce(d.paid_seen, d.paid_net) into sep_inc from public.withdrawal_report_refund_decisions d
     where d.tenant_id = p_tenant and d.group_id = g.id and d.line_key = k and d.decision = 'refund' and d.document_id = sep_doc
       and exists(select 1 from public.withdrawal_report_refunds f where f.tenant_id = p_tenant and f.document_id = sep_doc and f.group_id = g.id)
       and exists(select 1 from public.academy_documents a where a.tenant_id = p_tenant and a.id = sep_doc and a.form_type = 'refund_request'
                    and not public.withdrawal_refund_blank(a.form_data #>> '{result,completedDate}'));
    if sep_doc is null or sep_inc is null or sep_inc <= 0 then
      raise exception '늘어난 몫을 따로 환불할 수 있는 건은 환불을 마친 요청서의 줄 중 그 뒤 낸 돈이 는 줄뿐입니다. 새로고침 후 다시 확인해 주세요.';
    end if;
    sep_incs := sep_incs || jsonb_build_object(k, sep_inc);
  end loop;
  foreach k in array keys loop
    sep_inc := (sep_incs->>k)::numeric;
    perform public.withdrawal_refund_record_none(p_tenant, g.id, r.id, k,
      coalesce((select (e->>'paid')::numeric from jsonb_array_elements(coalesce(p_check->'refundable', '[]'::jsonb)) e where e->>'key' = k limit 1),
               (select (e->>'paid')::numeric from jsonb_array_elements(coalesce(p_check->'claimed', '[]'::jsonb)) e where e->>'key' = k and jsonb_typeof(e->'paid') = 'number' limit 1)),
      (select (e->>'doc')::uuid from jsonb_array_elements(coalesce(p_check->'claimed', '[]'::jsonb)) e where e->>'key' = k
         and coalesce(e->>'doc', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' limit 1),
      p_actor);
    if sep_inc is not null and sep_inc > 0 then
      update public.withdrawal_report_refund_decisions set separate_amount = coalesce(separate_amount, 0) + sep_inc, separate_at = now(), separate_by = p_actor
       where tenant_id = p_tenant and group_id = g.id and line_key = k;
      sep_total := sep_total + sep_inc;
    end if;
  end loop;
  insert into public.withdrawal_report_events(tenant_id, report_id, actor_id, action, from_status, to_status, comment)
    values (p_tenant, r.id, p_actor, 'refund_decision', r.status, r.status, '환불 없음 ' || cardinality(keys) || '건 — 퇴원월 뒤 청구를 환불하지 않습니다.'
      || case when sep_total > 0 then ' 늘어난 몫 ' || to_char(sep_total, 'FM999,999,999,999,999') || '원은 수납에서 따로 환불합니다(' || cardinality(sep) || '건).' else '' end);
  n := public.withdrawal_report_refund_note(p_tenant, g.id, p_check, p_actor, true);
  return jsonb_build_object('groupId', g.id, 'undecided', n, 'separate', sep_total,
    'ready', n = 0 and not public.withdrawal_report_refund_pending(g.id)
      and ((g.status = 'pending' and not exists(select 1 from public.withdrawal_reports q where q.group_id = g.id and q.status <> 'approved'))
           or (g.status = 'scheduled' and g.effective_date <= today)));
end $$;
revoke all on function public.decide_withdrawal_report_refund(uuid, uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.decide_withdrawal_report_refund(uuid, uuid, uuid, jsonb, jsonb, jsonb) to service_role;

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

-- ── 10a) 데스크 환불 미완료 판정 — 완료일자 '빈칸'을 앱과 같은 글자 집합으로(리뷰 r2 D-11 · s2_0025 본문에서 btrim 한 자리만) ─────────────
create or replace function public.withdrawal_report_refund_pending(p_group uuid)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
 select exists(select 1 from public.withdrawal_report_refunds f
   join public.academy_documents d on d.id = f.document_id and d.tenant_id = f.tenant_id and d.form_type = 'refund_request'
   where f.group_id = p_group and public.withdrawal_refund_blank(d.form_data #>> '{result,completedDate}'))
$function$;

-- ── 10) 이어진 요청서 지키기(원장 결정 2026-11-06·11-09) — 번호·서식·표식은 아무도 못 바꾼다 · 수정·환불완료일자·지우기는 담당 데스크(재직)·원장급 · 완료된 것은 못 지운다 · 상한 ─────────
-- 앱 서버(관리 키 — auth.uid() 없음)는 행위자 판정을 먼저 본다(수납 저장·삭제 · 자료실 · linked-request.ts). 세션 쓰기가 막히면 23514(🔴 42501이 아니다 — 강사뷰 쓰기
-- writeSessionFirst는 42501이면 관리 키로 다시 써 이 트리거를 지나 버린다 · 리뷰 r2).
-- 번호·지점·서식·표식(description)과 '같은 번호로 다시 넣기'는 관리 키로도 막는다(검토 2026-11-06). 상한(총 환불금액 ≤ '환불' 결정 paid_net 합)도 관리 키 포함(데이터 규칙).
-- SECURITY DEFINER = 연결 표(withdrawal_report_refunds)는 직원 세션이 읽을 수 없다. 트리거 함수라 RPC로 부를 수 없다.
-- 🔴 INSERT·UPDATE·DELETE를 한 함수에서 — DELETE 갈래는 맨 앞에서 끝내고 return OLD(이어지지 않은 문서 삭제가 return NEW(=null)로 조용히 0행이 되지 않게 · 리뷰 r2 경고).
create or replace function public.withdrawal_report_refund_complete_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_desk uuid; v_linked boolean := false; v_student uuid; v_desk_ok boolean; v_director boolean;
  v_old_done boolean; v_new_done boolean; v_cap numeric; v_cap_known boolean; v_total numeric; v_tok text; v_amt numeric;
begin
  if tg_op = 'DELETE' then
    select true, f.desk_id into v_linked, v_desk from public.withdrawal_report_refunds f where f.document_id = OLD.id limit 1;
    if not coalesce(v_linked, false) then return OLD; end if;
    -- 지점 자체를 지우는 연쇄(지점 행이 먼저 사라졌다)는 막지 않는다 — 결정 표·연결 표도 함께 지워진다.
    if not exists(select 1 from public.tenants t where t.id = OLD.tenant_id) then return OLD; end if;
    -- 완료된(돈을 돌려준) 이어진 요청서는 누구도(관리 키 · 자료실 포함) 지우지 못한다 — 지워야 하면 원장이 먼저 완료일자를 비운다(리뷰 r2 B1).
    if not public.withdrawal_refund_blank(OLD.form_data #>> '{result,completedDate}') then
      raise exception using errcode = '23514', message = '환불완료일자가 들어간(돈을 돌려준) 이어진 환불 요청서는 지울 수 없습니다. 그 뒤 늘어난 몫은 따로 환불로 처리합니다(수납의 일반 환불 요청서).';
    end if;
    if v_uid is not null
       and not (v_uid = v_desk and exists(select 1 from public.users u where u.tenant_id = OLD.tenant_id and u.id = v_desk and u.status = 'active'))
       and not exists(select 1 from public.users u where u.tenant_id = OLD.tenant_id and u.id = v_uid and u.status = 'active' and u.system_role::text = 'master') then
      raise exception using errcode = '23514', message = '퇴원보고서에서 이어진 환불 요청서는 그 요청서의 데스크 담당자와 원장만 지울 수 있습니다.';
    end if;
    return OLD;
  end if;
  if tg_op = 'INSERT' then
    if exists(select 1 from public.withdrawal_report_refunds f where f.document_id = NEW.id) then
      raise exception using errcode = '23514', message = '퇴원보고서에 이어진 환불 요청서 번호로 새 문서를 만들 수 없습니다.';
    end if;
    return NEW;
  end if;
  select true, f.desk_id into v_linked, v_desk from public.withdrawal_report_refunds f where f.document_id = OLD.id or f.document_id = NEW.id limit 1;
  if not coalesce(v_linked, false) then return NEW; end if;
  if NEW.id is distinct from OLD.id or NEW.tenant_id is distinct from OLD.tenant_id or NEW.form_type is distinct from OLD.form_type or NEW.description is distinct from OLD.description then
    raise exception using errcode = '23514', message = '퇴원보고서에 이어진 환불 요청서의 번호·서식·표식은 바꿀 수 없습니다.';
  end if;
  v_old_done := not public.withdrawal_refund_blank(OLD.form_data #>> '{result,completedDate}');
  v_new_done := not public.withdrawal_refund_blank(NEW.form_data #>> '{result,completedDate}');
  -- 완료일자는 빈칸 또는 날짜(YYYY-MM-DD)만(리뷰 r3 R-9 — '확인 중' 같은 글이 완료로 읽혀 데스크 대기가 풀렸다 · 앱 저장도 같은 검사).
  if v_new_done and (NEW.form_data #>> '{result,completedDate}') is distinct from (OLD.form_data #>> '{result,completedDate}')
     and (NEW.form_data #>> '{result,completedDate}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '23514', message = '환불완료일자는 날짜(예: 2026-11-09)로 넣어 주세요.';
  end if;
  -- 원장 결정(2026-11-06 · C.3) — 취소된 요청에만 이어진 요청서의 환불완료일자를 처음 넣을 때, 그 돈을 다시 담은 새 퇴원 요청의 요청서(취소되지 않은 묶음 · 문서가 남음)가
  -- 있으면 누구도(관리 키 포함) 넣지 못한다(이중 환불 막기). 판정 = 새 결정 행이 이 요청서를 대체한다고 적었거나(supersedes — 키가 바뀌어도) · 줄 키가 겹친다(겹침 규칙).
  -- 잠금 = 연결 함수와 같은 학생 단위 거래 잠금(이 요청서 행 다음에 잡는다 — 연결 함수는 요청서 행을 잠그지 않는다 · 교착 없음).
  if not v_old_done and v_new_done
     and not exists(select 1 from public.withdrawal_report_refunds f join public.withdrawal_reports q on q.id = f.report_id where f.document_id = NEW.id and q.status <> 'canceled') then
    select q.student_id into v_student from public.withdrawal_report_refunds f join public.withdrawal_reports q on q.id = f.report_id where f.document_id = NEW.id limit 1;
    perform pg_advisory_xact_lock(hashtextextended('withdrawal_refund_lines:' || NEW.tenant_id::text || ':' || v_student::text, 0));
    if exists(select 1 from public.withdrawal_report_refund_decisions o
        join public.withdrawal_report_groups og on og.id = o.group_id and og.status <> 'canceled'
        join public.academy_documents a on a.tenant_id = o.tenant_id and a.id = o.document_id and a.form_type = 'refund_request'
       where o.tenant_id = NEW.tenant_id and o.decision = 'refund' and o.document_id is distinct from NEW.id
         and (NEW.id = any(o.supersedes)
              or exists(select 1 from public.withdrawal_report_refund_decisions mine
                         where mine.tenant_id = NEW.tenant_id and mine.document_id = NEW.id and mine.decision = 'refund' and public.withdrawal_refund_keys_overlap(mine.line_key, o.line_key)))) then
      raise exception using errcode = '23514', message = '같은 청구에 새 퇴원 요청의 요청서가 있습니다 — 새 요청서로 처리하세요.';
    end if;
  end if;
  -- 상한(리뷰 r2 I6 · 관리 키 포함) — 총 환불금액(숫자만)이 그 요청서의 '환불' 결정 paid_net 합을 넘으면 거절. 상한을 모르면(행 없음 · paid_net 없음) 금액 칸(총 환불금액·결제내역)을
  -- 바꾸는 저장만 거절한다(완료일자 입력 등은 받는다 — 막으면 그 묶음이 영원히 기다린다).
  if (NEW.form_data #>> '{refund,totalAmount}') is distinct from (OLD.form_data #>> '{refund,totalAmount}')
     or (NEW.form_data #>> '{refund,paymentDetails}') is distinct from (OLD.form_data #>> '{refund,paymentDetails}') then
    select count(*) > 0 and bool_and(d.paid_net is not null), sum(d.paid_net) into v_cap_known, v_cap
      from public.withdrawal_report_refund_decisions d where d.tenant_id = NEW.tenant_id and d.document_id = NEW.id and d.decision = 'refund';
    if not coalesce(v_cap_known, false) then
      raise exception using errcode = '23514', message = '원장 승인 금액(상한)을 알 수 없어 이어진 환불 요청서의 총 환불금액·결제내역은 바꿀 수 없습니다 — 원장에게 확인해 주세요.';
    end if;
    if (NEW.form_data #>> '{refund,totalAmount}') is distinct from (OLD.form_data #>> '{refund,totalAmount}') then
      v_total := public.withdrawal_refund_won(NEW.form_data #>> '{refund,totalAmount}');
      -- 숫자(쉼표)·'원'만 읽는다(리뷰 r3 R-2 — '300만원'이 300으로 읽혀 상한을 지나갔다).
      if v_total is null then
        raise exception using errcode = '23514', message = '총 환불금액은 숫자와 쉼표·''원''만 써 주세요(예: 315,000원).';
      end if;
      if v_total > v_cap then
        raise exception using errcode = '23514', message = format('총 환불금액이 원장이 승인한 줄의 낸 돈 합계(상한 %s원)를 넘습니다.', to_char(v_cap, 'FM999,999,999,999,999'));
      end if;
    end if;
    -- 결제내역의 금액 표기도 같은 규칙으로 읽는다 — 못 읽으면 거절 · 이번에 새로 들어온 금액(전에 없던 값)은 상한 이하여야 한다(데스크가 결제내역을 보고 돌려줄 수 있다).
    if (NEW.form_data #>> '{refund,paymentDetails}') is distinct from (OLD.form_data #>> '{refund,paymentDetails}') then
      for v_tok in select m[1] from regexp_matches(coalesce(NEW.form_data #>> '{refund,paymentDetails}', ''), '([0-9][0-9,.]*[ ]*[십백천만억]*[ ]*원|[일이삼사오육칠팔구]*[십백천만억]+[ ]*원)', 'g') m loop
        v_amt := public.withdrawal_refund_won(v_tok);
        if v_amt is null then
          raise exception using errcode = '23514', message = format('결제내역의 금액 %s은(는) 읽을 수 없습니다 — 숫자와 쉼표·''원''만 써 주세요(예: 315,000원).', v_tok);
        end if;
        if v_amt > v_cap and not exists(select 1 from regexp_matches(coalesce(OLD.form_data #>> '{refund,paymentDetails}', ''), '([0-9][0-9,.]*[ ]*[십백천만억]*[ ]*원|[일이삼사오육칠팔구]*[십백천만억]+[ ]*원)', 'g') o
                                         where public.withdrawal_refund_won(o[1]) = v_amt) then
          raise exception using errcode = '23514', message = format('결제내역에 원장이 승인한 금액(상한 %s원)보다 큰 금액이 새로 들어갔습니다.', to_char(v_cap, 'FM999,999,999,999,999'));
        end if;
      end loop;
    end if;
  end if;
  -- 환불 완료 기록(원장 결정 2026-11-09 · 리뷰 r3) — 완료일자가 처음 들어가면 그 요청서 '환불' 결정 금액을 결정 행에 남긴다(관리 키 포함 · 요청서마다 한 번).
  --   완료일자를 비우거나 요청서를 지워도 남는다 — 같은 줄을 다시 환불 승인하면 상한에서 뺀다(attach).
  if not v_old_done and v_new_done then
    update public.withdrawal_report_refund_decisions d set refunded_total = coalesce(d.refunded_total, 0) + coalesce(d.paid_net, 0), refunded_docs = d.refunded_docs || NEW.id
     where d.tenant_id = NEW.tenant_id and d.document_id = NEW.id and d.decision = 'refund' and not (NEW.id = any(d.refunded_docs));
  end if;
  -- 관리 키(앱 서버 · 행위자를 모름) — 행위자 판정은 앱이 먼저 했다(linked-request.ts).
  if v_uid is null then return NEW; end if;
  v_desk_ok := v_uid = v_desk and exists(select 1 from public.users u where u.tenant_id = NEW.tenant_id and u.id = v_desk and u.status = 'active');
  v_director := exists(select 1 from public.users u where u.tenant_id = NEW.tenant_id and u.id = v_uid and u.status = 'active' and u.system_role::text = 'master');
  -- 고치기(form_data · 제목 — 환불완료일자 포함)는 담당 데스크(재직)와 원장급만(원장 결정 2026-11-09). 분류(폴더)·고정·직원 연쇄(uploaded_by·staff_user_id)는 막지 않는다.
  if (NEW.form_data is distinct from OLD.form_data or NEW.title is distinct from OLD.title) and not (v_desk_ok or v_director) then
    raise exception using errcode = '23514', message = '퇴원보고서에서 이어진 환불 요청서는 그 요청서의 데스크 담당자와 원장만 고칠 수 있습니다(환불완료일자 포함).';
  end if;
  -- 환불완료일자 비우기는 원장급만(리뷰 r2 B1·D-13 — 담당 데스크가 비운 뒤 지우면 완료 기록이 사라진다).
  if v_old_done and not v_new_done and not v_director then
    raise exception using errcode = '23514', message = '이어진 환불 요청서의 환불완료일자를 비우는 것은 원장만 할 수 있습니다.';
  end if;
  return NEW;
end $$;
revoke all on function public.withdrawal_report_refund_complete_guard() from public, anon, authenticated;
drop trigger if exists withdrawal_report_refund_complete_guard on public.academy_documents;
create trigger withdrawal_report_refund_complete_guard before insert or update or delete on public.academy_documents
  for each row execute function public.withdrawal_report_refund_complete_guard();

-- ── 10b) 할 일 닫기 · 취소 알림의 빈칸 판정을 한 벌로(리뷰 r3 R-9) — 운영 정의에서 그 조건만 치환한다(정확히 한 번 · 지문은 위 사전 검사).
--   할 일 닫기(staff_tasks_private.tg_refund_task · s2_0011)가 btrim(공백만)으로 보면 전각 공백 완료일자를 '완료'로 보고 데스크 할 일을 닫는데, 처리 판정(refund_pending)은 '미완료'라
--   할 일 없이 묶음만 기다렸다. 취소 알림(withdrawal_report_refunds_on_cancel · s2_0025)의 '환불이 끝난 뒤 취소' 판정도 같은 규칙으로.
do $$
declare
  definition text;
  hits int;
  pairs constant text[] := array[
    $o$coalesce(btrim(NEW.form_data #>> '{result,completedDate}'), '') <> ''$o$, $n$not public.withdrawal_refund_blank(NEW.form_data #>> '{result,completedDate}')$n$,
    $o$coalesce(btrim(OLD.form_data #>> '{result,completedDate}'), '') = ''$o$, $n$public.withdrawal_refund_blank(OLD.form_data #>> '{result,completedDate}')$n$];
  cancel_old constant text := $o$coalesce(btrim(d.form_data #>> '{result,completedDate}'), '') <> '' completed$o$;
  cancel_new constant text := $n$not public.withdrawal_refund_blank(d.form_data #>> '{result,completedDate}') completed$n$;
begin
  select pg_get_functiondef('staff_tasks_private.tg_refund_task()'::regprocedure) into definition;
  for i in 1 .. array_length(pairs, 1) / 2 loop
    hits := (length(definition) - length(replace(definition, pairs[2*i-1], ''))) / length(pairs[2*i-1]);
    if hits <> 1 then raise exception 's2_0036: 할 일 닫기의 바꿀 조건 %번이 하나가 아닙니다(%건)', i, hits; end if;
    definition := replace(definition, pairs[2*i-1], pairs[2*i]);
  end loop;
  execute definition;
  select pg_get_functiondef('public.withdrawal_report_refunds_on_cancel(uuid,uuid,uuid,text)'::regprocedure) into definition;
  hits := (length(definition) - length(replace(definition, cancel_old, ''))) / length(cancel_old);
  if hits <> 1 then raise exception 's2_0036: 취소 알림의 바꿀 조건이 하나가 아닙니다(%건)', hits; end if;
  execute replace(definition, cancel_old, cancel_new);
end $$;

-- ── 11) 사후 확인(함정 #155) — 바꾼 함수·새 함수는 service_role만 부른다(앱 관리 키 · DB 안 호출 사슬). anon·authenticated는 못 부른다.
--   트리거 함수는 실행 시점에 실행권을 보지 않는다(쓰는 역할과 무관하게 돈다) — anon·authenticated 실행권만 없는지 본다. 결정 표 권한(리뷰 r2 D-5) · 트리거 사건(INSERT·UPDATE·DELETE).
--   아니면 거래를 취소한다.
do $$
declare
  f text;
  p text;
begin
  foreach f in array array[
    'public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)', 'public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)',
    'public.attach_withdrawal_report_refund(uuid,uuid,uuid,uuid,uuid,boolean,jsonb,jsonb,jsonb)', 'public.release_withdrawal_report_refunds(uuid,uuid,uuid,jsonb)',
    'public.withdrawal_report_refund_note(uuid,uuid,jsonb,uuid,boolean)', 'public.decide_withdrawal_report_refund(uuid,uuid,uuid,jsonb,jsonb,jsonb)',
    'public.withdrawal_report_refunds_on_cancel(uuid,uuid,uuid,text)',
    'staff_tasks_private.withdrawal_sync_report(uuid)', 'public.withdrawal_report_refund_pending(uuid)', 'public.direct_withdrawal_report(uuid,uuid,jsonb)',
    'public.withdrawal_refund_blank(text)', 'public.withdrawal_refund_won(text)', 'public.withdrawal_refund_keys_overlap(text,text)',
    'public.withdrawal_refund_later_fingerprint(uuid,uuid,text)', 'public.withdrawal_refund_gate_ready()',
    'public.withdrawal_refund_record_none(uuid,uuid,uuid,text,numeric,uuid,uuid)'
  ] loop
    if not has_function_privilege('service_role', f, 'execute') then raise exception 's2_0036 사후 확인: % — service_role이 부를 수 없습니다(함정 #155).', f; end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 's2_0036 사후 확인: % — anon·authenticated가 부를 수 있습니다.', f;
    end if;
  end loop;
  if to_regprocedure('public.attach_withdrawal_report_refund(uuid,uuid,uuid,uuid,uuid,boolean,jsonb,jsonb)') is not null then
    raise exception 's2_0036 사후 확인: 옛 8인자 연결 함수가 남아 있습니다.';
  end if;
  if has_function_privilege('anon', 'public.withdrawal_report_refund_complete_guard()', 'execute') or has_function_privilege('authenticated', 'public.withdrawal_report_refund_complete_guard()', 'execute') then
    raise exception 's2_0036 사후 확인: 완료일자 트리거 함수를 anon·authenticated가 부를 수 있습니다.';
  end if;
  if has_function_privilege('anon', 'staff_tasks_private.tg_refund_task()', 'execute') or has_function_privilege('authenticated', 'staff_tasks_private.tg_refund_task()', 'execute') then
    raise exception 's2_0036 사후 확인: 할 일 닫기 트리거 함수를 anon·authenticated가 부를 수 있습니다.';
  end if;
  if to_regprocedure('public.decide_withdrawal_report_refund(uuid,uuid,uuid,jsonb,jsonb)') is not null then
    raise exception 's2_0036 사후 확인: 옛 5인자 환불 없음 함수가 남아 있습니다.';
  end if;
  -- 연결 표 — service_role은 select·insert만(리뷰 r3 R-6) · anon·authenticated는 아무것도.
  foreach p in array array['select', 'insert'] loop
    if not has_table_privilege('service_role', 'public.withdrawal_report_refunds', p) then raise exception 's2_0036 사후 확인: 연결 표 service_role % 권한이 없습니다.', p; end if;
  end loop;
  foreach p in array array['update', 'delete', 'truncate', 'references', 'trigger'] loop
    if has_table_privilege('service_role', 'public.withdrawal_report_refunds', p) then raise exception 's2_0036 사후 확인: 연결 표 service_role에 % 권한이 남았습니다(리뷰 r3 R-6).', p; end if;
    if has_table_privilege('anon', 'public.withdrawal_report_refunds', p) or has_table_privilege('authenticated', 'public.withdrawal_report_refunds', p) then
      raise exception 's2_0036 사후 확인: 연결 표를 anon·authenticated가 % 할 수 있습니다.', p;
    end if;
  end loop;
  -- 트리거 사건 비트: INSERT 4 · DELETE 8 · UPDATE 16 — 셋 다(삭제 막기 · 리뷰 r2 B1).
  if not exists(select 1 from pg_trigger where tgname = 'withdrawal_report_refund_complete_guard' and tgrelid = 'public.academy_documents'::regclass and (tgtype::int & 28) = 28) then
    raise exception 's2_0036 사후 확인: 완료일자 트리거가 없거나 INSERT·UPDATE·DELETE를 다 받지 않습니다.';
  end if;
  -- 결정 표 — service_role은 select·insert·update만(지우기·비우기·참조·트리거 없음 · Supabase 기본 권한을 거뒀는지) · anon·authenticated는 아무것도.
  foreach p in array array['select', 'insert', 'update'] loop
    if not has_table_privilege('service_role', 'public.withdrawal_report_refund_decisions', p) then raise exception 's2_0036 사후 확인: 결정 표 service_role % 권한이 없습니다.', p; end if;
  end loop;
  foreach p in array array['delete', 'truncate', 'references', 'trigger'] loop
    if has_table_privilege('service_role', 'public.withdrawal_report_refund_decisions', p) then raise exception 's2_0036 사후 확인: 결정 표 service_role에 % 권한이 남았습니다(리뷰 r2 D-5).', p; end if;
  end loop;
  foreach p in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
    if has_table_privilege('anon', 'public.withdrawal_report_refund_decisions', p) or has_table_privilege('authenticated', 'public.withdrawal_report_refund_decisions', p) then
      raise exception 's2_0036 사후 확인: 결정 표를 anon·authenticated가 % 할 수 있습니다.', p;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
