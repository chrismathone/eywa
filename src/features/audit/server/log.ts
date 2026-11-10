import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { pokeSlack } from "@/features/slack/server/poke";
import { logTenantViewActivity } from "@/features/super-admin/server/audit";
import { fetchInChunks } from "@/lib/supabase/batch";
import { collectAuditNameIds, systemActorMatches, SYSTEM_ACTOR_PREFIX } from "../describe";

// 운영 감사로그 액션 키 + 라벨 — logAction 호출부와 뷰어 필터가 공유.
// ⚠️ 새 logAction 액션 키는 반드시 여기 등록(안 하면 뷰어에 영문 키 원문 노출) + describe.ts에 상세 한글화 추가.
export const AUDIT_ACTIONS = {
  withdrawal_report_update: "퇴원보고서 처리",
  // 퇴원월 뒤 청구의 환불을 원장이 퇴원보고서에서 승인 → 환불 요청서 생성(2026-10-29). 요청서 쪽 refund_request_create도 함께 남는다.
  withdrawal_refund_approve: "퇴원보고서 환불 승인",
  // 원장 '환불 없음'(2026-11-06) — 퇴원월 뒤 청구의 환불 가능 줄을 환불하지 않기로 정함(정해야 퇴원·수강종료를 처리한다 · DB s2_0037).
  withdrawal_refund_decline: "퇴원보고서 환불 없음(원장 결정)",
  // 원장 '지금 다시 판정'(리뷰 r2 (b) · 2026-11-09) — 목록은 '환불 결정 대기'인데 지금 계산으론 정할 건이 없을 때. cron 안전망과 같은 release 함수로 지금 계산한 확인 값을 넘긴다.
  withdrawal_refund_recheck: "퇴원보고서 환불 결정 다시 판정",
  // 원장 '환불하지 않음 — 늘어난 몫은 수납에서 따로 처리'(원장 결정 2026-11-09) — 환불을 마친 요청서의 줄에 그 뒤 낸 돈이 늘었을 때(첫 환불 기록은 그대로 · DB가 늘어난 몫을 결정 행에 남긴다).
  withdrawal_refund_separate: "퇴원보고서 늘어난 몫 따로 환불(원장 결정)",
  // ── 학원 설정 감사 커버리지(2026-08-27 원장 점검) — 연동·프롬프트·강의실 수정·팝업 수정이
  //    통째로 무기록이었다. 특히 연동은 user_integrations에 updated_by조차 없어 흔적이 0이었다.
  integration_sync_toggle: "makeedu 자동 동기화 토글",
  sync_agent_manage: "연동 PC 관리",
  integration_sheets_toggle: "구글 시트 내보내기 토글",
  integration_sheet_target: "구글 시트 대상 지정",
  integration_video_drive_setting: "숙제영상 저장 폴더 지정",
  integration_video_drive_account: "숙제영상 Google 계정 연결",
  // 오늘 수학 지점 사용 메뉴(2026-10-19) — 에이와 원장이 바꾼 것과 오늘 수학에서 바꾼 것(알림으로 받음)이 같은 키. 출처는 metadata.source.
  todays_math_menus_update: "오늘 수학 사용 메뉴 변경",
  integration_sync_now: "makeedu 지금 동기화",
  slack_connection_token: "슬랙 봇 토큰 등록",
  slack_connection_disconnect: "슬랙 알림 연결 해제",
  slack_connection_sample: "슬랙 샘플 알림 발송",
  slack_schedule_update: "슬랙 발송 시간 설정",
  slack_rule_save: "슬랙 규칙 저장",
  slack_rule_delete: "슬랙 규칙 삭제",
  slack_link_owner: "슬랙 사람 연결(원장 확인)",
  slack_link_self: "내 슬랙 계정 연결",
  slack_unlink: "슬랙 사람 연결 해제",
  slack_link_code_request: "슬랙 연결 코드 요청",
  slack_connection_broken: "슬랙 발송 중단(토큰 문제)",
  slack_resend: "슬랙 실패 건 다시 보내기",
  makeedu_paid_recovery: "수납 동기화 오류 복구",
  sheets_sync_now: "구글 시트 내보내기 실행",
  // 파일 내보내기 접속기록(보안 감사 2026-09-29) — 원생목록·수납·지출 등 엑셀 다운로드·상담 반출 API. 슬랙으로는 안 나간다(forbid).
  data_export_download: "엑셀 내보내기(파일 받음)",
  intake_push_enqueue: "makeedu 상담 역동기화",
  kiosk_device_register: "키오스크 기기 등록",
  kiosk_device_revoke: "키오스크 기기 폐기",
  kiosk_device_delete: "키오스크 기기 삭제",
  kakao_channel_save: "카카오 알림톡 채널 설정",
  ai_prompt_save: "AI 프롬프트 저장",
  ai_prompt_reset: "AI 프롬프트 기본값 복원",
  // 강사 말투 프로파일(0262a) — AI 산출물의 내용을 바꾸는 갱신이라 cron(주 1회)·[지금 갱신] 둘 다 남긴다.
  ment_style_rebuild: "강사 말투 프로파일 갱신",
  // 직원 포트폴리오(0357a) — [지금 집계]와, 매일 cron이 달을 마감했을 때 남긴다(매일의 재집계는 남기지 않는다).
  teacher_portfolio_refresh: "직원 포트폴리오 집계",
  // 상담 약속·인계(s2_0028 · 2026-11-05 AX 인계본 이식) — 등록·내용 변경·인수 확인·기록 추가·완료 확인·취소. 종류는 metadata.kind(describe.ts가 한글로).
  student_care_save: "상담 약속·인계 처리",
  // 원생 흐름 분석 '다시 분석'(s2_0027 · 명시 버튼 — 유료 AI 호출) — 종류·결과는 metadata(describe.ts가 한글로).
  student_flow_insight_refresh: "원생 흐름 분석 다시 분석",
  student_contribution_refresh: "원생 로열티 집계·마감",
  student_contribution_settings_save: "원생 로열티 배점 저장",
  student_contribution_signal_cancel: "원생 긍정 신호 판정 취소",
  student_contribution_factor_save: "원생 기여 요인 기록",
  student_contribution_signal_rejudge: "원생 긍정 신호 재판정 요청",
  student_contribution_referral_backfill: "지난 원생 소개 연결",
  // 운영 스크립트(원장 지시 · 2026-10-29 "오늘 작업건에 대해선 전부 감사로그 배정여부 체크하고 넣을것") — 행위자 = system:<스크립트>.
  student_history_rebuild: "원생 통계 지난 기록 다시 세기",
  video_unknown_class_fix: "반미정 영상 반 정리",
  student_parent_events_import: "설명회 참석 연결",
  student_parent_events_revoke: "설명회 참석 연결 취소",
  student_contribution_referral_link: "원생 소개 확인·연결",
  student_contribution_summary_generate: "학생 기록 요약 생성",
  // 마감한 달에 바뀐 규칙을 얹음(원장 지시 때만 · 운영 스크립트) — 2026-10-14 강사 탓이 아닌 사유(배정·유지 감점 빼기).
  teacher_portfolio_rule_patch: "직원 포트폴리오 마감 달 규칙 반영",
  // 지난달을 지금 구성으로 처음부터 다시 집계(원장 지시 때만 · 운영 스크립트) — 2026-10-14 "이전 월들도 전부 10월 기준으로".
  teacher_portfolio_recompute: "직원 포트폴리오 지난달 다시 집계",
  // 강사평가 학부모 만족도 — 확인 대기 글 반영·무시 · 반영 취소 · 클레임·칭찬 넣기·취소(원장).
  teacher_evaluation_satisfaction: "학부모 만족도 판정·클레임",
  // 강사평가 설정(0359a) — 지표 켜고 끄기·만점·점수 규칙. 원장만 바꾼다.
  teacher_evaluation_settings_save: "강사평가 설정 저장",
  teacher_evaluation_entries_save: "강사평가 직접 입력 지표 저장",
  // 강사평가 구성 저장·삭제(0360a) — 이름 붙인 구성. 불러오기는 화면에서만 하니 남기지 않는다(점수를 바꾸는 건 설정 저장).
  teacher_evaluation_preset_save: "강사평가 구성 저장",
  teacher_evaluation_preset_delete: "강사평가 구성 삭제",
  classroom_update: "강의실 수정",
  notice_popup_update: "팝업 공지 수정",
  notice_popup_toggle: "팝업 공지 노출 전환",
  consultation_merge: "신규 콜&상담 병합",
  // 등록상담 전수(2026-09-10 원장 *"상담등록에 대해서는 감사로직이 안남나?"*) — QR 접수가 이름·학교·학년
  // 일치로 **다른 아이(동명이인)** 에 자동 연결됐는데, 접수·자동 연결·상태 변경·이름 수정 어느 것도 기록이
  // 없어 누가 무엇을 했는지 되짚을 수 없었다(김근우 건). 자동 연결은 DB 트리거가 직접 쓴다(0258a).
  enrollment_consultation_create: "신규 콜&상담 작성",
  enrollment_consultation_intake: "신규 콜&상담 QR 접수(학부모)",
  enrollment_consultation_update: "신규 콜&상담 수정",
  enrollment_consultation_outcome: "신규 콜&상담 상태 변경",
  enrollment_consultation_delete: "신규 콜&상담 삭제",
  consultation_autolink: "신규 콜&상담 학생 자동 연결",
  consultation_link_existing: "신규 콜&상담 → 기존 학생 재사용",
  consultation_unlink: "신규 콜&상담 학생 연결 해제",
  // (ecs_plan_* 4종은 아래 '진도 줄 구조 변경' 블록 — 같은 날 자리 PIN 감사 세션이 먼저 등록했다.)
  // 세션 없는 경로가 audit_logs에 **직접 insert**하는 키 — 레지스트리 가드가 `log…(` 호출만 봐서 밖이었다.
  calendar_google_import: "구글 캘린더 가져오기",
  calendar_google_push_sync: "구글 캘린더 알림 반영",
  // 2026-09-01 일회성 스크립트가 남긴 행(각 1건) — 코드엔 더 이상 없지만 행이 남아 영문으로 떴다.
  enrollment_create: "수강 등록(스크립트)",
  attendance_update: "출결 수정(스크립트)",
  // 수업보고서 보드 명단 핀(board-roster-actions.ts) — audit_logs에 **직접 insert**라 가드가 못 봤다(아직 행 0건).
  classnote_child_link: "ClassNote 자녀 보드 연결",
  classnote_child_unlink: "ClassNote 자녀 보드 연결 해제",
  // 원장 확인 연결(0185a linked_by='confirmed' · 2026-11-05) — 입소 서류(명부 이름·보호자 전화)만 대조에서 빼는 사람 확인.
  // 손 도구 scripts/_classnote/confirm-child-links.mjs가 직접 insert(넣기 · 되돌리기).
  classnote_child_link_confirm: "ClassNote 원아 연결 원장 확인",
  classnote_child_link_unconfirm: "ClassNote 원아 연결 원장 확인 해제",
  staff_role_change: "역할 변경",
  staff_delete: "직원 삭제",
  // 재직 상태 변경(퇴사·복구·대기) — 2026-09-23 전수 점검 S1 전엔 기록이 한 줄도 안 남았다.
  staff_status_change: "직원 재직 상태 변경",
  // 보호 계정(super_admins 명단) 역할·재직·삭제 시도 — 🔴 화면 문구엔 슈퍼관리자라 쓰지 않는다(위장, displayRoleFor) — 거절됐지만 누가 시도했는지 남긴다(원장 2026-09-30 "강력 가드").
  staff_protected_refused: "보호 계정 변경 거절",
  staff_password_reset: "직원 비밀번호 재설정",
  staff_email_change: "직원 이메일 변경",
  staff_name_change: "직원 이름 변경",
  staff_contract_extend: "근로계약 기입",
  staff_contract_update: "근로계약 수정",
  staff_contract_delete: "근로계약 삭제",
  staff_contract_pdf_extract: "근로계약 PDF 추출",
  staff_contract_file_add: "계약서 파일 첨부",
  class_review_create: "직원 평가 참관 생성",
  class_review_submit: "직원 평가 채점 제출",
  class_review_delete: "직원 평가 삭제",
  class_review_observer_replace: "직원 평가 평가자 변경",
  class_review_final_review: "직원 평가 총평 작성",
  class_review_template_save: "직원 평가 문항 편집",
  class_review_template_delete: "직원 평가 문항 세트 삭제",
  // 운영 스크립트(scripts/staff-access/create-test-staff)가 직접 POST하는 액션 — 서버 액션이 아니라
  // logAction 스캔에 안 잡혀 라벨 없이 영문 "staff_create"가 화면에 그대로 떠 있었다(2026-08-20).
  staff_create: "직원 계정 생성",
  staff_intake_token_create: "직원 등록 QR 생성",
  staff_intake_token_toggle: "직원 등록 QR 열기·닫기",
  staff_intake_token_delete: "직원 등록 QR 삭제",
  staff_create_from_intake: "QR로 직원 등록",
  staff_contract_file_delete: "계약서 파일 삭제",
  // 본인이 자기 계정을 바꾼 경우(/me) — 위의 staff_*(관리자가 남의 계정을 바꿈)와 구분해 읽힌다.
  self_password_change: "내 비밀번호 변경",
  self_email_change: "내 이메일 변경",
  self_report_name_change: "수업보고서 발송용 이름 변경",
  invoice_create: "청구서 생성",
  invoice_manual_void: "수동 청구서 취소",
  invoice_manual_paid: "수동 청구서 완납 처리",
  exam_create: "시험 등록",
  exam_delete: "시험 삭제",
  exam_scores: "성적 일괄입력",
  payroll_upsert: "급여 정산",
  payroll_mark_paid: "급여 지급 완료 처리",
  payroll_auto_compute: "급여 자동 계산 저장",
  // JJ실 시수 넘기기(원장 2026-10-07) — JJ실 기록 한 칸을 한 선생님 몫으로(`taught_by`). 급여가 달라지는 일이라 남긴다.
  payroll_jj_units_take: "JJ실 시수 넘기기(선생님 몫으로)",
  payroll_jj_units_return: "JJ실 시수 되돌리기",
  // 자리(JJ실·랩실) 몫을 수업 몫으로 돌리기(원장 2026-10-07 *"19/5를 20/4로"*, 0355a) — 반 × 달 × 선생님 조정값. 위 두 키의 입구(칸 귀속)는 걷었다.
  payroll_seat_share_set: "자리 몫 조정(수업 몫으로 돌리기)",
  // 선생님별 스위치(0352a) — 켜면 그 선생님 본인 출석부에도 실급여가 보인다. 금액은 남기지 않는다(누구 것을 켰는지·껐는지만).
  payroll_sheet_visible_set: "출석부 합계·실급여 보여주기 설정",
  // 실급여·명세서 대상 학년(원장 2026-10-07 — 고등학생에게만 프리랜서를 적용하는 선생님). 비율 숫자는 남기지 않는다.
  payroll_sheet_levels_set: "실급여·명세서 대상 학년 설정",
  payroll_sheet_special_scope_set: "실급여·명세서 특강 학년 제한 설정",
  // 혼합 계약(근로 + 용역, 원장 2026-10-16)의 근로 요일 — 강사평가 근태가 세는 요일. 금액엔 쓰지 않는다.
  payroll_contract_work_days_set: "혼합 계약 근로 요일 설정",
  class_salary_update: "반별 급여 설정 변경",
  session_splits_save: "강사 분배 스냅샷 저장",
  withdrawal_update: "퇴원 사유",
  withdrawal_consultation_step: "퇴원 상담 추적 체크",
  student_import: "학생 일괄 등록",
  class_end_term: "반 종강 처리",
  class_reopen_term: "반 종강 취소",
  class_archive: "반 폐지",
  class_unarchive: "반 폐지 취소",
  class_handover_schedule: "담임 인수인계 예약",
  class_handover_cancel: "담임 인수인계 취소",
  class_update: "반 정보 수정",
  class_period_enrollments: "운영 기간에 맞춰 수강 종료일 조정",
  class_schedule_move: "반 배치 이동(시간표)",
  class_handover_apply: "담임 인수인계 적용",
  class_handover_bulk: "담임 일괄 인계(퇴사)",
  class_delegate: "반 임시 위임(결근 대체)",
  class_delegate_revoke: "반 임시 위임 해제",
  classroom_auto_assign: "강의실 자동배정",
  owner_settings_update: "학원 설정 변경",
  owner_subject_absorb: "과목 흡수·삭제",
  owner_subject_delete: "과목 삭제(미사용)",
  owner_integration_groups_update: "통합뷰 그룹 설정",
  owner_teacher_view_order_update: "강사뷰 강사 순서",
  notice_popup_create: "팝업 공지 생성",
  notice_popup_delete: "팝업 공지 삭제",
  classroom_create: "강의실 추가",
  classroom_delete: "강의실 삭제",
  classroom_archive: "강의실 숨김",
  classroom_restore: "강의실 복원",
  intake_token_create: "QR 접수 링크 생성",
  intake_token_toggle: "QR 접수 링크 열기·닫기·만료일",
  intake_token_delete: "QR 접수 링크 삭제",
  resume_view_unlock: "이력서 열람(재인증)",
  staff_create_from_resume: "이력서 → 직원 등록",
  staff_link_from_resume: "이력서 → 직원 연결",
  staff_roster_import: "직원명부 시트 이관",
  staff_roster_import_revert: "직원명부 이관 되돌림",
  classnote_notice_send: "학부모 공지 발송",
  classnote_notice_edit: "학부모 공지 수정",
  classnote_notice_delete: "학부모 공지 삭제",
  classnote_notice_revoke: "학부모 공지 게시취소",
  classnote_report_recall: "수업보고서 회수",
  // 지금 반 보드 동기화(0313a, 2026-09-30) — 요청(사람)과 실행 결과(연동 PC가 직접 insert, 실행자 system:classnote-sync-now)를 따로 남긴다.
  classnote_board_sync_request: "반 보드 지금 동기화 요청",
  // 반 보드 동기화 보고서(0329a) — 변동·실패·보류와 전 반의 해제 대상을 txt로 내려받음.
  classnote_board_sync_report_export: "반 보드 동기화 보고서 내려받기",
  // 연동 PC 워커가 직접 남기는 것 — 매일 정기 동기화 한 회차 · 동기화가 원아를 반 보드에 배정함(학생 기록).
  classnote_board_sync_daily: "반 보드 정기 동기화",
  classnote_board_enroll: "ClassNote 반 보드 배정",
  classnote_board_release: "ClassNote 반 보드 원아 해제",
  classnote_board_teacher_release: "ClassNote 반 보드 담임 해제",
  // 전 과목 퇴원 45일 뒤 ClassNote 명부 퇴원처리(퇴소, 원장 2026-11-03) — 연동 PC 워커가 학생 단위로 직접 남긴다(직전 글 목록 백업 위치 포함).
  classnote_offboard: "ClassNote 명부 퇴원처리(연동 PC)",
  // 퇴소를 요청했는데 명부로 확인하지 못한 원아 — 결과와 무관하게 남긴다(재원 명부엔 없는데 퇴소 명부에 없음 · 확인 조회 실패 · 그대로 남음).
  classnote_offboard_unconfirmed: "ClassNote 명부 퇴원처리 요청(확인 실패 · 연동 PC)",
  classnote_board_sync_run: "반 보드 지금 동기화 실행(연동 PC)",
  // 학부모 글·댓글 답글(0317a) — 앱이 요청·수정·삭제를 남기고, 연동 PC 워커가 ClassNote 반영 결과를 직접 남긴다.
  classnote_parent_reply_request: "학부모 글 답글 요청",
  classnote_parent_reply_edit_request: "학부모 글 답글 수정 요청",
  classnote_parent_reply_delete_request: "학부모 글 답글 삭제 요청",
  classnote_parent_reply_run: "학부모 글 답글 ClassNote 반영(연동 PC)",
  // 학부모 글·댓글 공감(0319a) — 답글과 같은 모양(앱이 누르기·풀기 요청을, 연동 PC 워커가 ClassNote 반영 결과를 남긴다).
  classnote_parent_reaction_request: "학부모 글 공감 요청",
  classnote_parent_reaction_remove_request: "학부모 글 공감 풀기 요청",
  classnote_parent_reaction_run: "학부모 글 공감 ClassNote 반영(연동 PC)",
  ecs_attendance_clear: "출석 취소(ECS)",
  operating_periods_save: "세션 기간 저장",
  calendar_event_create: "일정 등록",
  calendar_event_update: "일정 수정",
  calendar_event_delete: "일정 삭제",
  calendar_tag_create: "캘린더 태그 추가",
  calendar_tag_update: "캘린더 태그 수정",
  calendar_tag_delete: "캘린더 태그 삭제",
  approval_submit: "전자결재 기안",
  approval_decide: "전자결재 처리",
  approval_withdraw: "전자결재 회수",
  approval_comment: "전자결재 댓글",
  approval_comment_delete: "전자결재 댓글 삭제",
  work_request_create: "업무 요청",
  work_request_act: "업무 요청 처리",
  // 연차 조정(0252a) — 결재 문서가 아니라 **자격(부여 일수)** 을 바꾸는 행위라 별도 키다.
  // 남의 연차를 늘리고 줄이는 일이라 누가·언제·왜가 반드시 남아야 한다.
  leave_adjust: "연차 조정",
  leave_adjust_delete: "연차 조정 취소",
  // 교재 신청 전수 감사(2026-09-09) — 단가표 23,500원 교재가 신청서엔 22,500원으로 적혀 있었는데
  // *"범인 찾기가 실패하네"*(원장). `textbook_orders`를 바꾸는 경로 일곱이 기록을 한 줄도 안 남기고 있었다.
  // 금액은 신청 시점 **스냅샷**이라 단가표를 따라가지 않는다 → "왜 다른가"의 답은 누가 언제 고쳤나뿐이다.
  textbook_order_create: "교재 신청 등록",
  textbook_order_update: "교재 신청 수정",
  textbook_order_delete: "교재 신청 삭제",
  textbook_order_check: "교재 처리 상태 변경",

  // 학생 기록 변경 전수 감사(2026-08-18) — "퇴원을 누가 했는지 역검수가 안 된다"(원장). 상태 전환·정보
  // 수정·삭제·수강 종료·관리 도구 일괄 처리까지 **학생 레코드를 바꾸는 모든 경로**가 actor를 남긴다.
  student_create: "학생 등록",
  student_update: "학생 정보 수정",
  student_english_name_update: "학생 영문 이름 수정",
  student_siblings_update: "원생 형제 지정",
  student_delete: "학생 영구 삭제",
  student_withdraw: "학생 퇴원 처리",
  // 퇴원보고서를 거치지 않은 퇴원·새 퇴원 예약 — DB 트리거(0454a)가 남긴다(막지 않고 원장에게 알림). 상세 = describe.ts.
  student_withdrawn_without_report: "퇴원보고서 없이 퇴원(경고)",
  // 옛 퇴원 기록의 빈 사유를 원장 승인 행만 채운다(2026-10-26 크레딧 MVP 적용 스크립트 — scripts/_oneoff/ai-credit-mvp/withdrawals/apply.mjs).
  withdrawal_reason_restore: "퇴원 사유 복원(옛 기록)",
  student_hold: "학생 휴원 처리",
  student_restore: "학생 재원 복구",
  enrollment_end: "수강 종료",
  enrollment_hold: "수강 대기 전환",
  enrollment_resume: "수강 대기 해제",
  enrollment_delete: "수업 이력 삭제",
  student_bulk_withdraw: "학생 일괄 퇴원(데이터 정리)",
  student_bulk_delete: "학생 일괄 삭제(데이터 정리)",
  // 퇴원 학생에게 남은 수강을 한꺼번에 닫는 정리 도구 — 수강 기록을 여러 건 바꾸는데 무기록이었다(2026-10-06).
  enrollment_orphan_close: "퇴원 학생의 남은 수강 일괄 종료(데이터 정리)",
  // 신규생 체크리스트(2026-09-09) — 칸 하나가 "학부모에게 전화했다"는 **사실 주장**이라, 나중에
  // "안 왔다는데 콜은 했다고 돼 있네"를 되짚을 수 있어야 한다. 해제도 함께 남긴다(그쪽이 더 중요한 흔적).
  newcomer_check: "신규생 체크 완료",
  newcomer_uncheck: "신규생 체크 해제",
  // 2차 확장(2026-08-18 원장 "모든 행동에 기록이 남도록 범인 찾기 가능하게") — 수강을 바꾸는 나머지 경로.
  enrollment_assign: "반 배정",
  enrollment_move: "반 이동",
  enrollment_move_batch: "반 이동(시간표 일괄)",
  // 예약된(아직 시작 안 한) 수강 변경을 배너에서 고치거나 되돌린 기록 — 되돌릴 수 없는 이력이 아니라
  // "누가 언제 예약을 손댔나"의 역검수용이다(학생 기록을 바꾸는 경로는 전부 감사로그를 남긴다).
  enrollment_reschedule: "예약 변경(날짜·반)",
  enrollment_schedule_cancel: "예약 취소",
  enrollment_days_update: "등원 요일 수정",
  // LAB '따로 수업(*LAB)' 학생 배정(0271b, 원장 2026-09-17) — 날짜 없이 즉시 적용이라 이력은 여기뿐이다.
  enrollment_lab_separate: "따로 수업(*LAB) 배정",
  enrollment_dates_update: "수강 기간 수정",
  student_merge: "학생 병합",
  student_dup_confirm: "동명이인 정상 확인",
  // 보강 빼기(2026-08-18) — 출결 보강 칸 + 저장된 보강 보고서를 지우는 경로. 기록을 없애는 동작이라
  // 누가 지웠는지가 특히 중요하다(원장 "다 삭제" 지시로 보고서 삭제까지 열렸다).
  makeup_remove: "보강 빼기(출결·보고서 삭제)",
  makeup_class_change: "보강 반 바꾸기(보고서·출석부 칸 함께)",
  // 셔틀(0225a, 원장 2026-08-19) — 편성은 학생 등하원 동선이라 "누가 언제 뺐는지"가 사고 시 유일한
  // 역검수 근거다(정류장을 노선에서 빼면 배정 학생이 함께 사라진다). 등하원 기록도 남긴다.
  shuttle_stop_create: "셔틀 정류장 추가",
  shuttle_stop_update: "셔틀 정류장 수정",
  shuttle_stop_archive: "셔틀 정류장 정리",
  shuttle_vehicle_create: "셔틀 차량 추가",
  shuttle_vehicle_update: "셔틀 차량 수정",
  shuttle_run_create: "셔틀 회차 추가",
  shuttle_run_update: "셔틀 회차 수정",
  shuttle_run_delete: "셔틀 회차 삭제",
  shuttle_run_stop_add: "셔틀 노선에 정류장 추가",
  shuttle_run_stop_remove: "셔틀 노선에서 정류장 제거",
  shuttle_rider_assign: "셔틀 학생 배정",
  shuttle_rider_move: "셔틀 학생 정류장 이동",
  shuttle_rider_remove: "셔틀 학생 배정 해제",
  shuttle_boarding_record: "셔틀 등하원 기록",
  shuttle_boarding_clear: "셔틀 등하원 기록 삭제",
  shuttle_ride_exception_set: "셔틀 일회성 탑승 변경",
  shuttle_ride_exception_clear: "셔틀 일회성 탑승 변경 되돌림",
  shuttle_trip_start: "셔틀 운행 출발",
  shuttle_trip_end: "셔틀 운행 종료",
  shuttle_trip_reopen: "셔틀 운행 종료 되돌림",
  shuttle_stop_location: "셔틀 정류장 위치 지정",
  // 변경 내역 확인(0323a) — 화면에서만 내리고 장부는 그대로. 누가 무엇을 내렸는지의 역검수 근거.
  shuttle_history_ack: "셔틀 변경 내역 확인",
  // 학부모 계정(0320a) — 원장·관리자 전용. 로그인 계정을 만들고 지우는 일이라 역검수 근거를 남긴다.
  parent_account_create: "학부모 계정 발급",
  parent_account_delete: "학부모 계정 삭제",
  // '다른 강사 뷰'(열람 전용, 2026-08-19) — 누가 누구의 강사뷰를 열람했는지. 대상 강사에겐 안 보이는
  // 기능이라(원장 지시) 이 로그가 유일한 역검수 근거다.
  teacher_view_impersonate: "다른 강사 뷰 열람",
  staff_teacher_view_access: "강사뷰 접근 토글 변경",
  // 🔴 **화면 글자만** 바뀐다 — 담임·원어민 판정과 무관한 축이다(0248a 주석).
  staff_teacher_view_lang: "강사 화면 기본 언어 변경",
  // 회의록(2026-08-25 원장 제보 "감사로그에 녹음 관련 이력이 하나도 없다") — 빠뜨린 게 아니라
  // **처음부터 배선이 없던 영역**이었다(액션 9개 중 logAction 0). 🔴 특히 meeting_delete는 녹음·전사·
  // AI 분석이 통째로 사라지는데 누가 지웠는지 역추적할 방법이 0이었다(학생 퇴원 사고와 같은 모양).
  // 전사·재분석 재실행은 외부 API를 다시 태우는 일(비용)이라 반드시 남긴다.
  // ⚠️ 메모장 저장(updateMeetingNotepad)은 **일부러 안 남긴다** — 글 쓰는 중 반복해서 눌리는 칸이라
  //    남기면 감사로그가 그 한 사람 타이핑으로 뒤덮여 정작 삭제 같은 줄이 묻힌다.
  meeting_create_audio: "회의 녹음 업로드",
  // 녹음 중단 진단(원장 2026-10-29 "회의록이 강제로 종료된건 이유 체크") — 회의·상담 녹음 하나에 한 줄. src/lib/recording-diagnostics-core.ts
  recording_interrupted: "녹음 중단",
  meeting_create_text: "회의록 작성(메모)",
  meeting_delete: "회의록 삭제",
  meeting_retry_transcribe: "회의 전사 다시 실행",
  meeting_regenerate_analysis: "회의 AI 분석 다시 생성",
  meeting_title_update: "회의록 제목 수정",
  meeting_speakers_update: "회의 화자·직원 연결",
  meeting_report_edit: "회의 AI 리포트 수정",
  // 학생상담(같은 배선 누락, 액션 5개 중 0) — 위 consultation_merge(등록상담 병합)와 다른 화면이라
  // student_ 접두로 갈라 둔다. AI 케어 분석은 유료 호출이라 회의 재분석과 같은 결로 남긴다.
  student_consultation_create: "학생상담 기록 작성",
  student_consultation_update: "학생상담 기록 수정",
  student_consultation_delete: "학생상담 기록 삭제",
  student_consultation_follow_up: "학생상담 후속조치 처리",
  // makeedu 동기화 워커·운영 스크립트가 직접 insert(scripts/_makeedu/sync-consultations-incremental.cjs · scripts/_oneoff/backfill-consultation-subjects.mjs).
  student_consultation_sync_import: "학생상담 makeedu 동기화",
  student_consultation_subject_backfill: "학생상담 과목·상담사 채우기",
  // 0318a 반 매핑 백필(scripts/_oneoff/backfill-consultation-classes.mjs --apply).
  student_consultation_class_backfill: "학생상담 반 채우기",
  student_care_analysis: "AI 케어 분석 실행",
  // 시간표(개발중) 월별 계획(0232a) — ⚠️ 화면은 2026-10-23 코드째 지웠다. 라벨만 남긴 것은 그렇게 남은 과거 기록을
  // 읽기 위해서다(침산 감사로그 2건 08-31 · 꺼 둔 슬랙 규칙 1개가 이 키 여섯을 골라 둠 — 지우면 영문 키가 그대로 뜬다).
  // 새로 남는 일은 없다. "계획"이라는 말은 남길 것(본 시간표가 바뀐 줄로 읽히면 안 된다).
  timetable_plan_seed: "시간표 계획 만들기(현재 시간표 복사 · 지금은 없는 기능)",
  timetable_plan_copy: "시간표 계획 달 복사(지금은 없는 기능)",
  timetable_plan_month_delete: "시간표 계획 달 삭제(지금은 없는 기능)",
  timetable_plan_slot_upsert: "시간표 계획 칸 저장(지금은 없는 기능)",
  timetable_plan_slot_delete: "시간표 계획 칸 삭제(지금은 없는 기능)",
  timetable_plan_sheet_import: "시간표 계획 시트에서 가져오기(지금은 없는 기능)",
  // 시간표 연습실 — 작성자만 보는 개인 사본(timetable_lab_drafts)이라 운영 시간표는 안 바뀐다.
  // 라벨에 "연습본"을 반드시 남길 것(위 '계획'과 같은 이유) · 슬랙으로는 안 나간다(activity-catalog forbid).
  timetable_lab_draft_save: "시간표 연습본 저장",
  // 덮어쓰기·삭제는 되돌릴 수 없어 이전 저장자·규모를 metadata에 남긴다(시간표 내용은 싣지 않는다).
  timetable_lab_draft_overwrite: "시간표 연습본 덮어쓰기",
  timetable_lab_draft_delete: "시간표 연습본 삭제",
  // 연습본을 운영에 나중에 적용하도록 예약 · 그 예약 취소(즉시 적용은 timetable_structure_apply로 남는다).
  timetable_lab_apply_schedule: "시간표 연습본 적용 예약",
  timetable_lab_apply_cancel: "시간표 연습본 적용 예약 취소",
  // 시간표 오른쪽 메모 시트(엑셀 판) — 자동 저장이라 같은 사람이 10분 안에 또 저장하면 한 줄로 친다(timetable-memo/server/actions.ts).
  timetable_memo_sheet_save: "시간표 메모 시트 저장",
  // 영어 강사뷰 칸 메모(0395a) — 수정·삭제는 이전 내용(metadata.before)을 남긴다. 같은 사람이 이어 고치는 자동 저장은 10분에 한 줄.
  timetable_cell_memo_add: "시간표 칸 메모 추가",
  timetable_cell_memo_update: "시간표 칸 메모 수정",
  timetable_cell_memo_delete: "시간표 칸 메모 삭제",

  // 수학 강사 시트(MCS) — 학생별 월간 목표. 실제 진도는 원스크린이 쓰므로 여기 안 온다(읽기 전용 화면).
  mcs_goal_update: "수학 시트 학생 월간 목표 저장",
  mcs_learning_goal_save: "수학 시트 전체 목표 저장",
  mcs_learning_goal_revise: "수학 시트 남은 계획 수정",
  mcs_learning_goal_reset: "수학 시트 전체 목표 초기화",
  // 칸을 떠날 때 전후 값 한 줄(원장 결정 2026-09-14, `math-sheets/server/goal-audit-actions.ts`). 위 키는 옛 행과
  // '지난 달 목표 가져오기'(한 번 누름) 표시용으로 남는다 — 저장 액션은 더 이상 디바운스마다 남기지 않는다.
  mcs_goal_edit: "수학 시트 학생 월간 목표 수정",
  // 반의 수업 유형(정규 진도 / 복습 심화) — 화면 문구(`learning-overview.tsx`)와 같은 말로 적는다.
  mcs_class_learning_track: "수학 시트 반 수업 유형 변경",

  // 재고관리(0242a) — 자산 등록/수정/상태 · 대여 시작/반납 · 실사 기록 · 소모품 수량. 상세는 describe.ts.
  inventory_asset_create: "자산 등록",
  inventory_asset_update: "자산 수정",
  inventory_asset_status: "자산 상태 변경",
  inventory_loan_out: "자산 대여 시작",
  inventory_loan_return: "자산 반납",
  inventory_audit: "자산 실사 기록",
  inventory_asset_holder: "자산 사용자 지정",
  inventory_asset_delete: "자산 삭제",
  inventory_loan_update: "자산 대여 수정",
  inventory_loan_delete: "자산 대여 삭제",
  inventory_audit_update: "자산 실사 수정",
  inventory_audit_delete: "자산 실사 삭제",
  inventory_supply_update: "소모품 수정",
  inventory_supply_create: "소모품 등록",
  inventory_supply_delete: "소모품 삭제",
  inventory_vendor_create: "업체 등록",
  inventory_vendor_update: "업체 수정",
  inventory_vendor_delete: "업체 삭제",
  inventory_vendor_excel_import: "업체리스트 엑셀 반영",
  inventory_excel_import: "재고관리 엑셀 반영",
  // 공용 엑셀 가져오기(원장 2026-09-29) — 원생·직원·반·상담·출결·수납 등 탭마다의 '엑셀로 넣기'가 이 한 동작으로 남는다.
  excel_import: "엑셀 가져오기",
  // 분류(0247a) — 엑셀에 없는 분류를 적으면 확인 뒤 자동으로 만들어진다(삭제·이름변경 경로는 아직 없다).
  inventory_category_create: "자산 분류 추가",

  // 교재목록(0266a) — 교재 마스터·차수 표·표지 · 반 배정과 차수 기입. 상세는 describe.ts.
  // 🔴 기입(`textbook_plan_apply`)은 **그 반의 ECS 계획 줄을 바꾸는 행위**라 반드시 남긴다 —
  //    "누가 이 반 시트에 이 교재를 통째로 넣었는지"를 역검수할 수 있어야 한다.
  textbook_create: "교재 등록",
  textbook_update: "교재 수정",
  textbook_delete: "교재 삭제",
  // ⚠️ 폐지(감추기)는 **폐기된 경로**다(원장 2026-09-16 *"여기 폐지말고 삭제로 변경"*) — 라벨만 남긴 것은
  //    그렇게 남은 과거 기록 1건(제목 `테스트`)을 읽기 위해서다. 새로 남는 일은 없다.
  textbook_retire: "교재 폐지(지금은 없는 기능)",
  textbook_lessons_save: "교재 차수 저장",
  textbook_cover_set: "교재 표지 등록",
  textbook_cover_clear: "교재 표지 삭제",
  textbook_plan_create: "반 교재 배정",
  textbook_plan_update: "반 교재 배정 수정",
  textbook_plan_delete: "반 교재 배정 삭제",
  // 되돌리기(원장 2026-10-19) — 지운 배정과 함께 지운 진도 줄·표식을 되살린다.
  textbook_plan_delete_undo: "반 교재 배정 삭제 되돌리기",
  textbook_plan_apply: "교재 차수 배정·기입", // 2026-09-23 [기입] 제거 후엔 배정 저장이 이 키로 남는다(옛 행은 기입)
  // 가져오기(원장 2026-09-22) — 월간계획 한 칸을 **실제**로 옮긴 기록. 작성률을 움직이는 행위라 남긴다.
  textbook_plan_import: "월간계획 가져오기",
  // 되돌리기(원장 2026-10-15) — 가져온 뒤 손대지 않은 칸만 원래대로. 실제 진도를 지우는 행위라 남긴다.
  textbook_plan_import_undo: "월간계획 가져오기 되돌리기",
  math_textbook_assign: "수학 교재 배정",
  math_book_target: "수학 목표 교재 변경",
  school_exam_periods: "학교별 내신기간 저장",
  // 회차 미루기·당기기(0282a) — 그 칸의 차수를 건너뛰거나 버린다. 앞으로의 계획을 통째로 바꾸는 결정이라 남긴다.
  textbook_lesson_shift: "수업 회차 미루기·당기기",
  // 되돌리기(원장 2026-10-19 "덮어쓰기(되돌리기)") — 누르기 전 줄을 그대로 돌려놓는다. 실제 진도를 다시 쓰는 행위라 남긴다.
  textbook_lesson_shift_undo: "수업 회차 미루기·당기기 되돌리기",

  // ── 2026-09-09 전수 보강 ────────────────────────────────────────────────────
  // 원장 지시: *"기능이 추가되거나 변동되는건 모두 감사로그에 남도록 해야함."* 2026-08-18 소급 퇴원
  // 사고 뒤 붙인 감사로그가 **학생 레코드 경로에만** 걸려 있어서, 그 뒤 만들어진 기능 20여 개는 흔적이
  // 0이었다(출결 일괄 변경·수업보고서·지출·급여명세서·서식 삭제·시간표 가져오기…).
  // 🔴 여기 라벨이 없으면 원장 화면에 **영문 키가 그대로** 뜬다(그래서 이 표를 가드가 잠근다).

  // 출결 — 🔴 `metadata.backdated`가 참이면 **지난 날짜 소급**이다(2026-08-18 사고와 같은 모양).
  attendance_save: "출석부 반별 저장",
  attendance_cell: "출결 입력·정정",
  attendance_clear: "출결 지우기",
  attendance_note: "출결 메모 수정",
  attendance_bulk: "출결 일괄 입력",
  attendance_range: "출결 범위 채우기",
  attendance_range_clear: "출결 범위 지우기",
  // 보강 예약(0264a, 원장 2026-09-14) — 예약·취소는 사람이, 이행은 보강일 출결 저장이 남긴다.
  makeup_reserve: "보강 예약",
  makeup_reserve_cancel: "보강 예약 취소",
  makeup_reserve_done: "보강 예약 이행",
  makeup_reserve_revert: "보강 예약 되돌림",
  // 원스크린 보강 보고서 합치기 ↔ 나누기(원장 2026-10-22) — 예약 줄의 발송 방식을 함께 바꾼다.
  makeup_reserve_report_mode: "보강 예약 보고서 방식 변경",
  // 원스크린 '보강 합치기'가 다른 반에 기록된 예약을 그날 정규 반으로 옮겼다(원장 2026-10-27 박지호 건).
  makeup_reserve_host_move: "보강 예약 정규 반으로 옮김",
  // 원스크린 보강 표식의 '보강 했음 / 보강 못 했음'(원장 2026-10-27 — 확인 전엔 보고서를 보내지 않는다).
  makeup_reserve_check: "보강 진행 여부 확인",
  attendance_makeup_link: "보강–결석분 연결",
  // 수학 자동 시수(원장 2026-09-11 "9월분만 보정") — scripts/_oneoff/backfill-math-auto-units.mjs가 --apply 때 한 줄 남긴다.
  attendance_units_backfill: "수학 출석 시수 자동값 소급 보정",
  attendance_followup: "출결 확인 기록",
  attendance_input_request: "출결 입력 요청",
  attendance_desk_confirm_request: "데스크 확인 요청",
  // 자리(랩실·JJ실) 출결. ⚠️ 아래 셋은 **중첩 삼항**으로 만들어져 레지스트리 스캐너가 못 잡는다 —
  //    가드를 믿고 빠뜨리지 말 것(그래서 이 주석을 남긴다).
  seat_attendance_set: "자리 출결 입력",
  seat_attendance_clear: "자리 출결 지우기",
  seat_attendance_note: "자리 결석 사유 수정",
  seat_attendance_fill: "자리 출결 일괄",
  seat_attendance_fill_prev: "자리 출결 앞 교시 결석 일괄",
  // 자리 **배치**(드래그로 옮긴 자리, 0254a) — 출결과 다른 축이라 라벨도 갈라 적는다. 되돌리기는
  // 반별·전체·학생 한 명이 **같은 키**를 쓰고 `metadata.scope`로 구분된다.
  seat_placement_move: "자리 이동(드래그)",
  seat_placement_reset: "자리 이동 초기화",

  // 자리 **교시 선택**(0255a) — 하루에 자리 수업이 두 번 있는 반에서 "이 학생은 어느 쪽인가".
  // 🔴 배치(위)와 다른 축이다: 저쪽은 같은 교시의 **반 묶음**, 이쪽은 같은 반의 **교시**.
  seat_period_move: "자리 교시 이동(오늘)",
  seat_period_pin: "자리 교시 고정(상시)",
  seat_period_clear: "자리 교시 지정 해제",

  // 수업보고서·발송 — 학부모에게 **나간 것**이라 되짚기가 가장 절실하다.
  lesson_report_save: "수업보고서 저장",
  // 영상 제출 현황(장부)에서 회차 한 칸을 찍음 — 완료·미수행·미확인으로 되돌림(원장 2026-10-01).
  lesson_report_video_homework_mark: "영상 과제 제출 기록",
  // 영상 제출 현황의 '숙제없음' 칸에서 그 날짜의 영상 숙제를 뒤늦게 냄(보고서 없이) · 그 숙제를 거둠(원장 2026-10-13).
  lesson_report_video_homework_issue: "영상 숙제 따로 내기",
  lesson_report_video_homework_issue_cancel: "따로 낸 영상 숙제 취소",
  // 영상 숙제를 거둠 — 미확인 · 미수행만 · 보고서를 보낸 숙제도(그날 보고서의 영상 과제 → 없음, 원장 2026-10-16).
  lesson_report_video_homework_cancel: "영상 숙제 취소",
  lesson_report_video_homework_reject: "영상 숙제 영상 반려",
  share_link_revoke: "학부모 공유 링크 회수",
  share_link_reissue: "학부모 공유 링크 재발급",
  // 숙제 영상 제출 링크(0325a) — 발급(학생 상세 복사·수업보고서 글) · 끊기 · 학부모 업로드 완료.
  lesson_report_video_link_issue: "영상 제출 링크 발급",
  lesson_report_video_link_revoke: "영상 제출 링크 끊기",
  lesson_report_video_link_upload: "영상 제출 링크로 영상 올림",
  report_attachment_add: "수업보고서 첨부 추가",
  report_attachment_remove: "수업보고서 첨부 삭제",
  report_covers_date: "수업보고서 대상일 변경",
  classnote_send: "ClassNote 발송",
  classnote_resend: "ClassNote 재발송",
  classnote_bulk_send: "ClassNote 일괄 발송",
  classnote_stuck_reset: "ClassNote 멈춘 발송 초기화",
  class_sheet_plan_line: "수업계획 줄 변경",
  class_sheet_plan_copy: "수업계획 이전 회차 복사",
  // 진도 줄 구조 변경 — `plan-write.ts` `logPlanChange`가 **실제로 쓰는** 키(위 둘은 옛 키 — 옛 행 표시용으로 남긴다).
  // 🔴 등록이 빠져 감사 화면에 영문 키가 그대로 떴다(적대적 리뷰 2026-09-10) — 스캐너가 이제 첫 인자 리터럴도 본다.
  ecs_plan_line_add: "수업계획 줄 추가",
  ecs_plan_line_move: "수업계획 줄 이동",
  ecs_plan_line_delete: "수업계획 줄 삭제",
  ecs_plan_copy: "수업계획 지난 회차 복사",
  // 강사 시트 칸 편집 — **칸을 떠날 때 한 줄**(원장 결정 2026-09-14, `class-sheets/server/edit-audit-actions.ts`).
  // 타이핑 중 자동저장은 안 남긴다. Shouting 체크·MP 열/휴강 토글은 누름이 곧 결심이라 그 저장 액션이 직접 한 줄.
  ecs_goal_edit: "강사 시트 목표 수정",
  ecs_mark_edit: "강사 시트 학생 기록 수정",
  ecs_memo_edit: "강사 시트 메모 수정",
  ecs_month_plan_edit: "월간 계획서(MP) 수정",
  ecs_shouting_toggle: "Shouting 체크 변경",
  // 범위 확대(같은 날) — 계획 줄 칸(교재·진도·과제…, 로그인·공개 PIN 두 문 `plan-edit-audit.ts`) ·
  // 자리 출석부 JJ 칸(`mark-actions.ts` `commitSeatJjEdits`, PIN이면 문 이름).
  ecs_plan_cell_edit: "수업계획 칸 수정",
  seat_jj_mark_edit: "자리 출석부 JJ 칸 수정",
  seat_jj_memorized_pull: "자리 출석부 단어수 가져오기(SRS)",
  // 강사 시트(수업계획서)에서 누른 한 번 — 자리 출석부 버튼과 같은 일이지만 **어느 화면에서 눌렀나**가 다르다.
  ecs_memorized_pull: "강사 시트 단어수 가져오기(SRS)",

  // 돈 — 🔴 **금액은 담지 않는다**(아래 '금액' 주석 참조).
  expense_create: "지출결의서 작성",
  expense_update: "지출결의서 수정",
  expense_delete: "지출결의서 삭제",
  expense_approval: "지출 결재 체크·해제",
  expense_duplicate: "지출결의서 복제",
  expense_receipt_type: "지출 증빙 유형 변경",
  expense_receipt_add: "지출 증빙 첨부",
  expense_receipt_remove: "지출 증빙 삭제",
  refund_request_create: "환불 요청서 작성",
  refund_request_update: "환불 요청서 수정",
  refund_request_delete: "환불 요청서 삭제",
  // 퇴원보고서에 이어진 요청서의 환불완료일자를 담당 데스크·원장이 아닌 사람이 넣거나 지우려다 막힘(2026-11-06 · DB 트리거도 같은 판정).
  refund_request_complete_denied: "환불완료일자 입력 거절",
  // 퇴원보고서에 이어진 환불 요청서의 수정·삭제 거절(리뷰 r2 I6·B1 · 원장 결정 2026-11-09) — 담당 데스크(재직)·원장만 · 상한(원장 승인 줄 낸 돈 합) 넘김.
  refund_request_linked_denied: "이어진 환불 요청서 수정·삭제 거절",
  textbook_notice_send: "교재 요청서 학부모 발송",
  session_terms_refresh: "청구 회차 계획 갱신",
  // 출석부 줄인데 회차 행이 없던 학생 — 확정·배분을 저장하는 순간 행이 생긴다(`term-materialize.ts`, 원장 2026-09-18).
  session_term_create: "청구 회차 행 생성(출석부 줄에 맞춤)",
  session_term_confirm_class: "청구 회차 반 일괄 확정",
  session_term_confirm: "청구 회차 확정",
  session_term_confirm_selected: "청구 회차 선택 일괄 확정",
  session_term_monthly_units: "월 정액 수업 시수 수정",
  session_term_receipt_allocate: "수납 청구액 반별 배분",
  session_term_receipt_allocate_free: "수납 자유 배분(관리자)",
  session_term_receipt_allocate_auto: "수납 배분 자동 재확정(시수 확정 뒤)",
  session_term_unconfirm: "청구 회차 확정 해제",
  session_term_delete: "청구 회차 삭제",
  session_term_unconfirm_class: "청구 회차 반 전체 확정 해제",
  session_term_carryover: "청구 회차 이월",
  session_term_money_carryover: "청구 회차 금액 이월",
  session_term_money_carryover_cancel: "청구 회차 금액 이월 취소",
  // 받은 금액 이월만큼 확정 시수를 자동으로 올림(원장 2026-10-07) — 사람이 '해제 → 시수 고침 → 다시 확정'하던 일.
  session_term_carry_sync: "확정 시수 자동 조정(받은 금액 이월 반영)",
  // 받은 이월을 다음 달로 다시 넘기며 확정 시수를 낮춤(이월 창 · 원장 2026-11-09) — 사람이 한 일.
  session_term_carry_unreflect: "확정 시수 낮춤(받은 이월 다시 넘기기)",
  session_term_note: "청구 회차 메모 수정",
  // 🔴 급여는 **"무슨 일이 있었나"만** 남긴다 — 조정한 항목 이름조차 안 담는다("인센티브를 고쳤다"
  //    만으로도 그 사람 급여 사정이 읽힌다). metadata는 `{userId, period}`뿐이다.
  payslip_adjust: "급여명세서 조정 저장",
  payslip_issue: "급여명세서 발행",
  payslip_unissue: "급여명세서 발행 취소",

  // 서식·분류·알림·업무
  document_create: "서식 등록",
  document_update: "서식 수정",
  document_delete: "서식 삭제",
  document_pin: "서식 상단 고정 전환",
  document_category_create: "서식 분류 추가",
  document_category_rename: "서식 분류 이름 변경",
  document_category_move: "서식 폴더 위치·순서 변경",
  document_category_delete: "서식 분류 삭제",
  retention_action_create: "이탈 방어 조치 기록",
  retention_campaign_add: "재등록 캠페인 추가",
  retention_campaign_status: "재등록 캠페인 상태 변경",
  retention_campaign_remove: "재등록 캠페인 제외",
  notion_task_done: "Notion 업무 완료 전환",
  notion_task_due_move: "Notion 업무 마감일 이동",
  notion_task_create: "Notion 업무 생성",
  notion_task_comment: "Notion 업무 댓글",
  staff_notion_map: "Notion 계정 연결 변경",

  // 시간표 가져오기 — 한 번에 수백 슬롯·수강을 바꾼다. metadata의 `snapshotId`가 되돌릴 근거다.
  timetable_import_apply: "시간표 가져오기 반영",
  timetable_structure_apply: "영어 시트 구조 반영",
  timetable_structure_rollback: "영어 시트 구조 되돌림",
  timetable_import_cancel: "시간표 가져오기 예약 취소",

  // 공지·브리핑
  announcement_create: "직원 공지 등록",
  announcement_update: "직원 공지 수정",
  announcement_delete: "직원 공지 삭제",
  announcement_pin: "직원 공지 고정 전환",
  briefing_regenerate: "일일 브리핑 다시 생성",
  // 운영실 계기판 '업무 비서' — 사람이 'AI로 정리'를 눌러 유료 AI를 태운 경로(예약 정리는 사람이 한 일이 아니라 남기지 않는다).
  dashboard_secretary_run: "업무 비서 AI 정리",
  // 학원 비서(원장 자연어 질의 · 2026-11-06) — 질문마다 유료 AI와 지점 DB 조회를 태운다.
  assistant_ask: "학원 비서 질문",
  assistant_thread_delete: "학원 비서 대화 삭제",
  assistant_thread_rename: "학원 비서 대화 이름 변경",
  assistant_advice_update: "학원 비서 의견 처리",
  assistant_advice_outcomes: "학원 비서 의견 결과 재측정",

  // 인재원 학습 프로그램 짝(students.ijw_student_id, 0259a) — 학생 행을 바꾸므로 기록한다.
  student_ijw_link: "인재원 학습 계정 연결",
  student_ijw_unlink: "인재원 학습 계정 연결 해제",
  student_ijw_link_bulk: "인재원 학습 계정 일괄 연결",
  ijw_profile_push: "인재원에 학생 학교·학년·생일 보내기",
  // 도움말 질문 게시판(0265a)
  help_post_create: "도움말 질문 작성",
  help_post_update: "도움말 질문 수정",
  help_post_delete: "도움말 질문 삭제",
  help_post_close: "도움말 질문 닫기",
  help_answer_create: "도움말 답변 작성",
  // 고객센터 개선요청(0294a) — 답변·공지는 슈퍼관리자 감사 로그에 남는다(super-admin/server/audit.ts).
  support_request_create: "개선요청 작성",
  support_request_update: "개선요청 수정",
  support_request_delete: "개선요청 삭제",
  // 데모 지점 대시보드에서만. 가상 재원 네 구성 중 하나로 갈아끼운다.
  demo_roster_apply: "데모 재원 구성 바꾸기",
  // 수업 나누기(0351a) — 한 학생의 일부 시간을 다른 선생님 반에서. 출결 귀속이 바뀌므로 기록한다.
  class_split_create: "수업 나누기",
  class_split_end: "수업 나누기 해제",
  // 원스크린 일괄 입력(맨 위 행 복사 · 직접 입력) — 칸 저장은 건마다 남기지 않아 일괄 동작을 한 줄로(원장 2026-10-15 감사로그 빈틈).
  onescreen_bulk_apply: "원스크린 일괄 입력",
  // 학습 추세 미발송(반·학생) — 계정 설정(ui_prefs)에 저장되지만 학부모 글을 바꾼다. 활동 로그가 ui_prefs를 안 남기게 된 날(0444a) 더했다.
  onescreen_trend_optout: "학습 추세 미발송 설정",
  // ── 감사로그 빈틈 메우기(원장 2026-10-15 *"감사로그 빈틈 확인하고 추가할것"*) — 쓰는데 기록이 없던 서버 액션. 가드 = audit-coverage.test.ts ──
  // 학생 상세(메모·성적·레벨테스트·목표·학습 코멘트) — 본문·점수·사유는 metadata에 안 남긴다.
  student_memo_create: "학생 메모 작성",
  student_memo_update: "학생 메모 수정",
  student_memo_delete: "학생 메모 삭제",
  student_memo_pin: "학생 메모 고정·해제",
  student_grade_create: "학생 성적 추가",
  student_grade_delete: "학생 성적 삭제",
  student_level_test_create: "학생 레벨테스트 추가",
  student_level_test_delete: "학생 레벨테스트 삭제",
  student_goal_create: "학생 시험 목표 추가",
  student_goal_delete: "학생 시험 목표 삭제",
  student_grade_comment_create: "학생 학습 코멘트 작성",
  student_grade_comment_update: "학생 학습 코멘트 수정",
  student_grade_comment_delete: "학생 학습 코멘트 삭제",
  student_consultation_analysis: "학생상담 AI 분석 실행",
  kiosk_attendance_code_assign: "키오스크 출석번호 일괄 발급",
  class_create: "반 생성",
  // 수납 단가표·견적 — 금액은 남기지 않는다(무엇을 · 어느 항목만).
  textbook_catalog_create: "교재 단가표 항목 추가",
  textbook_catalog_update: "교재 단가표 항목 수정",
  textbook_catalog_delete: "교재 단가표 항목 삭제",
  textbook_catalog_toggle: "교재 단가표 항목 사용·중지",
  tuition_catalog_create: "수강료 단가 항목 추가",
  tuition_catalog_update: "수강료 단가 항목 수정",
  tuition_catalog_delete: "수강료 단가 항목 삭제",
  tuition_catalog_pricing_mode: "수강료 단가 종류 변경",
  tuition_catalog_toggle: "수강료 단가 항목 사용·중지",
  tuition_quote_save: "수강료 견적 저장",
  tuition_quote_delete: "수강료 견적 삭제",
  // 직원 — 급여 값·이력서 내용은 남기지 않는다(급여 정책은 누구만 — 칸 목록도 급여 방식을 드러낸다).
  staff_leave_request: "직원 휴가 등록",
  staff_leave_approve: "직원 휴가 승인",
  staff_leave_delete: "직원 휴가 삭제",
  teacher_comp_update: "강사 급여 정책 변경",
  staff_work_schedule_update: "직원 근무 일정 변경",
  staff_resume_delete: "직원 이력서 삭제",
  // 강사 시트·콜&상담·진도·셔틀·퇴원보고서
  ecs_week_copy: "강사 시트 지난주 복사",
  ecs_attendance_mark: "출석 체크(ECS)",
  enrollment_consultation_report_edit: "신규 콜&상담 AI 분석 수정",
  enrollment_consultation_regenerate_analysis: "신규 콜&상담 AI 분석 다시 생성",
  progress_anomaly_resolve: "진도 이상 확인·되돌림",
  shuttle_run_stop_time: "셔틀 정류장 시각 수정",
  shuttle_run_stop_reorder: "셔틀 노선 정류장 순서 변경",
  shuttle_rider_weekdays: "셔틀 학생 탑승 요일 수정",
  withdrawal_report_archive_map: "퇴원보고서 원본 기록 학생 연결",
  // 보강관리 — RPC가 기록하지 않는 명령(담당 지정·참여 기록·검토 제출·보류·재개·대사 처리)만 앱이 남긴다. 명령 종류는 상세에 한글로.
  makeup_case_command: "보강관리 처리",
  // 보강관리 RPC가 audit_logs에 직접 쓰는 키(makeup_private.audit = 'makeup_' || 명령, 0345a) — 등록이 없어 화면에 영문이 떴다.
  // ⚠️ `makeup_reserve`는 옛 보강 예약(0264a)과 같은 키라 위의 '보강 예약' 라벨을 함께 쓴다.
  makeup_intake: "보강관리 접수",
  makeup_approve: "보강관리 승인",
  makeup_deny: "보강관리 거절",
  makeup_cancel: "보강관리 일정 취소",
  makeup_reschedule: "보강관리 일정 변경",
  makeup_verify: "보강관리 검토(실시 인정)",
  makeup_reverse: "보강관리 인정 정정",
  makeup_waive: "보강관리 면제",
  makeup_adjust: "보강관리 조정",
  makeup_close: "보강관리 종결",
  makeup_link_legacy: "보강관리 기존 보강 예약 연결",
  makeup_accept_units: "보강관리 시수 차이 승인",
  makeup_configure: "보강관리 설정 변경",
  makeup_reconcile: "보강관리 대사 실행",
  before_class_target_add: "비포클래스체크리스트 반 추가",
  before_class_target_remove: "비포클래스체크리스트 반 빼기",
} as const;
export type AuditActionKey = keyof typeof AUDIT_ACTIONS;

export const auditActionLabel = (a: string): string =>
  (AUDIT_ACTIONS as Record<string, string>)[a] ?? a;

type LogArgs = {
  action: AuditActionKey | string;
  targetType?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * 고가치 mutation을 감사로그에 기록(INSERT-only). 서버 액션 본 작업 성공 후 호출.
 * RLS createClient라 tenant_id=actor.tenantId 행만 INSERT(정책 통과). best-effort: 실패해도 본 작업 안 막음.
 */
export async function logAction(args: LogArgs): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    // 운영 콘솔의 '지점 보기'(읽기 전용) 중이면 이 지점의 감사 로그가 아니라 **운영 감사 로그**에 남긴다 — 그 지점 사람이
    // 한 일이 아니고, 보기 중에는 그 지점에 아무것도 쓰지 않는다. 내려받기 · 민감 정보 열람처럼 "읽기인데 기록 대상"인
    // 동작이 여기로 온다(쓰기는 애초에 막혀 여기까지 오지 않는다).
    if (user.tenantView) {
      await logTenantViewActivity({
        actorId: user.id,
        actorEmail: user.email,
        tenantId: user.tenantView.tenantId,
        tenantName: user.tenantView.tenantName,
        action: String(args.action),
        actionLabel: auditActionLabel(String(args.action)),
        targetType: args.targetType,
        targetLabel: args.targetLabel,
        metadata: args.metadata,
      });
      return;
    }
    const supabase = await createClient();
    await supabase.from("audit_logs").insert({
      tenant_id: user.tenantId,
      actor_id: user.id,
      actor_name: user.displayName,
      action: args.action,
      target_type: args.targetType ?? null,
      target_label: args.targetLabel ?? null,
      metadata: args.metadata ?? null,
    });
    // 슬랙 활동 피드(0298a) — 트리거가 같은 트랜잭션에서 인박스에 넣었다. 응답 뒤 발송기를 깨운다.
    pokeSlack(user.tenantId);
  } catch {
    // 감사 기록 실패는 본 작업을 막지 않음
  }
}

/**
 * **로그인 사용자가 없는 쓰기**(비로그인 PIN 화면 등)를 남긴다 — 행위자는 사람 대신 **그 문의 이름**.
 *
 * 원장 2026-09-10: *"기능이 추가되거나 변동되는건 모두 감사로그에 남도록 해야함"* — 그런데 `logAction`은
 * 로그인 사용자가 없으면 **조용히 건너뛴다**(아래 `if (!user) return`). 그래서 자리 PIN 화면의 출결 쓰기가
 * 통째로 감사 사각지대였다(실측 최근 90일 440건 중 149건). 이 함수가 그 구멍을 막는다.
 * 🔴 **admin 클라이언트 + 명시 `tenant_id`** — 세션이 없어 RLS insert 정책(`audit_logs_insert_own`)을 못
 *    통과한다. 호출부가 **검증을 끝낸 테넌트**(PIN 쿠키 서명 확인 등)만 넘길 것.
 * ⚠️ `actor_id`는 null이다(컬럼이 nullable, 0031a) — 사람을 지어내지 않는다. `actor_name`에 문 이름을 적어
 *    감사로그 화면에서 "누가"가 빈칸이 아니라 "랩실 PIN(비로그인)"으로 읽힌다.
 * best-effort — `logAction`과 같이 실패해도 본 작업을 막지 않는다.
 * `actorId` — 세션이 끝까지 살아 있다고 볼 수 없는 **긴 작업**(학원 비서 질문 — 응답 뒤 `after`로 최대 5분)이 시작할 때 확인한 사람을
 *    넘긴다(끝에서 쿠키 세션으로 다시 찾으면 토큰이 만료돼 기록이 조용히 빠질 수 있다 — 적대 리뷰 2026-11-06). 검증을 끝낸 사람만.
 */
export async function logActionAs(
  actor: { tenantId: string; actorName: string; actorId?: string | null },
  args: LogArgs,
): Promise<void> {
  try {
    await createAdminClient()
      .from("audit_logs")
      .insert({
        tenant_id: actor.tenantId,
        actor_id: actor.actorId ?? null,
        actor_name: actor.actorName,
        action: args.action,
        target_type: args.targetType ?? null,
        target_label: args.targetLabel ?? null,
        metadata: args.metadata ?? null,
      });
    pokeSlack(actor.tenantId);
  } catch {
    // 감사 기록 실패는 본 작업을 막지 않음
  }
}

/**
 * **문(門)으로 들어온 쓰기**의 감사로그 — 로그인한 사람이 있으면 그 사람(`logAction`), 없으면 문 이름(`logActionAs`).
 *
 * 🔑 비로그인 PIN 화면이라도 **로그인된 기기**에서 열리면 세션이 있다(메뉴 권한이 없어 PIN 문으로 들어온 경우).
 *    그때 문 이름으로만 적으면 종전(`logAction` — 그 계정으로 남던 것)보다 귀속이 퇴보한다 → 세션을 먼저 본다.
 * 🔴 세션 테넌트가 문의 테넌트와 **다르면** 세션을 믿지 않는다(남의 학원 계정 이름으로 적지 않는다).
 */
export async function logActionAtDoor(
  door: { tenantId: string; doorName: string },
  args: LogArgs,
): Promise<void> {
  let user: Awaited<ReturnType<typeof getCurrentUser>> | null = null;
  try {
    user = await getCurrentUser();
  } catch {
    user = null;
  }
  if (user && user.tenantId === door.tenantId) {
    await logAction(args);
    return;
  }
  await logActionAs({ tenantId: door.tenantId, actorName: door.doorName }, args);
}

export type AuditLogRow = {
  id: string;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type AuditLogsPageResult = {
  rows: AuditLogRow[];
  total: number;
  /** 조회 실패 원문(있으면 화면이 한글 배너+툴팁으로 표면화). 🔴 실패를 "0건"으로 위장하지 말 것 — 감사로그는 "없다"가 곧 답인 화면이라(예: "이 사람이 퇴원 처리한 기록 없음") 특히 해롭다(#89·B3). */
  error?: string;
  /** 이름 선해석이 limit에 걸려 잘렸으면 true — "김" 같은 흔한 글자 검색은 결과가 불완전할 수 있다. */
  nameLookupTruncated?: boolean;
};

/** 검색어·라벨 공통 정규화 — `,`·`(`·`)`는 or() 문법 구분자라 공백 치환(제거하면 "김,민"→"김민" 오검색) + 대소문자 무시. 라벨 쪽도 같은 규칙이어야 화면 라벨 "출석 취소(ECS)" 복붙이 찾힌다. */
function normalizeSearch(s: string): string {
  return s.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

// 이름 선해석 상한 — "이" 검색 실측(학생 100+직원 14)에서 or 파라미터 4.2KB로 정상 동작 확인(414 여유).
// 직원(users)은 총원이 이 값 미만이라 이론상 최악(100+100)은 현실에서 안 나온다.
const NAME_LOOKUP_LIMIT = 100;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** 형식 + 실존(2026-13-45 같은 값 거부 — timestamptz 파싱 에러가 400→"0건" 위장이 되는 것 방지). */
function isValidYmd(s: string | undefined): s is string {
  return typeof s === "string" && YMD.test(s) && !Number.isNaN(Date.parse(s));
}

export async function getAuditLogsPage(
  filter: { action?: string; q?: string; dateFrom?: string; dateTo?: string },
  page = 1,
  pageSize = 50,
): Promise<AuditLogsPageResult> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let q = supabase
    .from("audit_logs")
    .select("id, actor_name, action, target_type, target_label, metadata, created_at", {
      count: "exact",
    });
  if (filter.action && filter.action !== "all") q = q.eq("action", filter.action);
  // 기간 필터(달력) — 입력은 KST 날짜라 created_at(timestamptz) 경계에 +09:00을 명시(서버 UTC 오프셋 무관).
  let dateFrom = isValidYmd(filter.dateFrom) ? filter.dateFrom : undefined;
  let dateTo = isValidYmd(filter.dateTo) ? filter.dateTo : undefined;
  // 시작>종료 역전은 스왑 — 안내 없는 빈 결과("조건에 맞는 기록 없음")로 두지 않는다.
  if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  if (dateFrom) q = q.gte("created_at", `${dateFrom}T00:00:00+09:00`);
  if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59.999+09:00`);

  // 텍스트 검색(원장 2026-08-18) — 실행자·대상 라벨 + 한글 액션 라벨 + **이름→id 선해석**.
  // 선해석이 필요한 이유: 학생 관련 로그(student_withdraw 등)는 이름이 화면에서만 보이고 DB엔
  // metadata의 uuid뿐이라, 라벨 ilike만으론 "엄채율" 검색이 그 행들을 못 찾는다. 학생·직원 이름을
  // 먼저 id로 풀어 metadata->>studentId/userId 매치에 넣는다(마이그레이션 0 — PostgREST 필터만).
  const rawQ = (filter.q ?? "").trim();
  const term = rawQ.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
  // 구분자만 친 검색(","·"()" 등)은 정규화 후 빈 문자열 — 무필터 전체 목록으로 새지 않게 빈 결과로.
  if (rawQ && !term) return { rows: [], total: 0 };
  let nameLookupTruncated = false;
  let lookupError: string | undefined;
  if (term) {
    const [stuRes, usrRes] = await Promise.all([
      supabase.from("students").select("id").ilike("name", `%${term}%`).limit(NAME_LOOKUP_LIMIT),
      supabase.from("users").select("id").ilike("display_name", `%${term}%`).limit(NAME_LOOKUP_LIMIT),
    ]);
    // 선해석 실패 = 이름 매치 차원이 조용히 빠진 불완전 검색 — 삼키지 않고 표면화(B3 "?? []로 error 삼키기 금지").
    if (stuRes.error || usrRes.error) lookupError = (stuRes.error ?? usrRes.error)?.message;
    const ors = [`actor_name.ilike.*${term}*`, `target_label.ilike.*${term}*`];
    const lcTerm = term.toLowerCase();
    const actionKeys = Object.entries(AUDIT_ACTIONS)
      .filter(([, label]) => normalizeSearch(label).includes(lcTerm))
      .map(([key]) => key);
    if (actionKeys.length > 0) ors.push(`action.in.(${actionKeys.join(",")})`);
    // 실행자도 같은 규약 — 화면엔 "시스템 · 수업 평가 권한 부여"로 보이는데 DB엔 `system:grant-class-review`라
    // 보이는 대로 검색하면 0건이 나온다(액션 라벨 → 키 역인덱스와 같은 결).
    const sysActors = systemActorMatches(term);
    if (sysActors.allSystem) ors.push(`actor_name.ilike.${SYSTEM_ACTOR_PREFIX}*`);
    else for (const name of sysActors.names) ors.push(`actor_name.eq.${name}`);
    const studentIds = (stuRes.data ?? []).map((r) => r.id as string);
    if (studentIds.length > 0) {
      ors.push(`metadata->>studentId.in.(${studentIds.join(",")})`);
      ors.push(`metadata->>mergedStudentId.in.(${studentIds.join(",")})`);
      // 일괄 로그(metadata.studentIds 배열)도 학생 이름으로 찾히게 — cs(contains)는 id마다 조건 1개라
      // 소수 매치(=정확한 이름 검색)일 때만 편성. 흔한 글자 광역 검색은 개별 매치가 어차피 무의미하다.
      if (studentIds.length <= 10)
        for (const id of studentIds) ors.push(`metadata->studentIds.cs.["${id}"]`);
    }
    if (studentIds.length >= NAME_LOOKUP_LIMIT) nameLookupTruncated = true;
    const userIds = (usrRes.data ?? []).map((r) => r.id as string);
    if (userIds.length > 0) {
      ors.push(`metadata->>userId.in.(${userIds.join(",")})`);
      // 인수인계(newTeacherId)·담임 위임(delegateUserId)도 강사 이름 검색으로 찾히게(표시 측 collectAuditNameIds와 대칭).
      ors.push(`metadata->>newTeacherId.in.(${userIds.join(",")})`);
      ors.push(`metadata->>delegateUserId.in.(${userIds.join(",")})`);
      // 출석부 강사 전체 보기(scopeTeacherId, 2026-09-11)도 그 강사 이름으로 찾히게.
      ors.push(`metadata->>scopeTeacherId.in.(${userIds.join(",")})`);
    }
    if (userIds.length >= NAME_LOOKUP_LIMIT) nameLookupTruncated = true;
    q = q.or(ors.join(","));
  }

  const { data, count, error } = await q
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) return { rows: [], total: 0, error: error.message, nameLookupTruncated };
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      actorName: r.actor_name,
      action: r.action,
      targetType: r.target_type,
      targetLabel: r.target_label,
      metadata: r.metadata as Record<string, unknown> | null,
      createdAt: r.created_at,
    })),
    total: count ?? 0,
    error: lookupError,
    nameLookupTruncated,
  };
}

/**
 * 페이지 행들의 metadata에 든 학생/직원 uuid → 표시 이름 일괄 해석(상세 열 한글화).
 * best-effort: 조회 실패해도 뷰어를 막지 않음(이름만 빠진 채 표시).
 */
export async function getAuditNameMap(
  rows: Array<{ metadata: Record<string, unknown> | null }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { studentIds, userIds, classIds } = collectAuditNameIds(rows);
  if (studentIds.length === 0 && userIds.length === 0 && classIds.length === 0) return map;
  try {
    const supabase = await createClient();
    const [students, users, classes] = await Promise.all([
      fetchInChunks<{ id: string; name: string | null }>(studentIds, (c) =>
        supabase.from("students").select("id, name").in("id", c),
      ),
      fetchInChunks<{ id: string; display_name: string | null }>(userIds, (c) =>
        supabase.from("users").select("id, display_name").in("id", c),
      ),
      fetchInChunks<{ id: string; class_name: string | null }>(classIds, (c) =>
        supabase.from("classes").select("id, class_name").in("id", c),
      ),
    ]);
    for (const s of students) if (s.name) map.set(s.id, s.name);
    for (const u of users) if (u.display_name) map.set(u.id, u.display_name);
    for (const k of classes) if (k.class_name) map.set(k.id, k.class_name);
  } catch {
    // 이름 해석은 표시 보강일 뿐 — 실패 시 uuid 항목만 생략된 채 렌더
  }
  return map;
}
