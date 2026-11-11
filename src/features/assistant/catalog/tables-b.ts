import type { AssistantTableDoc } from "./types";

/**
 * 학원 비서 DB 지도 — m~z 표(이름순). 근거 = supabase/migrations(s1 합본 · s2_*) + src/features 코드.
 * 공통: 시각 칸(timestamptz)은 UTC로 저장된다 — 한국 날짜는 `(칸 at time zone 'Asia/Seoul')::date`. date 칸은 한국 날짜 그대로다.
 * 금액 칸은 원 단위(소수 없음, 예외는 칸 설명에 적었다).
 */
export const TABLES_B: readonly AssistantTableDoc[] = [
  {
    name: "makeedu_history_bills", label: "옛 수납 이력",
    ko: "메이크에듀 시절 수납 상세(2020-01~) — 학생×청구월×순번 한 줄",
    notes:
      "옛 메이크에듀 청구·수납 원자료(읽기 전용 이력). 금액 칸은 모두 원. item_kind: lesson=수업료 · other=기타 항목. category·item_name·paid_status·pay_method는 메이크에듀 원문 값 그대로. 학생 연결은 makeedu_no → makeedu_history_students.student_id. 원자료를 그대로 둬서 2025-04(청구 방식 변경)처럼 추세에 바로 쓰면 틀리는 달이 있다 — 월별 추이는 student_history_monthly를 먼저 본다. 지금 청구·미납은 invoices.",
    columns: {
      makeedu_no: "메이크에듀 원생고유번호",
      bill_month: "청구월",
      seq: "같은 학생·같은 달 안 순번",
      billed: "청구액(원)",
      discount: "할인액(원)",
      points: "포인트(원)",
      paid: "납부액(원)",
      unpaid: "미납액(원)",
      paid_on: "납부일",
      refunded: "환불 여부",
      partial: "부분 납부 여부",
    },
  },
  {
    name: "makeedu_history_events", label: "옛 원생 이력",
    ko: "메이크에듀 원생이력 사건(2025-03~) — 반 추가·이동·제외·퇴원 등",
    notes:
      "옛 메이크에듀 원생이력 원자료. event_type·class_name·effective_text(휴퇴원일 원문)는 메이크에듀 글자 그대로라 번역·정규화되어 있지 않다. teacher_name은 표시 이름 글자라 users와 조인되지 않는다. 학생 연결은 makeedu_no → makeedu_history_students. processed_at은 UTC — 한국 날짜는 at time zone 'Asia/Seoul'. 같은 학생·같은 시각 사건은 ord로 가른다.",
  },
  {
    name: "makeedu_history_students", label: "옛 원생 목록",
    ko: "메이크에듀 원생 목록 — 원생번호·에이와 학생 연결·입학일·퇴원일·사유",
    notes:
      "메이크에듀 번호(makeedu_no)와 에이와 학생(student_id, 못 이으면 null)을 잇는 다리 표. 이름·연락처는 없다. withdrawal_reason은 분류 이름만('기타(서술)'은 '기타'). 원자료 그대로라 2024-03-18 하루 4,014명 같은 이관 때의 일괄 퇴원일이 남아 있다 — 퇴원 추세에 그대로 쓰지 말 것. 지금의 재원·퇴원은 students가 기준.",
    columns: { enrolled_on: "메이크에듀 입학일", withdrawn_on: "메이크에듀 퇴원일" },
  },
  { name: "makeedu_push_batches", label: "역동기화 배치", ko: "메이크에듀 주간 자동 역동기화 배치 중복 방지 표식", internal: true },
  {
    name: "makeedu_push_requests", label: "역동기화 요청",
    ko: "등록상담을 메이크에듀로 보내는 요청 큐",
    notes: "status: pending · running · done · error · skipped(이미 전송됨).",
    internal: true,
  },
  { name: "makeedu_sync_requests", label: "동기화 요청", ko: "메이크에듀 '지금 동기화' 요청 큐", internal: true },
  {
    name: "makeedu_sync_runs", label: "동기화 실행",
    ko: "메이크에듀 동기화 실행 기록(실행마다 한 줄)",
    notes: "status: running · ok · partial(일부 도메인 실패) · error · skipped(스위치 꺼짐). trigger_source: scheduled · button · relay · manual.",
    internal: true,
  },
  {
    name: "makeedu_sync_state", label: "동기화 상태",
    ko: "메이크에듀 도메인별 마지막 동기화 시각·건수·상태",
    notes:
      "domain: students · classes · enrollments · invoices · consultations · prospects · catalog. status: ok · error. '이 숫자가 언제 기준이냐'를 답할 때 synced_at을 본다.",
    internal: true,
  },
  { name: "makeedu_sync_workers", label: "동기화 PC", ko: "메이크에듀 동기화 PC 심장박동(살아 있는지)", internal: true },
  {
    name: "makeup_adjustments", label: "보강 조정",
    ko: "보강 원장 — 케이스의 목표 분량 조정·면제·기한 변경 기록",
    notes:
      "kind: quantity=목표 분 증감(부호 있음) · waiver=면제(양수 분) · due_date=기한 변경(due_date_from → due_date_to). 덧붙이기만 하는 기록. case_id → makeup_cases. 보강 원장(makeup_cases 계열)은 기본 꺼진 기능이라 비어 있을 수 있다.",
  },
  {
    name: "makeup_allocations", label: "보강 배정",
    ko: "보강 원장 — 케이스의 분량을 보강 참여에 배정한 기록",
    notes:
      "allocated_minutes=배정한 분 · recognized_minutes=인정으로 넘어간 분 · released_minutes=취소·노쇼 등으로 풀린 분(release_reason). 살아 있는 점유 = 배정 − 인정 − 해제. case_id → makeup_cases, participant_id → makeup_participants.",
  },
  {
    name: "makeup_case_sources", label: "보강 근거",
    ko: "보강 원장 — 케이스가 어디서 접수됐는지 근거",
    notes: "source_kind: attendance · reservation · manual · import. evidence: exact · probable · manual_review.",
    internal: true,
  },
  {
    name: "makeup_cases", label: "보강 케이스",
    ko: "보강 원장 케이스 — 결석·휴강 한 건에 대한 보강 의무(분 단위)",
    notes:
      "원수업(original_class_id·original_date) 하나당 한 줄. reason: absence=결석 · planned_absence=사전 결석 통보 · class_cancelled=휴강 · additional=추가 지도 · imported=기존 예약에서 옴. eligibility: pending=검토 중 · approved=승인 · denied=거절. lifecycle: open=진행 · on_hold=보류 · closed=종결(closure_reason: completed · completed_with_waiver · denied · waived · duplicate · source_retracted). 남은 보강 = outstanding_minutes. 기본 꺼진 기능이라 비어 있을 수 있다 — 지금 쓰는 보강은 makeup_reservations.",
    columns: {
      subject_key: "과목 키(학원설정)",
      target_minutes: "승인된 목표 분량(분, 검토 중이면 null)",
      recognized_minutes: "인정된 분(자식 표에서 다시 계산한 값)",
      waived_minutes: "면제된 분",
      owner_id: "담당 직원",
      due_date: "보강 기한",
      merged_into: "중복으로 합쳐진 대상 케이스",
    },
  },
  { name: "makeup_commands", label: "보강 명령", ko: "보강 원장 쓰기 명령 기록(재시도·중복 방지)", internal: true },
  { name: "makeup_events", label: "보강 이벤트", ko: "보강 원장 변경 이벤트 로그", internal: true },
  {
    name: "makeup_fulfillments", label: "보강 실시",
    ko: "보강 원장 — 학생별 보강 실시 기록(근거·검토)",
    notes:
      "participant_id → makeup_participants 한 명의 실시 기록. state: draft=작성 중 · submitted=제출 · returned=반려 · verified=검토 완료 · reversed=반전(무효). 다시 적으면 version이 오르고 옛 기록은 reversed로 남는다 — 유효한 실시는 state='verified'. evidence_kind: report=보강 보고서 · manual=분+지도 근거 글 · attendance=정규 수업 없는 날의 출결. actual_teacher_id=실제로 가르친 강사(입력자 recorded_by와 다를 수 있다).",
    columns: { actual_minutes: "실제 보강 분" },
  },
  { name: "makeup_legacy_maps", label: "보강 예약연결", ko: "보강 원장 ↔ 기존 보강 예약(makeup_reservations) 연결", internal: true },
  {
    name: "makeup_participants", label: "보강 참여",
    ko: "보강 원장 — 보강 회차에 참여하는 학생 한 명",
    notes:
      "session_id → makeup_sessions. status: unknown=기록 전 · present=옴 · partial=일부 참여 · no_show=안 옴 · cancelled=이 학생 일정만 취소. planned_minutes·actual_minutes = 계획·실제 분. anchor_class_id = 출결·보고서를 세울 원반. 이 표는 출결 행을 쓰지 않는다(attendance_record_id는 연결만).",
  },
  {
    name: "makeup_policy_versions", label: "보강 정책",
    ko: "보강 정책 버전(불변 스냅샷) — 승인 케이스에 고정됨",
    notes: "고치지 않고 새 버전을 더한다. effective_from = 적용 시작일. 첫 출시 제약으로 self_verify·auto_approve·auto_expire는 항상 false, additional_billing은 'undecided'.",
  },
  { name: "makeup_projection_jobs", label: "보강 반영작업", ko: "보강 원장 후속 반영 작업 큐", internal: true },
  {
    name: "makeup_recognitions", label: "보강 인정",
    ko: "보강 원장 — 실시가 케이스의 몇 분을 채웠는지(인정·반전)",
    notes:
      "kind: recognize=인정 · reverse=그 인정의 반전(reversal_of가 원래 인정 줄). 덧붙이기만 하는 기록이라 반전된 인정도 줄이 남는다. 케이스별 인정 합계는 makeup_cases.recognized_minutes에 이미 계산돼 있다.",
  },
  {
    name: "makeup_reconciliation", label: "보강 대사",
    ko: "보강 원장 대사(불일치 확인) 큐",
    notes: "state: open · resolved · dismissed. blocks_close=true면 열린 동안 연결 케이스 종결을 막는다.",
    internal: true,
  },
  { name: "makeup_reconciliation_runs", label: "보강 대사실행", ko: "보강 원장 대사 실행 기록", internal: true },
  {
    name: "makeup_reservations", label: "보강 예약",
    ko: "보강 예약 — 결석한 학생의 보강 날짜·교시(지금 실제로 쓰는 보강 표)",
    notes:
      "absence_date=결석일(결석난 반 = absence_class_id, null이면 class_id) · makeup_date=보강일 · slot_start~slot_end=교시 시각 · class_id=보강을 기록할 반. status: reserved=예약(아직 안 함) · done=보강일 출결이 찍혀 이행(attendance_record_id·done_at). '이번 달 보강 실적' = status='done'을 makeup_date로 센다. checked_at=선생님이 '보강 했음' 확인한 시각(null이면 그 보강이 든 보고서는 발송 안 함). report_mode: merge=정규 보고서에 합침 · separate=따로 · null=묻지 않음. 출결 행이 아니라 시수·출석률에 닿지 않는다. 🔴 담당 강사 칸은 따로 없다 — 보강을 맡는 사람은 class_id(보강을 기록할 반)의 그날 담당(onto_class_teachers — 담임·교시 담당·위임)이다. 보강 회차(makeup_sessions)는 기본 꺼진 기능이라 비어 있는 게 정상 — 회차가 없다고 '담당 미정'이 아니다(멘트 시험 2026-11-11).",
    columns: { period_label: "예약 당시 교시 이름(표시용)", note: "메모" },
  },
  {
    name: "makeup_sessions", label: "보강 회차",
    ko: "보강 원장 — 보강 회차(날짜·교시·강사·강의실)",
    notes:
      "state: confirmed=확정 · finished=끝남(전원 노쇼면 finish_reason='all_no_show') · cancelled=취소(cancel_cause: student · academy · reschedule) · rescheduled=일정 변경(replaced_by_session_id = 새 회차). class_id = 합류한 정규 반(null이면 독립 회차). 출결 행이 아니다. 참여 학생은 makeup_participants. 기본 꺼진 기능(보강 원장)이라 비어 있는 게 정상 — 지금 쓰는 보강은 makeup_reservations(회차를 만들라고 권하지 않는다).",
  },
  {
    name: "math_book_targets", label: "수학 목표교재",
    ko: "수학 교재 최종 목표 권 — 학생×교재 시리즈, 사람이 고른 것만",
    notes:
      "기본은 앱이 계산하는 자동 목표라 이 표엔 줄이 없다. 사람이 다른 권을 골랐을 때만 한 줄 생긴다(지우면 자동으로 돌아감). series = 교재 시리즈 이름(예: 가우스), target_key = '시리즈|학년-학기|권' 꼴 열쇠(교재 id 아님). 반이 아니라 학생 기준.",
  },
  {
    name: "math_learning_goals", label: "수학 학습목표",
    ko: "수학 학습 목표(옛 방식) — 학생·반별 전체 목표 구간 하나",
    notes:
      "학생×반 하나의 전체 목표: study_grade(진도 학년) · start_block~end_block(단원 구간) · start_date~end_date · textbook. 월·주·일 목표는 저장하지 않고 계산한다. 새 정규 계획은 math_learning_track_goals가 대신한다(이 표의 행은 지우지 않고 남아 있다).",
  },
  {
    name: "math_learning_track_goals", label: "수학 학습계획",
    ko: "수학 표준 학습 계획 — 학생·반·트랙별 목표 구간",
    notes:
      "track: regular=정규 · supplement=보충. study_grade~end_study_grade 학년 범위, start_block~end_block 단원 구간, start_date~end_date 기간, textbook 교재. milestones = 중간 목표 배열(jsonb). math_learning_goals(옛 방식)를 대체한다.",
  },
  {
    name: "math_month_goals", label: "수학 월목표",
    ko: "수학 강사 시트(MCS) 학생별 월간 목표",
    notes:
      "학생×반×달 한 줄. period_start = 그 달 1일. textbook·target_progress = 목표 교재·진도(자유 글). 수학은 학생마다 교재·진도가 달라 학생 축이고, 영어는 반×기간×영역 축의 class_sheet_goals를 쓴다.",
  },
  {
    name: "math_textbook_assignments", label: "수학 교재배정",
    ko: "수학 교재 배정 — 반 교재 또는 학생별 교재(지금 교재 한 권)",
    notes:
      "student_id null = 반 교재(그 반 학생 전원의 기본), 값 있음 = 그 학생 교재(반 교재보다 우선). textbook_id → textbooks. 영어 교재 배정(class_textbook_plans)과는 다른 표.",
  },
  {
    name: "meeting_minutes", label: "회의록",
    ko: "회의록 — 제목·내용·참석자 + 녹음 전사·AI 요약",
    notes:
      "'언제 한 회의'는 held_at(UTC — 한국 날짜는 at time zone 'Asia/Seoul'). author_id = 작성자. processing_status(녹음 처리 단계): idle · uploaded · transcribing · analyzing · completed · failed. transcription = 전사문, ai_summary·ai_action_items·ai_report = AI 결과(사람이 고친 경우 ai_report_edited_at). attendees·speaker_staff는 jsonb.",
  },
  { name: "ment_ai_drafts", label: "멘트 AI원문", ko: "수업보고서 멘트 AI 자동작성 원문(보고서당 1행, 말투 학습용)", internal: true },
  { name: "migration_data_marks", label: "데이터 이관표식", ko: "데이터 마이그레이션 적용 표식", internal: true },
  { name: "notice_dismissals", label: "팝업 닫기", ko: "팝업 공지 '다시 보지 않기' 기록(계정별)", internal: true },
  { name: "notice_popup_translations", label: "팝업 번역", ko: "팝업 공지 영어 번역 캐시", internal: true },
  {
    name: "notice_popups", label: "팝업 공지",
    ko: "팝업 공지 — 화면 진입 때 뜨는 창형 공지",
    notes:
      "audience(대상): all · staff · teachers · counselors · accounting · office. is_active + 노출 기간 starts_at~ends_at(null = 제한 없음). author_id = 작성자. 대시보드 공지 카드(announcements)와 별개 표.",
  },
  { name: "notification_events", label: "알림 중복방지", ko: "능동 알림(결석 마일스톤 등) 중복 발송 방지 원장", internal: true },
  {
    name: "notifications", label: "알림",
    ko: "직원 인앱 알림(벨) — 받는 사람 한 명당 한 줄",
    notes:
      "같은 사건도 받는 사람마다 한 줄이라 '알림 몇 건'은 사건 수가 아니다. type 예: absence_alert=반복 결석 · report_send_failed=보고서 발송 실패 · unsent_report=미발송 보고서 · classnote_parent_post=학부모 새 글 · video_homework_missing=영상 숙제 미제출 · followup_due=상담 후속 기한 · grade_drop=성적 급락 · outstanding_alert=미수 금액. read_at null = 안 읽음, archived_at = 보관함으로 치움. 읽은 알림은 90일 뒤 자동 정리돼 오래된 기록은 없다. task_id → staff_tasks.",
    columns: { recipient_id: "받는 직원(users)", actor_id: "알림을 일으킨 사람", link: "누르면 가는 화면 경로" },
  },
  {
    name: "onescreen_daily_sessions", label: "원스크린 입력",
    ko: "강사 원스크린 입력 상태 — 학생×날짜 하루 한 줄(점수·진도·태도·과제)",
    notes:
      "수업 중 강사가 입력한 일일테스트(daily_score/daily_max) · 확인테스트(check_score/check_max) · attitude(태도) · homework(과제) · special_note(특이사항) · subject_progress(과목별 오늘 진도, jsonb). session_date = 수업일. 발송된 수업보고서(lesson_reports)와 별개인 '작업 중' 상태라, 보고서 기준 질문은 lesson_reports를 본다.",
    columns: {
      study_grade: "진도 학년(선행·후행)",
      daily_score_mode: "일일테스트 표기 방식(score|count, null=학원 기본)",
      check_score_mode: "확인테스트 표기 방식(score|count, null=학원 기본)",
      progress_confirmed: "진도 확정 여부",
    },
  },
  { name: "onescreen_student_order", label: "원스크린 순서", ko: "원스크린 학생 표시 순서(강사×반 개인 설정)", internal: true },
  {
    name: "operating_periods", label: "세션 기간",
    ko: "세션(운영 기간) — 과목별 'N월 세션'의 실제 시작·끝 날짜",
    notes:
      "이 학원은 달력월이 아니라 세션(요일마다 4회)으로 운영해 '2월 세션이 3/5까지' 같은 일이 정상이다. label_year·label_month = 몇 년 몇 월 세션, start_date~end_date = 실제 구간(양 끝 포함). class_id null = 과목 기본값, 값 = 그 반만의 예외. 시수(attendance_records.session_units)·청구 회차와는 다른 개념.",
  },
  { name: "operator_tenant_views", label: "지점 보기", ko: "운영자 '지점 보기'(읽기 전용) 토큰", internal: true },
  {
    name: "page_usage_daily", label: "화면 이용",
    ko: "화면 이용 통계 — 지점×날짜×직원×화면 하루 합계",
    notes:
      "day = 한국 날짜. visits = 방문 수, open_seconds = 화면을 띄워 둔 시간(초), active_seconds = 그중 실제 입력이 있던 시간(초, 항상 ≤ open_seconds). menu_key = 메뉴 키, route_key = 화면 식별자, role = 기록 당시 역할.",
  },
  {
    name: "parent_account_students", label: "학부모 연결",
    ko: "학부모 계정 ↔ 원생 연결",
    notes: "relationship = 관계, is_primary = 대표 보호자 여부.",
  },
  {
    name: "parent_accounts", label: "학부모 계정",
    ko: "학부모 포털 계정",
    notes: "직원 계정(users)과 분리된 학부모 계정. status: active=사용 · inactive=중지. 원생 연결은 parent_account_students.",
  },
  { name: "parent_departure_acks", label: "출발 알림확인", ko: "학부모 '차량 출발' 알림 확인 표식", internal: true },
  {
    name: "payroll_records", label: "급여",
    ko: "직원 급여 정산 기록(기본급·시급제) — 직원×기간",
    notes:
      "period = 'YYYY-MM'. 금액 칸은 모두 원: base_amount 기본급 · hours_worked 근무 시간 · hourly_amount 시급 정산액 · bonus 상여 · deduction 공제 · total = 기본급+시급 정산+상여−공제. paid_at = 지급 시각(null = 미지급). 프리랜서 강의용역 명세서는 payslips가 따로 다룬다. 🔴 이 표가 0건이어도 같은 직원·근무월의 payslips 발행분(status='issued')을 확인한다 — 발행 금액은 print_payload->'amounts'의 grossPay(지급총액)·netPay(실수령액). 발행 사실만으로 실제 지급을 단정하지 않는다. 민감한 급여 정보 — 비서 보기로 제공된 칸은 질문 범위에서 조회할 수 있다.",
  },
  {
    name: "payslips", label: "급여명세서",
    ko: "프리랜서 강사 급여명세서 — 직원×월, 월별 조정값 + 발행 스냅샷",
    notes:
      "period = 'YYYY-MM'(근무월). status: draft=작성 중(금액은 화면이 매번 계산하고 표엔 없다) · issued=발행(issued_at, print_payload에 금액·지표 동결). 표에 있는 금액은 조정값뿐: incentive 인센티브(원) · other_deduction 기타공제(원, 소득세 3.3% 계산 전 과세표준에서 뺀다) · rate_penalty_points 그 달만 배분율 차감(%p). 급여 한 줄 = floor1(단가×시수×0.911×비율) — salary_tiers 참고. 발행 금액 = print_payload->'amounts'의 grossPay(지급총액)·netPay(실수령액). 민감한 급여 정보 — 비서 보기로 제공된 칸은 질문 범위에서 조회할 수 있다.",
    columns: { blog_written_on: "명세서 '내신분석' 칸 = 블로그 작성일(자유 글, 빈 값 = 미작성)" },
  },
  {
    name: "progress_containers", label: "진도 구간",
    ko: "학생 진도 분석 구간(현행·선행) — 보고서 진도를 위치로 담는 묶음",
    notes:
      "track: current=현행 · ahead=선행. status: active=진행 · archived=닫힘 · errored=오류(error_reason: jump_error · overlap · full · manual). start_position~last_position = 커리큘럼 위치 범위(앱의 커리큘럼 순번이라 SQL로 단원명을 풀 수 없다). grade_scope = 시작 때 진도 학년(예: 중2), chapter_count = 담긴 보고서 수.",
  },
  {
    name: "progress_entries", label: "진도 기록",
    ko: "진도 분석 — 수업보고서 한 건의 진도 위치 기록",
    notes: "report_id → lesson_reports, container_id → progress_containers. entry_date = 수업일, raw_progress = 보고서의 진도 원문, soft_chapter_name = 차시 이름, global_position = 커리큘럼 위치.",
  },
  {
    name: "progress_events", label: "진도 이벤트",
    ko: "진도 분석 이벤트 — 전진·역행·점프·겹침 등",
    notes:
      "event_type: forward=전진 · regression=역행 · jump_error=점프 이상 · overlap_error=겹침 이상 · container_opened/container_closed=구간 열림/닫힘 · manual_note=수동 메모. 이상(jump_error·overlap_error)은 resolved_at이 null이면 미확인 — '진도 이상 몇 건' 질문에 쓴다(resolved_by = 확인자). jump_size = 건너뛴 칸 수.",
  },
  { name: "push_subscriptions", label: "푸시 구독", ko: "휴대폰 웹 푸시 구독 자격증명(기기별)", internal: true },
  {
    name: "record_coverage_marks", label: "기록 범위",
    ko: "에이와 기록 범위 확정값 — 청구 시작 달·수강 기록이 갖춰진 첫 달",
    notes:
      "지점당 한 줄. billing_from = 청구가 지점을 덮기 시작한 달(YYYY-MM), trust_from = 에이와 수강 기록이 갖춰진 첫 달(YYYY-MM, null = 처음부터 갖춰짐). 그보다 앞선 달의 에이와 수강 기록은 불완전하다(그 전에 그만둔 학생은 수강 행이 없다) — 옛 기간은 student_history_monthly 또는 makeedu_history_*를 본다.",
  },
  {
    name: "reenrollment_campaign_targets", label: "재등록 캠페인",
    ko: "재등록 캠페인 대상 — 연락·결과 추적",
    notes:
      "status: pending=대상 · contacted=연락함 · enrolled=재등록 완료 · declined=이탈. counselor_id = 담당자, contacted_at = 연락 시각, decided_at = 결정 시각(UTC), trigger_reason = 대상이 된 까닭.",
  },
  { name: "report_jj_snapshots", label: "인재원 자료", ko: "영어 보고서에 실린 인재원 자료 동결본(보고서당 1행)", internal: true },
  { name: "report_templates", label: "보고서 템플릿", ko: "수업보고서 사용자 템플릿(사람마다 여러 개)", internal: true },
  {
    name: "salary_tiers", label: "급여 단가",
    ko: "강사 급여용 수업 단가표 — 티어 라벨 → 회당 단가(원)",
    notes:
      "label 예: '초등 3T' · '의치대 중등'. unit_price = 회당 단가(원, 29,166.75처럼 소수 단가도 있다). 수강의 티어는 enrollments.salary_tier(라벨 글자 — FK 없음), 행 단위 예외는 attendance_records.salary_tier. 급여 한 줄 = floor1(단가 × 실제 시수 × 0.911 × 강사 과정별 비율 users.commission_rates). 원장 전용.",
  },
  {
    name: "school_enrollment_stats", label: "학교 전교생",
    ko: "학교알리미 공시 학교별·학년별 전교생 수(연 1회 적재)",
    notes:
      "학교 점유율 = 우리 재원생 수 ÷ total_students. 우리 학생(students.school)과는 정규화한 학교 이름(name_key)으로만 맞춘다(학교 코드 연결 없음). year = 공시 연도, by_grade = 학년별 인원(jsonb), total_classes·teachers = 학급 수·교원 수. kind·office·district·region은 공시 원문 분류.",
  },
  {
    name: "school_exam_periods", label: "내신 기간",
    ko: "학교별 내신 시험 기간 — 학교×학년도×시험",
    notes:
      "term: 1-mid=1학기 중간 · 1-final=1학기 기말 · 2-mid=2학기 중간 · 2-final=2학기 기말 · 2-final-3(원문 값). from_date~to_date = 시험 기간. 적어 둔 시험만 코드의 기본표를 덮으므로 이 표에 없다고 시험이 없는 게 아니다. school_key = 정규화한 학교 이름, school_label = 표시 이름.",
  },
  { name: "seat_period_moves", label: "자리 교시이동", ko: "랩실·JJ실 출석부 하루짜리 교시 선택(출결 아님)", internal: true },
  { name: "seat_period_pins", label: "자리 교시고정", ko: "랩실·JJ실 출석부 요일별 교시 고정(출결 아님)", internal: true },
  { name: "seat_placements", label: "자리 배치", ko: "랩실·JJ실 출석부 카드 배치(출결 아님)", internal: true },
  {
    name: "share_link_views", label: "보고서 열람",
    ko: "공개 수업보고서 링크(/r) 열람 기록 — 열 때마다 한 줄(연 사람은 모른다)",
    notes:
      "공개 링크를 연 횟수(lesson_report_id별 count)이며 누가 열었는지는 알 수 없다 — 발송 전 열람은 내부 미리보기일 수 있고, ip_hash로 사람을 확정할 수 없다. 학부모 앱 읽음은 lesson_reports.classnote_read_at으로 따로 확인한다. viewed_at = 열람 시각(UTC).",
  },
  {
    name: "shuttle_boardings", label: "셔틀 탑승",
    ko: "셔틀 실제 탑승 기록 — 날짜×학생×회차",
    notes:
      "boarded_on = 날짜. io_kind: in=등원(승차) · out=하원(하차). status: boarded=탑승 · missed=미탑승(memo = 사유) · extra=추가 탑승(정기 배정에 없는데 그날 탐). vehicle_label·stop_label·run_no는 기록 당시 이름 스냅샷이라 편성이 바뀌어도 그대로 읽힌다. 예정은 shuttle_riders(정기)·shuttle_ride_exceptions(그날만).",
    columns: { notify_parent: "학부모 탑승 알림 대상인가([전송]=true · [저장]=false)", recorded_by: "기록한 직원" },
  },
  { name: "shuttle_history_acks", label: "셔틀 변경확인", ko: "셔틀 변경 내역 확인 표식(직원 화면에서 내림)", internal: true },
  {
    name: "shuttle_ride_exception_history", label: "셔틀 당일이력",
    ko: "셔틀 그날만 변경의 이력 장부(추가만 됨)",
    notes:
      "op: create · update · cancel. kind: skip · add, io_kind: in · out. actor_kind: staff · parent · system(actor_name = 이름 스냅샷). before_label·after_label = 바뀌기 전·후 타는 곳 이름. 수정·삭제되지 않는다.",
  },
  {
    name: "shuttle_ride_exceptions", label: "셔틀 당일변경",
    ko: "셔틀 그날만 탑승 변경(오늘만 탐·안 탐) — 예정",
    notes:
      "kind: skip=그날 안 탐 · add=그날만 탐(run_stop_id = 타는 곳). io_kind: in=등원 · out=하원. on_date = 그날. actor_kind로 직원·학부모가 건 것을 가른다. 실제 탔는지는 shuttle_boardings — 둘을 섞지 말 것.",
  },
  {
    name: "shuttle_rider_history", label: "셔틀 배정이력",
    ko: "셔틀 정기 배정 변경 이력(추가만 됨)",
    notes: "요일 하나(weekday)의 타는 곳을 바꿀 때마다 한 줄. before_label·after_label = 이전·이후 타는 곳(null = 그 요일 배정 없음), reason = 사유.",
  },
  {
    name: "shuttle_riders", label: "셔틀 배정",
    ko: "셔틀 정기 배정 — 학생이 어느 회차·정류장에서 어느 요일에 타나",
    notes:
      "run_stop_id → shuttle_run_stops(회차×정류장). io_kind: in=승차(등원) · out=하차(하원). weekdays = 타는 요일 배열(mon~sun, 비어 있을 수 없음). '셔틀 이용 학생 수' = 이 표의 distinct student_id. 오늘 배정은 shuttle_run_stops를 거쳐 shuttle_runs.season과 해당 요일로 거르고 당일 예외를 반영한다 — 시즌을 확인하지 못하면 학기중·방학중을 합치지 말고 나눠 밝힌다. 그날만 변경은 shuttle_ride_exceptions, 실제 탑승은 shuttle_boardings.",
  },
  {
    name: "shuttle_run_stops", label: "셔틀 노선",
    ko: "셔틀 노선 한 칸 — 회차×정류장×순서×도착 시각",
    notes: "kind: stop=정류장(stop_id 필수) · depart=학원 출발 · arrive=학원 도착. at_time = 도착 예정 시각, sort_order = 순서.",
  },
  {
    name: "shuttle_runs", label: "셔틀 회차",
    ko: "셔틀 회차 — 차량의 하루 운행 한 바퀴",
    notes:
      "season: term=학기중 · vacation=방학중(코드가 값을 늘릴 수 있다). direction: in=등원 · out=하원(회차의 성격 — 학생 개인 승하차는 shuttle_riders.io_kind). run_no = 회차 번호, vehicle_id → shuttle_vehicles.",
  },
  {
    name: "shuttle_stops", label: "셔틀 정류장",
    ko: "셔틀 정류장 마스터",
    notes: "archived=true면 안 쓰는 정류장(지난 기록 때문에 지우지 않는다). lat·lng·radius_m = 위치와 도착 판정 반경(m), address = 표시 주소.",
  },
  {
    name: "shuttle_trips", label: "셔틀 운행",
    ko: "셔틀 운행 — 그날 그 회차의 출발·종료 시각",
    notes:
      "ran_on = 날짜. started_at·ended_at 둘 다 null = 출발 전 · started_at만 = 운행 중 · ended_at까지 = 종료(UTC). 탑승 인원·진행률은 저장하지 않고 shuttle_boardings에서 센다. vehicle_label·run_no는 이름 스냅샷.",
  },
  {
    name: "shuttle_vehicles", label: "셔틀 차량",
    ko: "셔틀 차량 — 이름·기사",
    notes: "archived=true면 안 쓰는 차량. 기사는 계정이 없을 수 있어 driver_name·driver_phone이 글자로 있고, 계정이 있으면 driver_user_id.",
  },
  { name: "slack_connections", label: "슬랙 연결", ko: "슬랙 알림 연결(지점당 1행, 봇 토큰)", internal: true },
  { name: "slack_inbox", label: "슬랙 수신함", ko: "슬랙으로 보낼 사건 수신함", internal: true },
  { name: "slack_link_codes", label: "슬랙 연결코드", ko: "슬랙 계정 연결 확인 코드", internal: true },
  { name: "slack_outbox", label: "슬랙 발송함", ko: "슬랙 발송 대기열", internal: true },
  { name: "slack_rules", label: "슬랙 규칙", ko: "슬랙 알림 규칙(무엇을 어디로 보낼지)", internal: true },
  { name: "slack_user_links", label: "슬랙 계정연결", ko: "직원 계정 ↔ 슬랙 사용자 연결", internal: true },
  {
    name: "staff_attendance_days", label: "직원 근태",
    ko: "직원 출퇴근 — 직원×날짜 한 줄(강사평가 근태)",
    notes:
      "work_date = 근무일(한국 날짜). status: present=출근 · late=지각(late_minutes 분) · absent=결근 · leave=휴가 · off=휴무. check_in_at·check_out_at = 출퇴근 시각(UTC — 한국 시각은 at time zone 'Asia/Seoul'). source: makeedu=메이크에듀(연동 PC) · kiosk=키오스크 · manual=직접 입력.",
  },
  {
    name: "staff_contracts", label: "직원 계약",
    ko: "직원 계약 이력 — 회차별 계약 기간·조건",
    notes:
      "kind: contract=계약 줄 · note=메모 줄(계약이 아님 — terms에 '퇴사'가 들어간 note 줄 = 퇴사 기록(앱은 '퇴사 (날짜)' · 시트에서 옮긴 줄은 원문 그대로), start_date = 퇴사일(비어 있으면 날짜 모름) · '입사'가 들어간 note 줄 = 입사·재입사 기록). seq = 계약 회차, start_date~end_date = 계약 기간, terms = 계약조건 원문(급여제·시간제 등 글자). '계약 만료 임박'은 kind='contract'의 end_date로 본다.",
  },
  {
    name: "staff_leaves", label: "직원 휴가",
    ko: "직원 휴가(옛 '휴가 관리') — 기간·유형·승인",
    notes:
      "leave_type은 한글 값 그대로: 연차 · 반차 · 병가 · 경조사 · 기타. starts_on~ends_on(양 끝 포함). approved_at null = 승인 대기, 값 = 승인됨(approved_by). 운영에서 실제로 쓰는 연차 신청은 전자결재의 leave_forms라 이 표는 거의 비어 있다.",
  },
  {
    name: "staff_task_assignees", label: "할 일 담당",
    ko: "할 일 담당자 — 할 일×직원",
    notes: "task_id → staff_tasks, user_id → users. '직원별 미처리 할 일'은 이 표로 staff_tasks를 잇는다.",
  },
  {
    name: "staff_task_events", label: "할 일 이력",
    ko: "할 일 처리 이력",
    notes: "event: opened · reopened · assigned · retry_requested · failed_again · done · cancelled · expired. at = 시각(UTC), actor_id = 한 사람.",
  },
  { name: "staff_task_notifications", label: "할 일 알림", ko: "할 일 ↔ 알림 연결", internal: true },
  {
    name: "staff_tasks", label: "할 일",
    ko: "업무 처리 확인(할 일) — 원래 기록의 사실로 자동으로 열리고 닫힘",
    notes:
      "kind: report_send_failed 보고서 발송 실패 · unsent_report 미발송 보고서 · followup_due 상담 후속조치 · enrollment_followup 콜&상담 후속 · progress_anomaly 진도 기록 이상 · attendance_absent_desk 결석 확인 전화 · video_upload_check 영상 업로드 확인 · video_unassigned 미배정 영상 · approval_turn 전자결재 차례 · withdrawal_step 퇴원보고서 · refund_process 환불 처리 · help_question 도움말 질문. status: open=미처리(due_at이 지나면 화면은 '기한 초과') · done=처리 완료 · cancelled=취소 · expired=기한 만료. 담당자는 staff_task_assignees.",
    columns: { subject_id: "원래 기록 id(보고서·상담 등)", cycle: "같은 대상의 회차 구분", close_reason: "닫힌 까닭" },
  },
  {
    name: "student_consultations", label: "원생상담",
    ko: "원생 상담 기록 — 상담자·일시·요약·후속조치",
    notes:
      "'언제 상담'은 consulted_at(UTC — 한국 날짜는 at time zone 'Asia/Seoul'). counselor_id = 상담한 직원. category: general=일반 · academic=학습 · emotional=정서 · career=진로 · social=교우 · other=기타. audience: parent=학부모 · student=학생 · both=학부모+학생. follow_up_date·follow_up_done = 후속조치 기한·완료. class_id = 걸린 반(class_source: auto · manual, null = 미매핑). makeedu_id가 있으면 메이크에듀에서 가져온 상담. 신규 문의 상담은 enrollment_consultations(다른 표).",
    columns: { summary: "상담 내용 요약", follow_up_action: "후속조치 내용", subject: "과목", processing_status: "녹음 처리 단계(idle·uploaded·transcribing·analyzing·completed·failed)" },
  },
  {
    name: "student_contribution_months", label: "원생 기여도",
    ko: "원생 기여도 — 학생×월 원래 수치(점수는 조회 때 계산)",
    notes:
      "month = 'YYYY-MM'. raws = 지표별 원래 수치, correction = 마감 뒤 정정, payload = 근거(jsonb). 점수는 저장하지 않고 현재 배점 설정으로 계산하므로 SQL로 점수를 바로 낼 수 없다. closed_at = 마감 시각, reconstructed = 나중에 남은 기록으로 다시 만든 달.",
  },
  { name: "student_contribution_settings", label: "기여도 설정", ko: "원생 기여도 배점 설정(지점당 1행)", internal: true },
  {
    name: "student_daily_stats", label: "원생 일별통계",
    ko: "원생 매일 기록 — 지점×날짜 그날 재원생 구성(인원 수만)",
    notes:
      "밤마다 cron이 한 줄 쓴다. data(jsonb, v=1): enrolled=재원생(아직 한 과목도 시작 안 한 학생 제외 — 운영실 카드와 같은 집합) · onHold=휴원 · levels=학교급별 · grades=학년별 · schools=학교별 · subjects=과목별 수강생 · gradeMix·programs. 지난 특정 날의 재원생 수는 이 표가 정확하다(students는 지금 상태만 안다). 기록이 시작되기 전 날짜는 없다.",
  },
  {
    name: "student_flow_insights", label: "흐름 분석",
    ko: "학생 상담·기록 흐름 AI 분석(학생×종류 한 줄)",
    notes:
      "kind: consultations=상담 흐름 · timeline=전체 기록 흐름. summary(jsonb) = headline · direction · themes · recentChange · watch · nextSteps. covered_through = 반영한 마지막 기록 시점. AI 해석이라 사실 확인은 원 기록을 본다.",
  },
  {
    name: "student_grades", label: "성적",
    ko: "학생 성적 — 학교 시험·월말평가 점수와 성적표 받기 단계",
    notes:
      "subject = 과목 키(math · english 등). exam_slot: midterm=중간고사 · final=기말고사 · listening=듣기평가 · monthly=월말평가(exam_month 1~12, 다른 시험은 0) · school=내신(옛 행만). school_year·term(1|2) = 학년도·학기. 점수 비교는 score/max_score(만점이 다를 수 있다). no_exam=true면 시험 없음(no_exam_reason). ask1_at=1차상담 · ask2_at=2차상담 · received_at=학원이 성적표를 받아 확인했다고 표시한 시각(학부모에게 전달한 시각이 아니다). area_scores = 영어 Monthly Test 영역 점수(score는 그 합). exam_name = 시험 표시 이름.",
    columns: { taken_on: "응시일", exam_id: "학원 시험(exams) 연결", class_id: "성적이 걸린 반" },
  },
  {
    name: "student_history_monthly", label: "원생 월별통계",
    ko: "원생 통계 지난 기록 — 지점×달×출처 월별 집계",
    notes:
      "month = 그 달 1일. source: makeedu=메이크에듀(2020-01~2025-12 수납·원생 + 2025-03~ 재원생 기록) · aywa=에이와 청구·원생(밤마다 다시 센다). 같은 달에 둘 다 있으면 aywa가 우선. data(jsonb) 칸: payingTotal=그달 수업료 청구 학생 · payingMath·payingEnglish 등 프로그램별 · stoppedPaying=그달로 청구가 끊긴 학생 · newReal=실제 신규 · newRegistered · enrolledRecord=재원생 기록. 월별 신규·퇴원 추이 화면이 이 표만 읽는다.",
  },
  {
    name: "student_homework_videos", label: "숙제 영상",
    ko: "숙제 영상 수신·Drive 보관 작업 — 영상 한 개당 한 줄",
    notes:
      "source: classnote=ClassNote 학부모 글 · drive=담임 폴더에 직접 · link=에이와 제출 링크. status: queued=대기 · processing=처리 중 · uploaded=보관 완료 · failed=실패 · review=직접 올렸지만 세지 못해 확인 필요. posted_at = 올린 시각, uploaded_at = 보관 완료 시각(UTC). attempts·locked_at·lock_token은 작업 큐 칸. 숙제 제출 판정은 video_homework_marks·video_homework_auto_outcomes.",
  },
  {
    name: "student_memos", label: "학생 메모",
    ko: "학생 메모 — 직원이 남긴 분류별 메모",
    notes:
      "category: general=일반 · homework=숙제/과제 · behavior=행동 · parent=학부모 · health=건강 · special_class=특별반 · other=기타. pinned = 고정, created_by = 작성자, searchable = 학생 검색에 쓸지. 학생 기본정보의 메모 칸(students.notes)과 다른 표.",
  },
  {
    name: "student_onboarding_checks", label: "신규생 체크",
    ko: "신규생 관리 체크리스트 — 학생×과목×항목 한 줄",
    notes:
      "item_key = 체크 항목 키(앱 상수). done_on이 null이면 행이 있어도 미완료(메모만 적힌 것). subject '' = 과목 무관(옛 기록). 기한은 저장하지 않고 등록일·첫 수업일에서 앱이 계산한다. consultation_id = 이 체크를 만든 상담, done_by = 처리한 직원.",
  },
  { name: "student_ontology_summaries", label: "학생 AI요약", ko: "학생 최근 기록 AI 발췌 요약(요청자별 캐시)", internal: true },
  { name: "student_ontology_summary_daily_usage", label: "AI요약 사용량", ko: "학생 AI 요약 하루 사용량", internal: true },
  { name: "student_parent_event_imports", label: "설명회 가져오기", ko: "학부모 설명회 자료 가져오기 실행 기록", internal: true },
  {
    name: "student_parent_event_recognitions", label: "설명회 인정",
    ko: "학부모 설명회 기여 인정 — 학생×행사",
    notes:
      "basis: direct · household · sibling(형제로 인정). state: recognized=인정 · cancelled=취소. 형제도 각자 인정되고 같은 학생·같은 행사는 한 번이다. event_id → student_parent_events.id(text).",
  },
  {
    name: "student_parent_event_registrations", label: "설명회 신청",
    ko: "학부모 설명회 신청 한 건(시트 원본 행)",
    notes:
      "state: recognized=인정 · cancelled=취소 · review=검토 필요 · scheduled=행사 전. attendance_basis: explicit_attendance=참석 확인 · registration_policy=취소 안 된 신청을 참석으로 간주 · unconfirmed · cancellation · future_event. 학생 연결은 student_parent_event_recognitions.",
  },
  { name: "student_parent_event_revisions", label: "설명회 원문", ko: "학부모 설명회 신청 원문 버전", internal: true },
  {
    name: "student_parent_events", label: "설명회",
    ko: "학부모 설명회 행사",
    notes: "status: active · cancelled. event_date = 행사일, session = 회차, title = 행사 이름.",
  },
  {
    name: "student_positive_signals", label: "긍정 신호",
    ko: "학생 긍정 신호 판정 — 학부모·강사 글에서 찾은 관찰된 칭찬",
    notes:
      "source: parent=학부모 글 · teacher=강사 글(source_id = 원문 id). classification: observed=관찰된 긍정 · unsupported_praise=근거 없는 칭찬 · thanks=인사 · other. method: rule=규칙 · ai=AI. cancelled_at이 있으면 취소된 판정(집계에서 뺀다). occurred_on = 원문 날짜, evidence = 근거 문구.",
  },
  {
    name: "student_siblings", label: "형제",
    ko: "원생 형제 짝 — 사람이 정한 것만",
    notes:
      "linked=true = 형제로 지정 · linked=false = 자동 판정(학부모 휴대폰이 같음 등)을 사람이 '형제 아님'으로 뺀 짝. 자동 형제 판정은 저장되지 않아 이 표만으로 형제 전체를 알 수 없다. 짝은 student_a < student_b 한 줄.",
  },
  {
    name: "students", label: "원생",
    ko: "원생 — 학생 한 명당 한 줄(상태·학교·학년·보호자 연락처·등록일·퇴원일)",
    notes:
      "status: enrolled=재원 · on_hold=휴원 · withdrawn=퇴원 · prospect=예비 · consulted=상담완료. 신규 = enrolled_at(등록일), 퇴원 = withdrawn_at(퇴원일) — 둘 다 한국 날짜. 퇴원이 아닌데 withdrawn_at이 있으면 퇴원 예약(그날 퇴원 처리). 집계에서 뺄 것: is_test=true · notes가 '중복 병합:'으로 시작(병합으로 흡수된 쪽) · withdrawal_metadata->>'memo'가 '데이터 정리 일괄 퇴원'이거나 '수강 반 없음 일괄 퇴원 처리'로 시작(장부 정리) — 끝난 수강이 없거나 withdrawal_metadata->>'noClassRecord'='true'(출결·청구 0)면 퇴원으로 세지도 말하지도 않는다(onto_students.exit_kind='bookkeeping'). 앱의 월 퇴원 수는 퇴원월을 수업료를 낸 마지막 달로 보정해 단순 집계와 조금 다를 수 있다. 반·과목은 enrollments.",
    columns: {
      grade: "학년 원문(예: 중2)",
      school: "학교 이름 원문",
      enrolled_at: "등록일(신규 기준)",
      withdrawn_at: "퇴원일(또는 예약된 퇴원일)",
      withdrawal_metadata:
        "퇴원 정보 jsonb — reason(dissatisfaction 수업·강사 · grades 성적 · motivation 학생 상태 · method 공부 방법 변경 · competitor 타 학원 이동 · schedule 시간/일정 · financial 경제적 이유 · career 진로·진학 · peers 가족·친구 · illness 질병 · advised 권고퇴원 · relocation 이사 · graduated 졸업 · other 기타) · detail · memo · consultation",
      is_test: "테스트 학생(집계에서 뺀다)",
      dup_suspect: "중복 의심 표시",
      notes: "학생 메모 칸(병합 표식이 앞에 붙기도 한다)",
      parent_name: "보호자1 이름(parent_phone·parent_relation 함께)",
      parent2_name: "보호자2 이름(parent2_phone·parent2_relation 함께)",
      attendance_code: "키오스크 출석 번호",
      makeedu_id: "메이크에듀 원생 id(동기화 키)",
      sync_added_at: "동기화로 처음 들어온 시각",
      name_normalized: "공백 뺀 소문자 이름(검색용, 자동 생성)",
      classnote_name: "ClassNote 표시 이름",
      ai_care_summary: "AI 관리 요약",
    },
  },
  { name: "super_admin_audit_logs", label: "운영자 감사", ko: "운영자(슈퍼관리자) 작업 감사 기록", internal: true },
  { name: "super_admins", label: "운영자", ko: "운영자(슈퍼관리자) 명단", internal: true },
  { name: "support_notices", label: "고객센터 공지", ko: "고객센터 공지(운영자 → 전 지점, tenant_id 없음)", internal: true },
  {
    name: "support_requests", label: "개선요청",
    ko: "고객센터 개선요청 — 지점 직원 → 운영자",
    notes: "status: received=접수 · checking=내용확인 · in_progress=처리중 · done=완료. due_date = 처리 예정일, answer = 운영자 답변(answered_at). author_id = 쓴 직원.",
  },
  { name: "sync_agent_attempts", label: "에이전트 시도", ko: "연동 PC 에이전트 등록 시도 제한", internal: true },
  { name: "sync_agent_codes", label: "에이전트 코드", ko: "연동 PC 에이전트 등록 코드", internal: true },
  { name: "sync_agent_devices", label: "에이전트 기기", ko: "연동 PC 에이전트 기기", internal: true },
  { name: "sync_agent_events", label: "에이전트 로그", ko: "연동 PC 에이전트 이벤트 로그", internal: true },
  { name: "sync_agent_management_codes", label: "에이전트 관리", ko: "연동 PC 에이전트 관리 코드", internal: true },
  { name: "sync_agent_module_sessions", label: "에이전트 세션", ko: "연동 PC 에이전트 모듈 실행 세션", internal: true },
  { name: "sync_agent_releases", label: "에이전트 버전", ko: "연동 PC 에이전트 배포 버전", internal: true },
  { name: "sync_agent_schedule_runs", label: "에이전트 예약", ko: "연동 PC 에이전트 예약 실행 기록", internal: true },
  { name: "sync_agent_settings", label: "에이전트 설정", ko: "연동 PC 에이전트 지점 설정", internal: true },
  {
    name: "teacher_evaluation_entries", label: "강사평가 입력",
    ko: "강사평가 — 원장이 만든 지표의 월 입력값(강사×달×지표)",
    notes: "month = 'YYYY-MM', metric_key = 지표 키, value = 값. 마감한 달의 점수는 teacher_portfolio_months에 굳어 있어 여기를 고쳐도 바뀌지 않는다.",
  },
  { name: "teacher_evaluation_presets", label: "강사평가 구성", ko: "강사평가 구성 저장본", internal: true },
  { name: "teacher_evaluation_settings", label: "강사평가 설정", ko: "강사평가 설정(지점당 1행)", internal: true },
  { name: "teacher_ment_styles", label: "멘트 말투", ko: "강사별 보고서 멘트 말투 프로파일(AI 자동작성용)", internal: true },
  {
    name: "teacher_portfolio_months", label: "강사평가 점수",
    ko: "강사평가(직원 포트폴리오) 월간 점수 — 강사×월",
    notes:
      "month = 'YYYY-MM'. total = 그 달 총점(산출 불가면 null), known_count = 산출된 항목 수, class_count = 반 수, payload = 항목별 점수와 근거(jsonb), raws = 지표별 원래 수치. closed_at이 있으면 마감(수정 불가) — closing_source: month_end=말일 직후 마감 · reconstructed=나중에 남은 기록으로 다시 만든 마감. 진행 중인 달은 period_end(집계 전날)까지 반영.",
  },
  {
    name: "teacher_satisfaction_claims", label: "만족도 클레임",
    ko: "강사평가 학부모 만족도 — 원장이 넣은 클레임·칭찬(± 점수)",
    notes: "points = 가감점(±). occurred_on = 일어난 날, content = 내용. cancelled_at이 있으면 취소(지우지 않고 남긴다 — 집계에서 뺀다).",
  },
  {
    name: "teacher_satisfaction_judgments", label: "만족도 판정",
    ko: "강사평가 학부모 만족도 — 학부모 글 한 건의 판정",
    notes:
      "verdict: plus=가점 · minus=감점. state: applied=반영 · pending=확인 대기 · dismissed=무시 · cancelled=반영했다가 취소 · none=판정 없음. method: rule=문구 규칙 · ai · manual=사람. 점수와 대상 강사는 저장하지 않는다(그 달 설정·그날 담임으로 집계 때 계산). message_id → classnote_parent_messages, posted_on = 글 날짜, phrase = 근거 문구.",
  },
  {
    name: "teacher_schedule_blocks", label: "강사 비수업",
    ko: "강사 시간표의 비수업 블록(감독·준비·회의·연차·쉬는 시간)",
    notes:
      "kind: supervise=다른 수업 감독 · prep=수업 준비 · break=쉬는 시간 · meeting=회의 · leave=연차 · other. day_of_week(mon~sun) + start_time~end_time, valid_from~valid_to = 유효 기간(valid_to null = 계속). 반이 아니라 수강·청구·급여와 무관하다. teacher_label이 기준이고 teacher_id는 풀렸을 때만. 지금은 영어 시간표용.",
  },
  { name: "tenant_ai_models", label: "AI 모델설정", ko: "지점·기능별 AI 모델 선택(운영자 설정)", internal: true },
  { name: "tenant_licenses", label: "기능 스위치", ko: "지점별 기능 스위치·라이선스(운영자 설정)", internal: true },
  {
    name: "tenant_settings", label: "학원 설정",
    ko: "학원 설정 문서 — 지점당 한 줄(jsonb)",
    notes:
      "과목·교시·학년·청구 기본값·권한 같은 학원 맞춤 값이 data(jsonb)에 들어 있다. 과목 목록 = data->'operations'->'subjects'(과목 키·이름·영역), 메뉴 권한 = data->'permissions'. 다른 표의 subject·subject_key 값이 이 과목 키다.",
  },
  {
    name: "tenants", label: "지점",
    ko: "지점(학원) — 모든 표의 tenant_id가 가리키는 곳",
    notes: "name = 지점 이름, slug = 짧은 이름, plan = 요금제.",
  },
  {
    name: "textbook_catalog", label: "교재 단가",
    ko: "교재 단가표(수납용) — 교재·가격",
    notes:
      "price = 단가(원). is_active=false면 안 쓰는 교재. grade_level·subject는 자유 글/과목 키, book_detail = 단원·상세. makeedu_id가 있으면 메이크에듀에서 동기화. 수업 교재 마스터(textbooks)와 다른 표 — 금액은 이 표.",
  },
  {
    name: "textbook_lessons", label: "교재 차수",
    ko: "교재 차수별 진도·과제 — 교재×차수 한 칸",
    notes: "textbook_id → textbooks, lesson_no = 차수, progress·homework = 그 차수의 진도·과제. 영어 반에 배정하면 강사 시트 계획 줄로 흘러간다.",
  },
  {
    name: "textbook_orders", label: "교재 신청",
    ko: "교재 신청 — 학생별 교재 요청과 등록·주문·납부 체크",
    notes:
      "price = 교재 금액(원). status는 체크에서 파생: paid=납부(paid_at) > ordered=주문(ordered_at) > requested=신청. registered_at = 등록 체크(상태와 별개). request_date = 신청일. teacher_name = 담당 강사(글자 — 소유 기준), created_by = 실제 저장한 계정, student_name = 저장 당시 이름. classnote_notice_id가 있으면 학부모 공지로 나갔다. status_at·status_by_name = 마지막 체크 변경.",
    columns: { check_dismissed_at: "메이크에듀 자동 체크에서 영구 제외한 시각" },
  },
  {
    name: "textbooks", label: "교재목록",
    ko: "교재목록 — 수업 교재 마스터(구분·페이지/시간·차수 수·표지)",
    notes:
      "subject = 과목 키, skill_area = 영역 키(null = 미지정), session_count = 차수 수, page_time = 페이지 또는 시간, is_active=false면 안 씀. 금액은 textbook_catalog(별개 표). 차수별 진도·과제는 textbook_lessons, 영어 반 배정은 class_textbook_plans, 수학 배정은 math_textbook_assignments.",
  },
  {
    name: "timetable_cell_memos", label: "시간표 칸메모",
    ko: "영어 강사뷰 시간표 칸 메모 — 날짜×강사×칸",
    notes: "memo_date = 그 날짜 칸에만 붙는 메모, start_min = 칸 시작 시각(분), teacher_key = 'u:<users.id>' · 's:LAB|JJ' · 'l:<라벨>' 꼴, body = 내용, updated_by = 마지막 수정자.",
  },
  { name: "timetable_import_logs", label: "시간표 가져오기", ko: "시간표 엑셀 가져오기 이력", internal: true },
  { name: "timetable_lab_apply_jobs", label: "연습본 적용", ko: "시간표 연습본 적용 예약 작업", internal: true },
  { name: "timetable_lab_drafts", label: "시간표 연습본", ko: "영어 시간표 연습본 스냅샷(운영 시간표에 자동 적용 안 됨)", internal: true },
  {
    name: "timetable_memo_sheets", label: "시간표 메모시트",
    ko: "시간표 옆 메모 시트 — 지점×과목 한 장",
    notes: "doc = 엑셀처럼 쓰는 자유 표(접힌 jsonb 모양이라 SQL로 읽기 어렵다). updated_by·updated_at = 마지막 저장.",
  },
  { name: "timetable_snapshots", label: "시간표 백업", ko: "시간표 엑셀 가져오기 직전 백업(복원용)", internal: true },
  { name: "todays_math_exam_report_links", label: "오늘수학 성적표", ko: "오늘 수학 월말평가 성적표 PDF ↔ 수업보고서 첨부 상태", internal: true },
  { name: "todays_math_result_days", label: "오늘수학 반영", ko: "오늘 수학 채점 결과의 날짜별 반영 지문", internal: true },
  {
    name: "todays_math_test_results", label: "오늘수학 결과",
    ko: "오늘 수학(외부 채점 앱) 시험 결과 — 시험×학생의 마지막 채점",
    notes:
      "kind: daily · review · monthly · unit · school · other(오늘 수학 원문 값). score/max_score, correct_count/question_count. absent=true면 결시 — 점수가 null이니 0점으로 세지 말 것. test_date = 시험일. 10분마다 날짜 단위로 통째로 갈아끼워진다. student_id·class_id는 에이와 id(FK 없음).",
  },
  {
    name: "tuition_catalog", label: "수강료 단가",
    ko: "수강료 단가표 — 과정별 회당·월 단가와 할인 항목",
    notes:
      "category = 분류 라벨(수학 · EIE · 영어 · 국어 · 기타 · 할인 등). price = 원. pricing_mode: per_session=회당 단가 · monthly=월 단가 · extra(원문 값) · discount=할인액 · null=미지정. note = 비고(시수 표기 등). is_active=false면 안 씀. 실제 청구 금액은 청구서(invoices) 쪽.",
  },
  {
    name: "tuition_quotes", label: "수강료 견적",
    ko: "수강료 견적 — 신입생 상담 때 계산기로 저장한 견적",
    notes:
      "재원생 청구(invoices)와 완전히 별개. 학생 정보는 자유 입력 글(student_name · school · grade — students와 연결 없음). courses·extras·discounts = 과목·추가 항목·할인 스냅샷(jsonb), total_amount = 총액(원), consultant = 상담 담당 이름.",
  },
  { name: "user_integrations", label: "시트 연동", ko: "구글 시트 연동 설정(지점)", internal: true },
  {
    name: "users", label: "직원",
    ko: "직원 계정 — 이름·역할·재직 상태·담당 과목·급여 설정",
    notes:
      "system_role: master=원장 · admin=관리자 · manager=매니저 · teacher=강사 · counselor=상담사 · accountant=회계 · viewer=참관 · parttime=아르바이트 · student=학생 계정(직원이 아니다 — 직원 질문에서 뺀다). status: active=재직 · inactive=퇴사 · pending=대기. subjects = 담당 과목 키 배열, hire_date = 입사일(퇴사일 칸은 없다 — 퇴사 메모 줄은 staff_contracts의 kind='note' · terms에 '퇴사'가 들어간 줄 · start_date = 퇴사일 · 퇴사 처리 기록은 audit_logs·activity_log). 금액 칸(hourly_rate·monthly_base)은 원. salary_type: commission=비율제 · fixed=급여제 · hybrid=혼합 · null=미설정. 급여 칸은 민감한 급여 정보 — 비서 보기로 제공된 칸은 질문 범위에서 조회할 수 있다. 🔴 JJ·LAB·보조T 등 자리·업무용으로 확인된 라벨이나 계정은 실명 강사로 세지 않는다(실제 담당자는 직원·배정 기록으로 확인한다).",
    columns: {
      display_name: "실명(표시 이름)",
      report_display_name: "수업보고서 발송용 이름(null = 실명)",
      job_title: "직책",
      department: "근무부서",
      employment_type: "근무형태(정규직 · 아르바이트 · 프리랜서 · 혼합)",
      commission_rate: "기본 매출 배분율 %",
      commission_rates: "과정별 배분율 %(초등·중등·고등·수능·특강, 없으면 기본값)",
      attendance_alert_optin: "학부모 출결 연락 알림 받기(셔틀·사무실)",
      desk_attendance_optin: "출결 데스크 알림 받기",
      shuttle_duty: "셔틀 담당",
      seat_lab_duty: "랩실 출석부 담당",
      seat_jj_duty: "JJ실 출석부 담당",
      work_schedule: "근무 일정(jsonb)",
    },
  },
  {
    name: "video_homework_auto_outcomes", label: "영상숙제 판정",
    ko: "영상 숙제 자동 판정 — 반×학생×숙제일",
    notes:
      "status: submitted=영상 받음 · missing=기한이 지나도 없음(미제출) · unchecked=판정 당시 아직 마감 전(검사 미완료·판정 지연이 아니다). 🔴 숙제일은 마감일이 아니다 — 제출 마감은 유효한 lesson_reports.video_homework_due, 없으면 숙제일+7일이며 한국 날짜로 마감 당일까지 받는다. video_id → student_homework_videos — submitted일 때만 연결되므로 null만으로 영상이 없다고 판단하지 않는다. 영상과 판정이 다르면 homework_video_assignments·student_homework_videos를 학생·반·숙제일로 대조하고 제외·취소 여부와 observed_at을 확인한다. observed_at = 판정 시각. 강사가 손으로 찍은 검사(video_homework_marks)와 별개. 취소된 숙제의 줄도 남아 있어 지금 있는 숙제 기준으로 걸러야 한다.",
  },
  { name: "video_homework_automation_config", label: "영상숙제 설정", ko: "영상 숙제 자동 판정 시작 시각(전역 1행)", internal: true },
  {
    name: "video_homework_cancels", label: "영상숙제 취소",
    ko: "영상 숙제 취소 기록 — 반×학생×숙제일",
    notes: "잘못 낸 숙제를 거둔 기록. cancelled_at = 취소 시각. 취소하면 그날 보고서의 '영상 과제'·따로 낸 숙제·검사 기록이 함께 거둬지고, 자동 판정 줄(video_homework_auto_outcomes)만 남는다.",
  },
  {
    name: "video_homework_extra_issues", label: "영상숙제 추가",
    ko: "보고서 없이 따로 낸 영상 숙제 — 반×학생×숙제일",
    notes:
      "영상 숙제 전체 = 수업보고서의 '영상 과제 있음' ∪ 이 표. teacher_id = 숙제를 낸 강사, issued_by = 실제로 누른 계정. kept=true는 검사 칸에서 옮겨 남긴 숙제(자동 판정·알림·강사 내 숙제에서 뺀다).",
  },
  {
    name: "video_homework_marks", label: "영상숙제 검사",
    ko: "영상 숙제 검사 기록 — 반×학생×숙제일의 완료·미수행",
    notes:
      "status: submitted=완료 · missing=미수행 · timed(원문 값). updated_by가 null이면 자동 판정이 쓴 줄, 값이 있으면 사람이 찍은 것. homework_date = 숙제일, check_date = 검사한 수업일, submitted_date = 직원이 적은 실제 제출일. 줄이 없거나 다른 값이면 화면에선 '미확인'.",
  },
  { name: "video_homework_rejections", label: "영상숙제 반려", ko: "영상 숙제 반려 표시(반×학생×숙제일)", internal: true },
  { name: "withdrawal_report_archive_mappings", label: "보관본 연결", ko: "옛 퇴원보고서 보관본의 학생 연결 변경 이력", internal: true },
  {
    name: "withdrawal_report_archives", label: "퇴원 보관본",
    ko: "옛 퇴원보고서 보관본 — 구글 시트에서 가져온 과거 보고서",
    notes:
      "앱 도입 전 시트로 쓰던 퇴원보고서. exit_date = 퇴원일(raw_exit_date = 원문 글자), student_name · class_name · teacher_name · subject · school_grade는 시트 글자 그대로, fields = 항목 내용(jsonb). mapping_kind: auto=자동 연결 · manual=사람 연결 · unmapped=미연결(mapped_student_id null). mapped_teacher_id = 연결된 강사. 새 보고서는 withdrawal_reports.",
  },
  {
    name: "withdrawal_report_events", label: "퇴원보고 이력",
    ko: "퇴원보고서 처리 이력 — 요청·제출·승인·반려·처리",
    notes:
      "action: request=작성 요청 · save=임시 저장 · submit=제출 · approve=승인 · reject=반려 · cancel=요청 취소 · apply=퇴원·수강종료 처리 · direct=관리자 바로 처리 · refund=데스크 환불 요청 · release=데스크 환불 완료·처리 · reassign=승인자 정리 · refund_notice=환불 확인 알림. from_status → to_status, created_at = 시각(UTC), comment = 의견.",
  },
  {
    name: "withdrawal_report_groups", label: "퇴원보고 묶음",
    ko: "퇴원보고서 묶음 — 한 학생의 퇴원 요청 하나(강사별 보고서를 묶음)",
    notes:
      "한 요청에 담당 강사마다 보고서 한 장(withdrawal_reports.group_id). status: pending · scheduled=처리 예약 · completed=처리 완료 · blocked=재검토 필요 · canceled=취소. exit_kind: withdrawal=퇴원 · subject_end=과목 수강 종료. effective_date = 퇴원(종료)일, applied_at = 실제 처리 시각. subjects = 대상 과목.",
  },
  {
    name: "withdrawal_report_refunds", label: "퇴원 환불",
    ko: "퇴원보고서 데스크 환불 단계 — 보고서에서 만든 환불 요청서 연결",
    notes: "document_id = 환불 요청서(academy_documents) id(FK 없음), desk_id = 데스크 담당. 요청서의 환불완료일자가 비어 있으면 퇴원 처리가 그 환불을 기다린다.",
  },
  { name: "withdrawal_report_sources", label: "보관본 원본", ko: "옛 퇴원보고서 시트 원본 격자", internal: true },
  {
    name: "withdrawal_reports", label: "퇴원보고서",
    ko: "퇴원보고서 — 강사가 쓰고 관리자가 승인하는 퇴원·과목 종료 보고서",
    notes:
      "exit_kind: withdrawal=퇴원 · subject_end=과목 수강 종료. status: requested=작성 요청 · revision=반려·수정 요청 · manager_pending=관리자 승인 요청 · director_pending=원장 승인 대기 · approved=승인 완료(다른 보고서 대기) · scheduled=처리 예약 · completed=처리 완료 · blocked=수강 변경·재검토 필요 · canceled=요청 취소. 사유 = body->>'reason'(students 퇴원 사유 키와 같다). effective_date = 퇴원(종료)일, applied_at = 학생에 반영된 시각. teacher_id = 작성 강사. 과목마다 보고서가 여러 장이라 '퇴원 몇 명'은 students로 센다.",
    columns: {
      direct: "관리자가 강사 작성 없이 바로 처리한 보고서",
      group_id: "묶음(withdrawal_report_groups)",
      manager_ids: "승인 관리자 목록",
      snapshot: "요청 당시 학생·수강 스냅샷(jsonb)",
    },
  },
  {
    name: "work_request_assignees", label: "업무요청 담당",
    ko: "업무 요청 담당자별 진행 — 확인·처리 보고",
    notes: "state: ready=대기 · acked=확인함 · reported=보고함. outcome: done=처리함 · partial=일부 처리 · blocked=처리 못 함. report_note = 담당자 보고, returned_note = 보완 요청 사유.",
  },
  {
    name: "work_request_events", label: "업무요청 이력",
    ko: "업무 요청 처리 이력",
    notes: "kind: created=업무 요청 · acked=확인함 · reported=처리 보고 · to_review=모두 보고 → 검토로 · returned=보완 요청 · approved=승인·마감 · cancelled=요청 취소. at = 시각(UTC).",
  },
  {
    name: "work_request_links", label: "업무요청 학생",
    ko: "업무 요청에 연결된 학생",
    notes: "target_type = 'student' 하나, target_id = students.id, assignee_id = 그 학생을 맡은 담당자, label = 표시 이름.",
  },
  {
    name: "work_requests", label: "업무요청",
    ko: "업무 요청 — 요청 → 담당자 확인·보고 → 검토 → 마감",
    notes:
      "category: general=일반 · weekly=주간보고 · plan=기획안 · training=교육 · handover=인수인계 · improvement=개선안. status: working=진행 중 · review=검토 대기 · closed=마감 · cancelled=취소. due_on = 기한, requested_by = 요청자, reviewer_id = 검토자(null이면 요청자), closed_at = 마감 시각. 담당자는 work_request_assignees. 자동으로 열리고 닫히는 할 일(staff_tasks)과는 별개.",
  },
  { name: "worker_execution_leases", label: "워커 잠금", ko: "워커 실행 잠금(중복 실행 방지)", internal: true },
];
