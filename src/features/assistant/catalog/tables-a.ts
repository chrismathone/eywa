import type { AssistantTableDoc } from "./types";

/**
 * 학원 비서 DB 지도 — 표 이름 a~l(117개). 근거 = supabase/migrations(s1_season1.sql · s2_*) CHECK·주석과 앱 코드 라벨.
 * 시각 칸(timestamptz)은 UTC로 저장된다 — 학원 날짜로 자를 때는 `(칸 at time zone 'Asia/Seoul')::date`.
 * date 칸(session_date · report_date · expense_date 등)은 이미 한국 날짜다.
 */
export const TABLES_A: readonly AssistantTableDoc[] = [
  {
    name: "academy_documents",
    label: "학원 문서",
    ko: "학원 문서함 — 업로드 파일·글·웹 서식·링크 문서 1건",
    notes:
      "kind: file=업로드 파일 · text=본문 글 · form=웹 서식(form_type·form_data) · link=외부 링크(link_url). category = document_categories.key(기본 enrollment·billing·consultation·hr·class·other + 학원이 만든 분류). form_type 예: refund_request=환불요청서 · staff_resume=직원 이력서(staff_user_id로 직원 연결). restricted=true는 문서함 화면의 접근 구분이다. 언제 = created_at.",
    columns: {
      pinned: "목록 상단 고정",
      form_data: "웹 서식 내용(jsonb) — 이력서 등 · 🔴 통째로 select하지 말고 질문에 필요한 키만 조회한다 · 주민번호는 앞 6자리 + 뒷자리 첫 자리만 보인다(나머지는 가려져 있다 — 그대로 옮긴다)",
      staff_user_id: "이력서가 가리키는 직원(users.id)",
      uploaded_by: "올린 사람(users.id)",
    },
  },
  {
    name: "activity_log",
    label: "변경 이력",
    ko: "표 변경 이력(DB 트리거) — 누가 어떤 행을 생성·수정·삭제했나",
    notes:
      "op: INSERT=생성 · UPDATE=수정 · DELETE=삭제. table_name=바뀐 표, row_id=대상 행 id, target_label=사람이 읽는 대상 이름. changed: UPDATE는 바뀐 칸만 {칸:{old,new}}, INSERT·DELETE는 스냅샷 — 민감 칸은 {redacted:true}로만 남는다. actor_id null = 시스템·동기화. 업무 행위 단위 기록은 audit_logs. 언제 = created_at.",
    columns: {
      actor_name: "기록 당시 표시 이름(계정이 지워져도 남음)",
    },
  },
  {
    name: "ai_prompt_overrides",
    label: "AI 프롬프트",
    ko: "수업보고서 AI 멘트 프롬프트의 학원별 덮어쓰기",
    notes: "prompt_type: comment=단일 멘트 · trend=학습 추세 · comment_p1/comment_p2=공지 모드 2문단. is_active=사용 중.",
    internal: true,
  },
  {
    name: "ai_usage_logs",
    label: "AI 사용량",
    ko: "AI 호출 사용량 장부 — 호출 1건마다 기능·모델·토큰",
    notes:
      "feature=호출한 기능(예 daily_briefing·classnote_ment·enrollment_analysis), provider=회사(예 anthropic·openai), ok=false면 실패(error). input_tokens에는 캐시 토큰이 들어 있지 않다 — cache_read_tokens·cache_write_tokens를 따로 더한다. 캐시 단가는 모델·보관 시간에 따라 다르며 금액 칸은 없다. 토큰 수를 그대로 청구 금액으로 쓰지 않는다. 언제 = created_at.",
    columns: {
      key_name: "과금 키 묶음(예 default·consultations)",
    },
  },
  {
    name: "announcements",
    label: "직원 공지",
    ko: "앱 안 직원 공지 게시글(대상 역할별)",
    notes:
      "audience: all=전체 · staff=직원 · office=운영진 · teachers=강사 · counselors=상담 · accounting=회계. pinned=상단 고정. 학부모에게 가는 공지가 아니다(ClassNote 공지는 classnote_notices·classnote_class_notices).",
  },
  {
    name: "approval_basic_forms",
    label: "품의서",
    ko: "품의서 본문(전자결재 문서 1:1)",
    notes: "document_id = approval_documents.id. body_html=본문 HTML. 상태는 approval_documents.status.",
  },
  {
    name: "approval_comments",
    label: "결재 댓글",
    ko: "전자결재 문서 댓글(참여자 보충 설명)",
    notes: "document_id → approval_documents. 결재 의견(approval_steps.comment)과 별개.",
  },
  {
    name: "approval_documents",
    label: "전자결재",
    ko: "전자결재 문서 1건 — 휴가·품의·지출·수입 결의서 공통 머리",
    notes:
      "form_type: leave=휴가신청서 · proposal=품의서 · expense=지출결의서 · income=수입결의서(상세는 leave_forms·approval_basic_forms·approval_expense_forms·approval_income_forms, document_id 1:1). status: pending=진행중 · approved=승인 · rejected=반려 · canceled=회수(기안자가 거둠). current_step=지금 결재할 차례(approval_steps.step_no). 언제 = submitted_at(기안)·completed_at(종결).",
    columns: {
      doc_no: "문서번호(예 '휴가-2026-0001')",
      drafter_id: "기안자(users.id)",
      outcome_note: "마지막 판단 요약 한 줄",
    },
  },
  {
    name: "approval_expense_forms",
    label: "결재 지출결의서",
    ko: "지출결의서 상세(전자결재 문서 1:1)",
    notes:
      "amount 원 · spend_date=지출일 · category 인건비·운영비·매입·마케팅·기타. 🔴 수납관리 지출(expenses)과 별개라 재무 집계에 들어가지 않는다 — '이번 달 지출'은 expenses로 센다. 승인 여부는 approval_documents.status.",
  },
  {
    name: "approval_income_forms",
    label: "수입결의서",
    ko: "수입결의서 상세(수강료 외 수입, 전자결재 문서 1:1)",
    notes:
      "amount 원 · income_date=수입일 · category 예 교재 판매·특강·행사·기타. 수강료는 invoices 소관이라 여기 없고 재무 집계와도 별개. 승인 여부는 approval_documents.status.",
  },
  {
    name: "approval_line_templates",
    label: "결재선 즐겨찾기",
    ko: "개인이 저장한 자주 쓰는 결재선",
    internal: true,
  },
  {
    name: "approval_refs",
    label: "결재 참조자",
    ko: "전자결재 참조자(결재하지 않고 열람만)",
    notes: "document_id → approval_documents, user_id = 참조 직원.",
  },
  {
    name: "approval_steps",
    label: "결재선",
    ko: "결재선 한 칸 — 결재자·순서·판단",
    notes:
      "step_no=순서(1부터). decision: pending=대기 · approved=승인 · rejected=반려 · final=전결(즉시 종결) · deferred=후결 대기(건너뜀) · post_approved=후결 확인 · skipped=전결로 생략. acted_by=대결 실제 처리자(null=결재자 본인). decided_at=판단 시각.",
    columns: {
      role_label: "결재란 직함('검토'·'승인')",
      comment: "결재 의견",
    },
  },
  {
    name: "assistant_conversations",
    label: "옛 AI 대화",
    ko: "옛 운영실 AI 비서(0117a) 대화 기록 — 사람별 대화 1건=1행",
    internal: true,
  },
  {
    name: "attendance_checkins",
    label: "등하원",
    ko: "키오스크 등하원 기록 — 학생×날짜 현관 출입 시각",
    notes:
      "checkin_date = 한국 날짜, checked_in_at·checked_out_at = 등원·하원 시각(UTC). access_method: manual=수동 · kiosk=키오스크. 반·교시 수업 출결이 아니다 — 출석·결석은 attendance_records.",
    columns: {
      device_id: "찍은 키오스크(kiosk_devices.id)",
    },
  },
  {
    name: "attendance_day_recaps",
    label: "출결 요약",
    ko: "어제 출결 요약 AI 문장 저장(숫자·명단은 저장 안 함)",
    notes: "recap_date=범위 마지막 날, from_date=첫 날(KST). status: idle·analyzing·completed·failed. summary={headline, points[]}.",
    internal: true,
  },
  {
    name: "attendance_followups",
    label: "결석 연락",
    ko: "결석·미확인 학생 데스크 연락 처리 기록(학생×반×수업일·교시)",
    notes:
      "signal: absent=강사가 결석 입력 · unmarked=같은 교시 다른 학생은 찍혔는데 이 학생만 빈 칸. state: open=연락 중/대기 · resolved=매듭지음 · dismissed=확인 불필요. outcome: coming=곧 옴 · absent_today=오늘 안 옴 · sick=아파서 · already_here=이미 옴 · no_answer=연락 안 됨 · other=기타 — 출결과 1:1이 아니다. contacted_via: phone·kakao·in_person·other. 출결은 여기서 바뀌지 않는다(attendance_records).",
    columns: {
      handled_by: "처리한 직원",
      handled_at: "처리 시각(UTC)",
      slot_start: "교시 시작 시각(null=그날 전체)",
    },
  },
  {
    name: "attendance_notifications",
    label: "등하원 알림",
    ko: "키오스크 등하원 학부모 알림 발송 기록",
    notes: "kind: checkin=등원 · checkout=하원. channel: simulated(채널 미설정) · kakao. status: simulated · queued · sent · failed.",
    internal: true,
  },
  {
    name: "attendance_records",
    label: "출결",
    ko: "수업 출결 — 학생×반×수업일(×교시). 정정은 새 행으로 쌓인다",
    notes:
      "status: present=출석 · late=지각 · absent=결석 · excused=공결(인정 결석 — 출석부 칸엔 결석 표시) · early_leave=조퇴 · makeup=보강. 🔴 같은 (학생·반·session_date·slot_start)에 행이 여럿이면 recorded_at 최신 1건만 유효(distinct on). 출석률 = (present+late) ÷ 유효 기록 수(보강·조퇴는 분자 아님, 기록 없는 칸은 분모 밖). 시수 = present·late·early_leave·makeup의 coalesce(session_units,1) 합. 반 없는 보강은 classes.is_makeup_pool 반에 앉는다. students.is_test 제외.",
    columns: {
      session_date: "수업일(한국 날짜)",
      slot_start: "교시 시작 시각(class_schedules.start_time과 같은 값). null=그날 전체(2026-08-10 이전 기록)",
      session_units: "시수 배수. null=1, 보강 연장 1.5/2, 부분 출석 0.5",
      seat_label: "자리 수업 표시 LAB(랩실)·JJ(JJ실). null=일반 수업(담임 시수 집계는 null만)",
      recorded_by: "입력한 사람(키오스크면 null)",
      recorded_via: "입력 주체 teacher=강사 · desk=데스크 · seat=자리 · kiosk=키오스크 · null=미상",
      taught_by: "대신 보강한 강사(이 칸 시수를 그 강사 몫으로). null=교시 담당→담임",
      supersedes_id: "이 행이 정정한 이전 행",
      access_method: "manual=수동 · kiosk=키오스크",
      salary_tier: "이 출결 1건만의 급여 단가 티어 예외(null=수강의 티어)",
      homework_required: "출석부 과제 체크(부여) — 쓰지 않는 반이 많다. 0건은 '숙제 없음'이 아니라 '체크를 안 쓰는 반'. 숙제 수행은 lesson_reports.homework_score",
      homework_done: "출석부 과제 체크(완료) — 위와 같다",
    },
  },
  {
    name: "attendance_salary_rates",
    label: "출결 급여 비율",
    ko: "강사별 출석부 급여 비율(정규·특강 × 초·중·고)",
    notes: "teacher_id 1행, rates=비율 jsonb. 줄이 없으면 계약 비율을 쓴다. 원장·권한자 전용 급여 정보.",
  },
  {
    name: "attendance_salary_teacher_view",
    label: "실급여 공개",
    ko: "강사 본인 출석부에 실급여·합계를 보여줄지 스위치(강사별)",
    notes: "visible=true면 보임. period='YYYY-MM'.",
    internal: true,
  },
  {
    name: "attendance_seat_share_adjust",
    label: "자리 몫 조정",
    ko: "반×달 자리(JJ실·랩실) 몫 일부를 강사 수업 몫으로 돌린 시수 조정",
    notes:
      "period='YYYY-MM'. units=반 전체에 적용할 시수(0.5 단위, 0=조정 없음), student_units={학생 id: 시수} 학생별 예외. 출결 기록은 바꾸지 않는다 — 급여 상한 계산용.",
  },
  {
    name: "audit_logs",
    label: "감사 기록",
    ko: "업무 행위 감사 기록(앱이 남김) — 누가 무엇을 했나",
    notes:
      "action=행위 코드(예 staff_role_change·staff_delete·invoice_create·exam_create), target_type=대상 종류(staff·student·invoice·exam·payroll…), target_label=대상 이름, metadata=세부(jsonb). 표 단위 변경 diff는 activity_log. 언제 = created_at.",
    columns: {
      actor_name: "기록 당시 행위자 이름",
    },
  },
  {
    name: "before_class_checks",
    label: "비포클래스",
    ko: "비포클래스 체크리스트(초안) — 학생×반×수업일의 준비 미흡 항목·카드",
    notes:
      "missed=미흡 항목 키 배열(빈 배열=모두 해 옴), absent=결석. card: blue·gold·red·yellow·none(카드 X)·null=아직 안 고름. excused: null=자동(지난 수업 결석이면 제외) · true/false=선생님 지정. excuse_reason: prev_absent=지난 수업 결석 · first_lesson=첫 수업 · other(excuse_note). 쓰는 반은 before_class_targets.",
  },
  {
    name: "before_class_targets",
    label: "비포클래스 반",
    ko: "비포클래스 체크리스트를 쓰는 반 목록",
    internal: true,
  },
  {
    name: "calendar_events",
    label: "학원 일정",
    ko: "학원 공용 캘린더 일정 1건(캘린더 탭)",
    notes:
      "start_date~end_date(둘 다 포함, 한국 날짜) · start_time/end_time은 선택(null=종일). series_id=같은 반복 등록에서 나온 회차 묶음(null=단발). tag_id → calendar_tags(분류). google_* = 구글 캘린더 연동 흔적.",
    columns: {
      color: "표시 색 키(태그 색이 우선)",
    },
  },
  {
    name: "calendar_sync_state",
    label: "캘린더 동기화",
    ko: "구글 캘린더 푸시 채널·증분 동기화 상태",
    internal: true,
  },
  {
    name: "calendar_tags",
    label: "일정 태그",
    ko: "캘린더 일정 태그(분류) 사전 — 이름·색",
  },
  {
    name: "class_delegations",
    label: "반 임시 위임",
    ko: "반 임시 위임 — 결근 대체 강사가 그 기간 반을 함께 맡음",
    notes:
      "[from_date, to_date] 둘 다 포함. 유효 = revoked_at is null(해제는 지우지 않고 revoked_at 기록). 담임(classes.teacher_id)은 바뀌지 않는다 — 영구 교체는 classes.pending_teacher_*.",
    columns: {
      delegate_user_id: "대신 맡는 강사",
    },
  },
  {
    name: "class_lesson_shifts",
    label: "회차 미루기",
    ko: "수업 회차 미루기·당기기 표식(월간계획 계산용)",
    notes:
      "kind: skip · advance(그 칸에서 차수를 건너뛸지 버릴지). origin: manual=강사 · timetable_move=반 블록 옮기기가 쓴 칸. lane=''이면 교시 전체 표식, 아니면 교재 id(pos=그 교시의 몇 번째 25분). 실제 진도 줄은 건드리지 않는다.",
  },
  {
    name: "class_month_plan_cells",
    label: "EiE 월간계획",
    ko: "EiE 월간 계획서(MP) 한 칸 — 반×날짜×칸 종류",
    notes:
      "col_kind: in_class·homework·ebook·test·off(휴강 명시, body=off|open)·footer·title. 계획만 담는다 — 실제 진도는 class_sheet_plan_lines.",
  },
  {
    name: "class_plan_import_batches",
    label: "계획 가져오기",
    ko: "월간계획 전체 가져오기 1회 기록(되돌리기용)",
    internal: true,
  },
  {
    name: "class_salary_settings",
    label: "반 급여 설정",
    ko: "반별 급여 설정(과정·배분율) — 원장 전용",
    notes:
      "class_id 1행. salary_group: 초등·중등·고등·수능·특강 · null=반 이름으로 자동 판정. commission_rate=반별 배분율 %(null=과정·기본 비율). applies_dows=비율제 적용 요일(sun~sat, null=전 요일).",
  },
  {
    name: "class_schedules",
    label: "시간표",
    ko: "반 시간표 한 줄 — 요일·시작·종료 시각(유효 기간 이력 포함)",
    notes:
      "day_of_week: mon~sun. 🔴 지난 배치 이력이 섞여 있다 — 날짜 D에 유효한 줄 = valid_from ≤ D and (valid_to is null or valid_to ≥ D)(valid_to 포함). teacher_id·classroom_id = 교시별 담당·강의실(null=classes.teacher_id·classroom_id 상속 — 단 teacher_id null + 자리 라벨이면 자리 교시라 담임 상속이 아니라 누구 몫도 아니다 — 자리 라벨 = lower(btrim(slot_teacher_label)) in ('lab','lab실','랩실','이주희','jj','집중자율수업실','자율실'), 앱 timetable/lib/teacher-label.ts 별칭과 같이 고칠 것). day_of_week는 enum이라 글자와 비교할 때 ::text. merge_group이 같으면 합반. 시각은 time(한국 시각). 교시 출결은 attendance_records.slot_start = start_time으로 잇는다.",
    columns: {
      period_label: "표시용 교시 이름('3교시') — 시각이 정본",
      slot_teacher_label: "표시용 강사 라벨(영문 닉네임 등, null=반 기본)",
      slot_room_label: "표시용 강의실 라벨(null=반 기본)",
      lab_separate: "LAB 자리 교시의 따로 수업(*LAB) 표식",
    },
  },
  {
    name: "class_sheet_goals",
    label: "ECS 목표",
    ko: "ECS(영어 강사 시트) 담임·부담임 월간·주간 목표(영역별 교재·목표 진도)",
    notes: "scope: month(period_start=1일) · week(period_start=월요일). role: homeroom=담임 · assistant=부담임. skill_area=영역 키.",
  },
  {
    name: "class_sheet_memos",
    label: "주간 메모",
    ko: "ECS 주간 자유 메모(반×주×위치)",
    notes: "week_start=월요일. memo_key: week · panel · day:YYYY-MM-DD · slot:YYYY-MM-DD:HH:MM.",
  },
  {
    name: "class_sheet_month_memos",
    label: "월간 메모",
    ko: "ECS 월간 특이사항 메모(반×달 하나)",
    notes: "month = 그 달 1일.",
  },
  {
    name: "class_sheet_plan_lines",
    label: "실제 진도",
    ko: "ECS 반별 실제 수업 진도 줄 — 날짜×교시×영역",
    notes:
      "강사가 실제로 나간 진도(textbook·page_range·progress·homework 자유 글). term_mode: regular=평시 · exam=내신. skill_area=영역 키, line_no 1~20. slot_start=교시 시작 시각. 교재 배정(계획)은 class_textbook_plans에서 계산되고 여기 저장되지 않는다. 학생 출석은 attendance_records.",
  },
  {
    name: "class_sheet_slot_flags",
    label: "교시 체크",
    ko: "ECS 교시 단위 체크 — 현재 shouting(EiE Shouting 칸) 하나",
    notes: "반×flag_date×slot_start 1행.",
  },
  {
    name: "class_sheet_student_marks",
    label: "학생 교시 마크",
    ko: "ECS 학생별 교시 마크 — 상태 라벨·개인 진도·점수",
    notes:
      "status는 자유 라벨(출석이 아니다 — 출석은 attendance_records). progress_note=개인 진도 글('PL 7, 20개' 등), score=점수 자유 입력(18/20·95·A). listening_level·memorized_words=JJ 전용 듣기 레벨·누적 암기 단어 수.",
  },
  {
    name: "class_splits",
    label: "수업 나누기",
    ko: "수업 나누기 — 학생이 특정 요일·시간만 다른 반에서 출결받는 설정",
    notes:
      "source_class_id=원래 반(수강료·보고서 기준), target_class_id=그 시간에 가는 반(출결 귀속). 🔴 수강이 아니다 — 인원·청구·재원 집계에 넣지 않는다. day_of_week mon~sun, valid_to null=해제 전까지. period_kind: day·month·forever.",
  },
  {
    name: "class_textbook_plans",
    label: "교재 배정",
    ko: "반 교재 배정 — 어느 교시에 어떤 교재를 몇 차수부터 태우나",
    notes:
      "textbook_id → textbooks. pace: period=교시마다 1차수 · day=하루 1차수 · min25=25분 수업. slot_axis: class=정규 교시 · jj=JJ(자습실). term_mode regular·exam. 이 배정이 곧 월간계획이고 실제 진도는 class_sheet_plan_lines.",
    columns: {
      slot_picks: "태울 교시 목록('요일|시작시각', 예 mon|17:20)",
      start_lesson_no: "시작 차수",
    },
  },
  {
    name: "classes",
    label: "반",
    ko: "반(수업) 마스터 — 반 이름·과목·담임·강의실",
    notes:
      "subject=과목 키(math·english 등, 이름은 학원 설정). teacher_id=담임. is_active=false는 폐지(전 기간 숨김), closed_at=종강일(그 다음 날부터 운영 끝, 과거 이력엔 남음) — 운영 중 = is_active and (closed_at is null or closed_at ≥ 오늘). 🔴 is_makeup_pool=true는 반 없는 보강이 앉는 보이지 않는 반이라 반별 집계에서 뺀다. report_optout=수업보고서 미발송 반(작성률 분모 제외). is_special=특강(이름에 '특강'이 있어도 특강).",
    columns: {
      english_track: "eie=EiE 프랜차이즈 레벨 수업 · injaewon=인재원 자체 영어 · null=미분류·비영어",
      math_learning_track: "수학 학습 트랙 regular · supplement",
      pending_teacher_id: "담임 교체 예약 — 인계받을 강사",
      pending_teacher_date: "담임 교체 적용 예정일",
      makeedu_lesson_id: "메이크에듀 수업 id(동기화 키)",
      notes: "반 메모",
    },
  },
  {
    name: "classnote_board_members",
    label: "보드 원아 명단",
    ko: "ClassNote 반 보드의 원아 스냅샷(반 구성 점검용)",
    internal: true,
  },
  {
    name: "classnote_board_sync_runs",
    label: "보드 동기화",
    ko: "ClassNote 반 보드 동기화 회차 기록",
    internal: true,
  },
  {
    name: "classnote_boards",
    label: "반 보드",
    ko: "ClassNote 반 보드 스냅샷(하루 1회 적재)",
    internal: true,
  },
  {
    name: "classnote_child_links",
    label: "원아 연결",
    ko: "ClassNote 원아 ↔ 학생 연결(여러 원아 → 한 학생)",
    notes: "child_id=ClassNote 원아 id, student_id=학생. linked_by=연결 근거(phone·name 등).",
    internal: true,
  },
  {
    name: "classnote_class_board_members",
    label: "보드 판정",
    ko: "반 보드 학생 ↔ 원아 판정 결과(ok·hold + 사유)",
    internal: true,
  },
  {
    name: "classnote_class_boards",
    label: "수학 반 보드",
    ko: "반 ↔ ClassNote 수학 반 보드 연결",
    internal: true,
  },
  {
    name: "classnote_class_notices",
    label: "반 단체 공지",
    ko: "ClassNote 반 단체 공지 발송 큐(반 보드에 공지 1건)",
    notes: "status: queued · processing · success · partial · failed. targets=[{classId, className}], is_test=테스트 발송. 언제 = created_at·processed_at.",
    internal: true,
  },
  {
    name: "classnote_class_posts",
    label: "알림장 작성일",
    ko: "ClassNote 반 보드 알림장 작성일 — 영어 작성률의 원천",
    notes:
      "board_name=ClassNote 보드 이름 원문(반 id가 아니다), posted_on=한국 날짜, post_count=그날 글 수(참고, 작성률은 날짜로 센다). 영어 강사는 ClassNote에 직접 쓰므로 영어 작성률은 lesson_reports가 아니라 이 표로 센다.",
  },
  {
    name: "classnote_english_class_boards",
    label: "영어 반 보드",
    ko: "영어 반 ↔ ClassNote 영어 반 방 연결(사람이 확인한 것만)",
    notes:
      "class_id = 에이와 반, board_id = 확인된 ClassNote 반 방. 반별 알림장 작성일(classnote_class_posts)은 연결된 board_name과 대조한다 — board_name은 연결 당시 이름이므로 이름 변경·연결 누락을 미작성으로 단정하지 않는다.",
  },
  {
    name: "classnote_feed_state",
    label: "피드 폴링",
    ko: "ClassNote 학부모 글·댓글 폴링 위치",
    internal: true,
  },
  {
    name: "classnote_notices",
    label: "학생별 공지",
    ko: "ClassNote 학생별 공지 발송 큐(여러 학생에게 같은 글)",
    notes: "status: queued · processing · success · partial · failed. targets=[{studentId, studentName, board}], results=대상별 결과.",
    internal: true,
  },
  {
    name: "classnote_parent_message_attachments",
    label: "학부모 글 사진",
    ko: "학부모 글·댓글의 ClassNote 사진 주소",
    internal: true,
  },
  {
    name: "classnote_parent_messages",
    label: "학부모 글",
    ko: "ClassNote 학부모 글·댓글 원문 1건 + AI 출결 의도 분류",
    notes:
      "source: post=글 · comment=댓글. category(AI 제안): absence=결석 · late=지각 · early_leave=조퇴 · none=출결 아님, starts_on~ends_on=그 기간. classified_at null=아직 분류 전. student_id=매칭된 학생(null 가능), class_name=보드 이름(참고용). 언제 = posted_at(UTC). 학부모 연락·요청 질문의 원천.",
    columns: {
      detail: "분류 한 줄 요약(원문에 있는 말만)",
      notified_at: "담당자 알림을 만든 시각",
      cross_teacher_ids: "함께 알린 다른 과목 담당 강사 id 배열",
    },
  },
  {
    name: "classnote_parent_reactions",
    label: "학부모 글 공감",
    ko: "학부모 글·댓글에 aywa에서 누른 공감(발송 큐)",
    internal: true,
  },
  {
    name: "classnote_parent_replies",
    label: "학부모 답글",
    ko: "학부모 글·댓글에 aywa에서 쓴 답글(게시 큐 겸 기록)",
    notes: "status: queued · processing · success · failed · edit_requested · delete_requested · deleted. body=답글, posted_at=게시 시각.",
    internal: true,
  },
  {
    name: "classnote_student_links",
    label: "원아 고정 연결",
    ko: "학생 ↔ ClassNote 원아 고정 연결(반 보드 발송용)",
    internal: true,
  },
  {
    name: "classnote_sync_requests",
    label: "동기화 요청",
    ko: "ClassNote 반 보드 '지금 동기화' 요청 큐",
    internal: true,
  },
  {
    name: "classnote_video_files",
    label: "영상 파일",
    ko: "ClassNote 영상 → 드라이브 파일 중복 확인표",
    internal: true,
  },
  {
    name: "classnote_video_folders",
    label: "영상 폴더",
    ko: "ClassNote 영상 드라이브 폴더 경로 캐시",
    internal: true,
  },
  {
    name: "classnote_video_history",
    label: "영상 수집",
    ko: "ClassNote 영상 수집 진행 상태",
    internal: true,
  },
  {
    name: "classnote_workers",
    label: "연동 PC",
    ko: "ClassNote 연동 PC 워커 생존 신호",
    internal: true,
  },
  {
    name: "classrooms",
    label: "강의실",
    ko: "강의실 마스터 — 이름·정원",
    notes: "archived_at이 있으면 보관(새 배정 선택지에서 숨김) — 사용 중 = archived_at is null. 이미 배정된 반·교시는 계속 이 방을 가리킨다.",
  },
  {
    name: "consultation_ai_analysis",
    label: "상담 AI 분석",
    ko: "등록상담 AI 분석 결과 — 진단·학습 계획·추천 반",
    notes:
      "지점 칸이 없다 — consultation_id → enrollment_consultations로 지점을 따른다. recommended_class_ids=추천 반 id 배열, diagnosis·learning_plan·print_payload=jsonb. approved_by=승인한 직원. 언제 = generated_at.",
  },
  {
    name: "consultation_recordings",
    label: "상담 녹음",
    ko: "등록상담 녹음 파일과 전사(상담 1건에 여러 개)",
    notes:
      "consultation_id → enrollment_consultations. processing_status: idle=대기 · uploaded=업로드됨 · transcribing=전사중 · analyzing=분석중 · completed=완료 · failed=실패. audio_duration_sec=길이(초), recorded_by=녹음한 직원. audio_path가 비었으면 보존기간(90일)이 지나 원본만 지운 것 — 녹음 행·전사·분석은 남는다.",
  },
  {
    name: "daily_briefings",
    label: "아침 브리핑",
    ko: "운영실 아침 AI 브리핑 — 지점×날짜 1행",
    notes:
      "briefing_date=한국 날짜. payload=결정론 집계(숫자·명단의 정본), narrative=AI 서술(실패 시 null), team_report=매니저 팀 보고. processing_status: idle·analyzing·completed·failed.",
  },
  {
    name: "dashboard_secretary_inputs",
    label: "업무 비서 후보",
    ko: "업무 비서 마지막 후보 스냅샷(사람마다 한 줄)",
    internal: true,
  },
  {
    name: "dashboard_secretary_notes",
    label: "업무 비서",
    ko: "업무 비서 AI 할 일 정리(사람×날짜)",
    notes: "for_date=한국 날짜, run_kind: button=사람이 누름 · schedule=예약(01:00·13:00).",
    internal: true,
  },
  {
    name: "document_categories",
    label: "문서 분류",
    ko: "학원 문서함 분류(폴더) 사전",
    notes: "key=academy_documents.category가 가리키는 불변 키, label=표시 이름, is_system=기본 분류(삭제 불가), parent_key=상위 분류 키.",
  },
  {
    name: "document_folder_favorites",
    label: "문서 즐겨찾기",
    ko: "직원별 문서함 즐겨찾기 폴더",
    internal: true,
  },
  {
    name: "edutrix_archive",
    label: "옛 자료 보관",
    ko: "옛 Edutrix 원본 행 보관(은퇴 보험)",
    internal: true,
  },
  {
    name: "english_levels",
    label: "영어 레벨",
    ko: "영어 레벨 사전 — 약어·이름·정렬 순서",
  },
  {
    name: "enrollment_consultations",
    label: "등록상담",
    ko: "신규 콜&상담(등록상담) 1건 — 예비 학생·학부모·상담 결과",
    notes:
      "outcome: pending=대기 · scheduled=예약 · consulted=상담완료 · ai_done=AI 완료 · enrolled=재원생 등록 완료 · declined=거절 · no_show=노쇼(칸반 4칸: 상담 전·상담 완료·미등록·등록 완료). 🔴 '언제' = consulted_at(한국 날짜로 변환) — created_at은 2026-07~08 옛 자료 대량 이관으로 왜곡된다. student_id=등록 전환된 학생. registration_status는 옛 시트 값이라 현재 상태로 쓰지 않는다. payment_amount 원.",
    columns: {
      subject: "희망 과목 자유 글('EIE'=영어, '영어 수학'=둘 다)",
      consultant_id: "상담 담당 직원(users.id)",
      counselor: "상담자 이름(글)",
      receiver: "전화를 받은 직원 이름 — 상담자와 다른 축",
      consultation_date: "상담일(date, 폼 입력)",
      received_date: "접수일",
      consultation_path: "유입 경로(지인 소개·인터넷 검색·블로그/카페·간판/현수막·전단지·설명회·재원생 추천·기타)",
      from_public_intake: "QR 공개 접수로 들어온 건",
      referrer_student_id: "소개한 원생",
      referrer_staff_id: "소개한 직원",
      follow_up_date: "후속 연락 예정일",
      non_registration_reason: "미등록 사유",
      legacy_key: "옛 시트 이관 키(수기 입력은 null)",
      makeedu_id: "메이크에듀 동기화 id",
      payment_date: "결제일",
    },
  },
  {
    name: "enrollments",
    label: "수강",
    ko: "수강 — 학생이 어느 반을 언제부터 언제까지 듣나(반 배정 1건)",
    notes:
      "🔴 날짜 D에 그 반 명단 = start_date ≤ D and (end_date is null or end_date ≥ D), 단 is_transferred=true(반이동으로 끝남)면 end_date > D(이동일은 이미 새 반). on_hold=true는 휴원(명단엔 남고 출결 대상 아님). 반이동 = 옛 수강 is_transferred + 새 수강 is_transferred_in. 수강 종료 ≠ 퇴원 — 반이동·종강으로 끝난 수강에도 end_date가 찍힌다. 학원 단위 재원·휴원·퇴원은 students.status·withdrawn_at. students.is_test 제외.",
    columns: {
      end_date: "수강 마지막 날(일반 종료는 그날 포함, 반이동은 이동일=새 반 시작일). end_date=start_date는 취소된 예약",
      withdrawal_reason:
        "종료 사유 키 dissatisfaction=수업·강사 · grades=성적 · motivation=학생 상태 · method=공부 방법 변경 · competitor=타 학원 이동 · schedule=시간/일정 · financial=경제적 이유 · career=진로·진학 · peers=가족·친구 · illness=질병 · advised=권고퇴원 · relocation=이사 · graduated=졸업 · other=기타, 또는 글('반 이동'·'퇴원에 따른 자동 종료'·'종강')",
      withdrawal_detail: "종료 세부 사유 키",
      withdrawal_memo: "종료 메모(실제 사유 글)",
      attendance_days: "분리등원 요일(mon…sun). 빈 배열=반의 모든 운영 요일",
      is_transferred: "반이동으로 끝난 수강",
      is_transferred_in: "반이동으로 들어온 수강",
      salary_tier: "급여 단가 티어 라벨(salary_tiers.label). null=미지정",
      lab_separate: "반의 따로 수업(*LAB) 교시에 배정",
    },
  },
  {
    name: "exams",
    label: "시험",
    ko: "시험 마스터 — 주간·모의·학교 시험 1회",
    notes:
      "exam_type: weekly=주간 · mock=모의 · school=학교. exam_date=시험일, max_score=만점. scope={type: class|grade|academy, classIds?, grades?}. 학생 점수는 student_grades(exam_id), 목표는 grade_goals.",
  },
  {
    name: "expenses",
    label: "지출",
    ko: "지출결의서(수납관리 지출 장부) 1건",
    notes:
      "amount = currency 단위(기본 KRW=원, USD 등은 소수) — 🔴 통화가 다르면 합치지 않는다. 언제 = expense_date(지출일). category: 인건비·운영비·매입·마케팅·기타. approval_status: pending=결재 대기 · approved=결재 완료(원장·대표 둘 다 체크). 운영실 지출 합계는 결재 상태와 무관하게 전건을 더한다. 전자결재 지출결의서(approval_expense_forms)와 별개.",
    columns: {
      approval_checks: "결재란 체크 {author·director·ceo·executor: {checked, date}}",
      line_items: "품목 내역(jsonb)",
      author: "작성자 이름(글)",
      created_by: "작성 계정(users.id, 옛 자료는 null)",
      position: "작성자 직위",
      receipt_type: "증빙 유형(영수증·세금계산서 등 글)",
      receipt_urls: "첨부 파일 목록",
    },
  },
  {
    name: "grade_comments",
    label: "학습 코멘트",
    ko: "학생 학습 코멘트 — 월별·분류별, 학부모 공유 여부",
    notes:
      "category: strength=학습적 강점 · improvement=학습적 보완점 · effort=이번 달 노력한 점 · potential=성장 잠재력 · general=종합 소견. period='YYYY-MM'. subject null=전체 과목. shared_with_parent=학부모 공유.",
  },
  {
    name: "grade_goals",
    label: "성적 목표",
    ko: "학생 성적 목표 — 시험별 목표 점수",
    notes:
      "시험 칸 = (subject, school_year, term 1|2, exam_slot, exam_month). exam_slot: midterm=중간고사 · final=기말고사 · listening=듣기평가 · monthly=월말평가(exam_month 1~12, 그 외 0) · school=내신(옛 값). 옛 행은 축이 null이고 exam_name으로만 맞는다. 실제 점수는 student_grades의 같은 칸.",
  },
  {
    name: "help_answers",
    label: "도움말 답변",
    ko: "앱 도움말 질문 게시판의 답변",
    notes: "post_id → help_posts.",
  },
  {
    name: "help_posts",
    label: "도움말 질문",
    ko: "앱 도움말 질문 게시판(직원 질문)",
    notes: "status: open · answered · closed.",
  },
  {
    name: "homework_video_assignment_history",
    label: "영상 분류 이력",
    ko: "숙제 영상 반·숙제일 분류 변경 이력",
    internal: true,
  },
  {
    name: "homework_video_assignments",
    label: "영상 숙제 분류",
    ko: "숙제 영상의 반·숙제일 수동 분류(영상 1개=1행)",
    notes: "video_id → student_homework_videos. excluded=true면 숙제 영상이 아님(class_id·homework_date null). homework_date=숙제일.",
  },
  {
    name: "homework_video_drive_account_owners",
    label: "드라이브 계정",
    ko: "숙제 영상 드라이브 계정 소유 확인",
    internal: true,
  },
  {
    name: "homework_video_drive_connections",
    label: "드라이브 연결",
    ko: "숙제 영상 구글 드라이브 연결",
    internal: true,
  },
  {
    name: "homework_video_drive_oauth_attempts",
    label: "드라이브 인증",
    ko: "드라이브 연결 OAuth 시도",
    internal: true,
  },
  {
    name: "homework_video_drive_roots",
    label: "드라이브 폴더",
    ko: "숙제 영상 드라이브 최상위 폴더",
    internal: true,
  },
  {
    name: "homework_video_drive_settings",
    label: "드라이브 설정",
    ko: "지점 숙제 영상 드라이브 설정",
    internal: true,
  },
  {
    name: "homework_video_link_uploads",
    label: "영상 업로드",
    ko: "제출 링크로 올린 업로드 1회 기록",
    notes: "status: started · completed · failed. video_id=완료 후 생긴 영상.",
    internal: true,
  },
  {
    name: "homework_video_links",
    label: "영상 제출 링크",
    ko: "숙제 영상 제출 링크 — 학생×반, 기본 7일",
    notes: "origin: manual=학생 상세에서 복사 · report=수업보고서 글 · site=영상 올리기 사이트. expires_at=만료, revoked_at=취소, last_used_at=마지막 사용.",
    internal: true,
  },
  {
    name: "homework_video_reviews",
    label: "영상 AI 분석",
    ko: "숙제 영상 AI 분석(선생님 참고 메모) — 영상 1개=1행",
    notes:
      "video_id → student_homework_videos. stage: extract → transcribe·transcribing → judge·judging → verify·verifying → done · failed=실패 · skipped=판정 불가(말소리 없음 등). result=화면용 분석(overall·scores·mistakes·needsCheck·note·fixes). done_at=완료 시각.",
  },
  {
    name: "homework_video_site_attempts",
    label: "사이트 시도",
    ko: "영상 올리기 사이트 조회·열기 시도(횟수 제한)",
    internal: true,
  },
  {
    name: "intake_attempts",
    label: "접수 시도",
    ko: "QR 상담 접수 링크 시도 기록",
    internal: true,
  },
  {
    name: "intake_tokens",
    label: "QR 접수 링크",
    ko: "QR 상담 접수 링크(공개 신청서)",
    notes: "is_active·expires_at으로 유효 여부, usage_count·submission_count=사용·제출 횟수. 접수된 상담은 enrollment_consultations(from_public_intake).",
    internal: true,
  },
  {
    name: "inventory_assets",
    label: "재고 자산",
    ko: "재고 관리 — 자산(기기) 1대=1행",
    notes:
      "status: in_use=사용중 · on_loan=대여중 · repair=수리중 · lost=분실 · check=확인필요 · unregistered=미등록 · disposed=폐기(disposed_on). category = inventory_categories.key. holder_user_id·holder_name=대여 중인 사람. asset_code 예 'NB-002'.",
  },
  {
    name: "inventory_audits",
    label: "재고 실사",
    ko: "재고 실사 이력(자산별)",
    notes: "result: ok=확인 · missing=미확인 · hold=보류. audited_on=실사일, asset_id → inventory_assets.",
  },
  {
    name: "inventory_categories",
    label: "자산 분류",
    ko: "재고 자산 분류 사전 — key·이름·자산ID 머리글자",
  },
  {
    name: "inventory_loans",
    label: "자산 대여",
    ko: "재고 자산 대여 이력(반납해도 남음)",
    notes: "status: out=대여중 · returned=반납완료 · unreturnable=회수불가 · check=확인필요. lent_on=대여일, due_on=반납 예정, returned_on=반납일. borrower_name=대여자 이름 스냅샷.",
  },
  {
    name: "inventory_supplies",
    label: "소모품",
    ko: "재고 소모품 — 수량으로 세는 물품",
    notes: "qty=수량, checked_on=마지막 확인일.",
  },
  {
    name: "inventory_vendors",
    label: "거래처",
    ko: "재고 거래처 연락처",
  },
  {
    name: "invoice_session_terms",
    label: "회차 확정",
    ko: "청구서×반 회차 확정 — 회당 단가 × 확정 회차",
    notes:
      "invoice_id·class_id 1행. planned_sessions=자동 계획 회차, confirmed_sessions=사람이 확정한 회차(null=미확정 — 청구로 인정되는 유일한 값). pricing_mode: per_session=회차×단가 · monthly=월 정액(unit_price가 월 금액). amount=확정 금액(원). carryover_out/in=다음 달로 넘긴·전 달에서 받은 회차. allocation_*=수납액의 반별 배분(원).",
    columns: {
      quantity_basis: "회차 단위 days=일수 · attendance_units=출석부 시수",
      allocation_amount: "이 반에 배분한 수납액(원)",
      allocation_carry_out: "다음 달로 넘긴 배분 금액(원)",
    },
  },
  {
    name: "invoice_teacher_splits",
    label: "강사 분배",
    ko: "강사 분배 스냅샷 — 청구서×반, 저장 시점 확정·실측 금액",
    notes:
      "period='YYYY-MM'. confirmed_amount=청구 기준 분배액, actual_amount=실 시수 기준, diff_amount=실측−청구(음수=과청구 신호). 금액 원. 참고 기록이다 — 현재 강사 정산은 출석부 기준 산식.",
  },
  {
    name: "invoices",
    label: "청구",
    ko: "월별 청구서(수납) — 학생×청구월 1장, 청구·할인·납부 금액",
    notes:
      "period='YYYY-MM' 청구월(학생당 한 달 1장). 금액 원: amount_total=청구(할인 전) · amount_discount=할인 · amount_paid=납부. status: unpaid=미납 · partial=부분납 · paid=완납 · refunded=환불 · void=무효. 🔴 미수 = unpaid·partial 행의 greatest(0, total−discount−paid) 합(paid·refunded·void는 0). 수납률 = 납부 합 ÷ (청구−할인) 합. 월 집계는 period로. students.is_test 제외.",
    columns: {
      category: "tuition=수강료 · material=교재 · exam=시험 · other=기타",
      line_items: "청구 항목 배열 [{kind, description, classId, amount, discount, paid, unpaid…}] — 일부 행은 JSON 문자열로 이중 저장됨",
      paid_at: "완납 시각(UTC)",
      billed_at: "청구일",
      due_date: "납부 기한",
      payment_method: "card=카드 · transfer=계좌이체 · cash=현금 · other=기타",
      points_used: "적립금 사용액(원)",
      teacher_snapshot_id: "청구 시점 담임 강사",
      sync_added_at: "메이크에듀 동기화로 새로 들어온 시각",
    },
  },
  {
    name: "kakao_channels",
    label: "알림톡 채널",
    ko: "카카오 알림톡 발신 채널 설정(등하원 알림)",
    internal: true,
  },
  {
    name: "kiosk_devices",
    label: "키오스크",
    ko: "등록된 출석 키오스크 기기",
    internal: true,
  },
  {
    name: "lab_menu_assignments",
    label: "실험실 메뉴",
    ko: "플랫폼 실험실 메뉴 배정(지점 칸 없음)",
    internal: true,
  },
  {
    name: "leave_adjustments",
    label: "연차 조정",
    ko: "직원 연차 조정 행 — 이월·특별휴가 부여·차감",
    notes:
      "days: + 부여 / − 차감(0.25 단위, 행을 쌓아 합이 조정값). 잔여 연차 = 법정 부여(users.hire_date로 계산, 저장 안 됨) + 조정 합 − 사용 − 결재중(leave_forms). period_start~period_end=입사일 기준 1년 구간. used_start~used_end=실제 사용일(표시용).",
  },
  {
    name: "leave_forms",
    label: "휴가신청서",
    ko: "휴가신청서 상세(전자결재 문서 1:1)",
    notes:
      "leave_kind: annual=연차(1일) · half=반차(0.5) · quarter=반반차(0.25). days=차감 일수, start_date~end_date=휴가 기간, user_id=휴가 당사자. 승인 여부는 approval_documents.status(approved=승인). period_*·granted_days=기안 시점의 연차 구간·부여 일수.",
  },
  {
    name: "lesson_report_rating_queue",
    label: "평점 대기열",
    ko: "수업보고서 평점 정기 처리 대기열",
    internal: true,
  },
  {
    name: "lesson_report_ratings",
    label: "보고서 평점",
    ko: "수업보고서 AI 평점(참고용, 0~5) — 보고서 1:1",
    notes:
      "report_id → lesson_reports. points 0~5, items=항목별 평가 배열, parent_feeling·suggestion=글. claim: confirmed · needs_check · cleared · flagged. rated_on=평가일. 2026-10-22 일괄 배치분 + 이후 정기 처리분(평점 스위치를 켠 지점).",
  },
  {
    name: "lesson_report_send_events",
    label: "발송 이력",
    ko: "수업보고서 발송 상태 변화 이력(추가만)",
    notes:
      "event: requested·claimed·retry·sent·failed·held·recall_requested·recalled·recall_failed·cleared·sent_at_changed·deleted·other. at=이벤트 시각(UTC). 보고서가 지워져도 남는다. origin: trigger=실시간 · backfill_report·backfill_audit=과거 복원.",
    internal: true,
  },
  {
    name: "lesson_report_write_timings",
    label: "작성 시간",
    ko: "수업보고서 작성 시간 측정 — 저장·발송 1회=1행",
    notes:
      "teacher_id=누른 사람, active_ms=손으로 쓴 시간 합(ms), total_ms=처음 손댄 때→저장. send_view: card·grid, send_mode: single=한 건씩 · bulk=일괄, queued=발송까지 했나. fields=영역별 손댄 횟수·시간.",
  },
  {
    name: "lesson_reports",
    label: "수업보고서",
    ko: "수업보고서(학부모 리포트) — 학생×수업일×반(또는 과목) 1건",
    notes:
      "🔴 '언제' = coalesce(covers_date, report_date)(실제 수업일 귀속 — 작성률 기준). 작성 강사 = teacher_name(users.display_name과 같은 글자), 처음 저장한 계정 = created_by. 학부모 발송 = classnote_status='success'(classnote_sent_at). source='edutrix_import'는 옛 이관분(subject null). 영어는 ClassNote에 직접 써서 여기 거의 없다 — 영어 작성률은 classnote_class_posts. 작성률은 students.is_test 학생과 classes.report_optout 반을 뺀다. 직원별 미발송·실패를 비교하기 전에 테스트·발송 제외 대상을 구분하고 classnote_status·classnote_error·발송 이력으로 사유를 나눈다 — 미요청·처리 대기·시스템 실패를 같은 직원 미이행으로 합치지 않는다.",
    columns: {
      subject: "과목 키(math 등). 옛 이관분은 null",
      class_id: "보고서가 속한 반(같은 날 정규·특강 구분). 보강·이관분은 null 가능",
      classnote_status:
        "null=미요청 · queued=대기 · processing=처리중 · success=발송 완료 · failed=실패 · too_old=기한 지나 제외 · revoked=링크 취소 · recall_requested·recalling=회수 중 · recalled=회수됨 · recall_failed=회수 실패 · name_conflict=동명이인 차단 · blocked_shared=공유 보드 차단",
      classnote_sent_at: "학부모 발송 시각(UTC)",
      classnote_read_at: "학부모 읽음 시각(null=미읽음·미확인)",
      covers_date: "실제 수업일(미리·나중에 쓴 보고서). null이면 report_date",
      makeup: "보강 보고서",
      makeup_class_id: "보강이 진행된 수업 시간의 반(표시용)",
      homework_score: "과제 수행('100%'·'미제출'·'없음' 등 글)",
      homework_today: "오늘 내준 과제 내용",
      exam_info: "시험 점수 글(예 '7/25')",
      notes: "선생님 멘트 본문(학부모에게 나가는 글)",
      ment_source: "멘트 작성 방식 auto=자동 그대로 · auto_edited=자동 후 수정 · manual=직접",
      revoked_at: "공유 링크 취소 시각",
      video_homework: "영상 숙제 있음(true)·없음(false)·모름(null)",
    },
  },
  {
    name: "level_tests",
    label: "레벨테스트",
    ko: "레벨테스트 결과 — 배치·승급·진단",
    notes: "test_type: placement=배치 · promotion=승급 · diagnostic=진단. subject=과목 키, tested_on=시험일, level=결과 레벨(자유 글), subscores=영역별 점수(jsonb).",
  },
  {
    name: "login_events",
    label: "로그인 기록",
    ko: "직원 로그인 기록(세션당 1건)",
    notes: "at=로그인 시각(UTC), user_name=당시 이름(계정이 지워져도 남음).",
  },
  {
    name: "love_note_suggestions",
    label: "한마디 초안",
    ko: "사랑의 한마디 AI 초안(학생×날짜×과목, 마지막 초안)",
    internal: true,
  },
];
