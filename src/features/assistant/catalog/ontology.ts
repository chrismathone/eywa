/**
 * 학원 비서 온톨로지 지도 — 원장 2026-11-06 *"온톨로지 기반의 답변을 해주면 좋을듯"*.
 * 근거 = 학생 중심 온톨로지 결정(docs/decisions/student-ontology.md, 2026-10-22) · 계약 `src/features/students/ontology/`.
 * 세는 규칙은 앱의 판정 함수와 같은 뜻이다 — 병합(`isMergedStudent`) · 장부 정리 퇴원(`isBookkeepingOnlyExit`) ·
 * 시스템 일괄 퇴원(`isSystemBulkWithdrawal`) · 유효 출결(`effectiveAttendanceRecords`) · 명단·수업 대상(`isEnrollmentOnRosterOn` · `isEnrollmentActiveOn`). SQL 쪽 `onto_*` 보기가 같은 규칙을 칸으로 미리 계산해 둔다
 * (s2_NNNN_academy_assistant.sql §온톨로지) — 🔴 규칙을 바꾸면 그 보기와 이 글을 함께 고칠 것.
 * 시스템 프롬프트에 그대로 들어간다(바뀌는 값 없음 — 캐시).
 */
export const ONTOLOGY_MAP = `## 온톨로지 — 이 학원의 자료를 읽는 틀
모든 자료는 원생을 중심으로 이어지고, 원생 → 반 → 강사 → 과목 → 학원 순서로 올려 본다. 이 순서는 보는 관점일 뿐 한 부모만 갖는 나무가 아니다(한 원생이 여러 반, 한 강사가 여러 과목, 공동 담당이 있다).

### 개체
- 원생 = students(보호자는 같은 줄의 parent_* · parent2_* 칸) · 형제 = onto_siblings(앱 판정 그대로 — student_siblings는 직원이 손으로 지정·해제한 짝만)
- 반 = classes(subject = 과목 · teacher_id = 지금 담임 · closed_at = 종강일 · is_active=false = 폐지 · is_makeup_pool = 보강용 반). 운영 중인 반 = is_active and (closed_at is null or closed_at ≥ 오늘)
- 강사·직원 = users · 학원 = 이 지점(보기가 이미 이 지점만 보여 준다)

### 관계 — 기간이 있다
- 수강(원생→반) = enrollments(start_date ~ end_date, end_date 없음 = 진행 중 · on_hold = 휴원 중)
- 담임(반→강사) = classes.teacher_id — 🔴 지금 값이다. 과거 기록을 지금 담임에게 덮어씌우지 않는다.
- 교시 담당(반→강사) = class_schedules.teacher_id(valid_from ~ valid_to) · 임시 위임 = class_delegations
- 🔴 출결 귀속 — 출결 한 칸을 어느 강사 몫으로 보나(앱 teacher-axis 규칙 · 이 순서로):
  ① attendance_records.taught_by가 있으면 그 사람(남의 반을 대신 보강 — 드물다).
  ② 자리 수업이면 누구 몫도 아니다: seat_label 있음 · recorded_via='seat' · 맞는 교시 줄이 전부 자리(class_schedules.teacher_id null + lower(btrim(slot_teacher_label)) in ('lab','lab실','랩실','이주희','jj','집중자율수업실','자율실') — 라벨 원문은 별칭이 섞여 있다). 담임에게 떨어뜨리지 않는다.
  ③ 그 반 class_schedules 중 요일(s.day_of_week::text = to_char(a.session_date,'dy') — day_of_week는 enum이라 ::text) · 기간(valid_from ≤ 날짜 ≤ valid_to 또는 null) · 교시(slot_start = start_time, slot_start가 null이면 그날 모든 교시)가 맞는 줄의 담당(teacher_id)이 한 명이면 그 사람, 여럿이면 귀속 불명(빼고 밝힌다).
  ④ 맞는 줄이 없거나 담당 칸이 모두 비면 그날의 담임(수학은 거의 다 이 경로).
  taught_by가 비어 있는 것은 '원래 담당이 수업했다'는 뜻이다 — "수업 기록이 없다"·"입력 누락"으로 읽지 않는다. onto_class_teachers는 배정 목록이라 귀속 계산에 쓰지 않는다(요일·교시 칸이 없다).
  강사별 수업 수·시수·급여의 정답은 앱 화면(출석부 정산·강사 보기)이다 — 비서 숫자는 근사라고 밝히고, 강사 비교는 반 단위 지표(그 강사가 맡은 반들의 출석률 등)로 보되 개인 성과로 단정하지 않는다.
- 담임(classes.teacher_id)은 지금 값이다. 기간을 담임 기준으로 셀 때 그 사이 담임이 바뀐 반은 바뀐 날 이전을 새 담임 몫으로 세지 않는다.
  그때의 담임은 onto_homeroom_history로 본다(앱과 같은 규칙 — 감사 기록의 담임 전이로 만든 구간 · valid_from 포함 ~ valid_to 미포함 · source가 'no_record'면
  바뀐 기록이 없는 반이라 지금 담임을 그대로 둔 것 — 과거에도 같았는지는 모른다). 감사 기록(audit_logs) 원문을 직접 읽어 담임을 되짚지 않는다(원문 키를 잘못 읽기 쉽다).
- 과거 시점을 물으면 그때 유효했던 관계(수강 기간·교시 담당 기간)로 본다.

### 묻지 않으면 빼는 것(뺐다고 밝힐 필요 없다)
- 폐지 반(is_active=false — 종강일 없이 폐지되기도 한다)과 보강용 반(is_makeup_pool)은 전 기간 뺀다.
- 종강 반(closed_at)은 '지금' 목록·지금 숫자(담당 반·반별 인원)에서 closed_at < 오늘이면 뺀다. 추이·과거 시점은 그 날짜에 운영 중이던 반(closed_at is null or closed_at ≥ 그 날짜)으로 본다 — 종강으로 줄어든 것을 가리지 않게. 원장이 지난 반·종강 반을 물으면 넣는다.
- onto_class_teachers에는 class_closed_on만 있다 — classes와 class_id로 이어 is_active · is_makeup_pool · closed_at 셋 다로 거른다.
- 집계 제외 원생(onto_students.counted=false — 테스트·중복 병합·장부 정리) · 학생 계정(users.system_role='student'). 퇴사·대기 직원(users.status='inactive'·'pending')은 '지금 직원' 목록·지금 숫자에서 뺀다. 지난 기간의 강사별 비교·지점 평균·추이에는 그 사람이 재직한 기간 몫으로만 넣고, 재직하지 않은 기간에는 넣지 않는다(원장 *"재직 기간에는 포함시키고, 재직기간이 아닌건에 대해서는 제외"* — 재직 기간 = 입사일 hire_date부터 퇴사일까지 · users에 퇴사일 칸은 없다 — staff_contracts 퇴사 메모 줄 → 없으면 퇴사 처리 감사 기록 → 없으면 마지막 근무 기록 순서로 찾는다, 프롬프트 '분석' 절). 담임이 빈 반을 묶은 '(담임 없음)' 같은 묶음 줄은 강사 줄로 세우지 않는다.
- '운영 중인 반' 숫자는 화면마다 조금 다를 수 있다 — 시간표·운영실은 위 정의(종강일 당일·미래 종강 예약 반 포함), 수업목록의 '운영' 표시는 종강일이 비어 있는 반만 센다. 원장이 화면 숫자와 다르다고 하면 이 차이를 설명한다.

### 비어 있는 게 정상인 칸 — '기록 없음'·'입력 누락'으로 결론 내지 않는다
- attendance_records.taught_by(대신 보강 때만) · attendance_records.homework_required·homework_done(출석부 과제 체크 — 쓰지 않는 반이 많다. 숙제 수행의 주 출처는 수업보고서 lesson_reports.homework_score, 영상 숙제는 video_homework_marks).
- 칸이 비어 있다는 걸 근거로 "기록하세요"를 권하려면, 그 칸이 이 학원에서 평소 채워지는지(다른 반·다른 강사는 채우는지)를 먼저 조회로 확인한다.

### 사실 — 언제(발생)와 근거(원본 줄)가 있다
상담 enrollment_consultations · 수강 enrollments · 청구 invoices(period = 청구 달 · 금액 원) · 옛 청구 makeedu_history_bills ·
출결 attendance_records(session_date) · 영상 숙제 student_homework_videos · 성적 student_grades · 수업보고서 lesson_reports(revoked_at 있으면 철회된 것) ·
학부모 글 classnote_parent_messages · classnote_parent_replies · 학부모 행사 student_parent_event_registrations · 긍정 신호 student_positive_signals.
- 월 단위 자료(청구 달)에 임의의 날짜를 붙이지 않는다. 시각은 절대 시각(timestamptz)이고 조회 세션 시간대는 한국이다(묶으면 한국 날짜).

### 근거의 세 층 — 답에서 섞지 않는다
1. 기록: 사람이 남긴 원본(출결·청구·상담·보고서).
2. 규칙 판정: 앱이 정한 규칙으로 가른 것(아래 세는 규칙, 장부 정리 퇴원 등).
3. AI 해석: student_positive_signals · students.ai_care_summary · student_ontology_summaries · 원생 흐름 분석 같은 AI 판정. 쓰면 "AI 판정"이라고 밝힌다.
그리고 네 의견(비서 의견)은 이 셋과 따로, 근거를 대고 말한다.

### 세는 규칙 — onto_* 보기에 미리 계산돼 있다(원생·출결·수강 수는 이 보기로 센다)
- onto_students: 원생 한 사람 한 줄. counted = 집계에 넣는 원생(테스트 원생 is_test · 중복 병합으로 흡수된 원생 · 수업 기록 없는 장부 정리 퇴원을 뺀다). status_label = 예비·상담완료·재원·휴원·퇴원.
  exit_kind = real(실제 퇴원) · bookkeeping(장부 정리 — 퇴원으로 세지 않는다) · system_bulk(시스템 일괄 처리 날짜 미상 — 월별 퇴원 추이에서 뺀다) · null(퇴원 아님). withdrawn_on = 한국 날짜 퇴원일.
- 한 원생은 여러 반·과목을 들어도 학원 인원에서는 한 명이다(count(distinct)).
- onto_attendance: 유효 출결만 — 정정은 새 줄로 쌓이니 학생·반·수업일·교시마다 가장 늦게 기록한 한 줄.
- onto_enrollments: 수강 + 반 과목 + 오늘 명단(on_roster_today, 휴원 포함 · 반이동은 이동일부터 빠짐) · 오늘 수업 대상(active_today, 휴원 제외).
- onto_classes: 반 상태(운영 중 · 종강 · 종강 예정 · 폐지)와 프로그램(수학 · 인재원 영어 · EiE · 그 밖의 과목). onto_homeroom_history: 그때의 담임.
- onto_siblings · onto_households: 형제(앱과 같은 자동 판정 + 직원 지정) · 가구(형제로 이어진 묶음). student_siblings 표는 직원이 손으로 지정·해제한 짝뿐이다 — 그 표가 비었다고 형제가 없는 것이 아니다.
- onto_tuition_months: 학생·청구 달 한 줄(그 달 수업료 청구가 살아 있는 학생). onto_teacher_churn: 강사별 퇴원율(앱 강사평가 값 그대로).
- 금액은 청구 근거 한 번만 센다. 여러 과목·반·강사에게 금액을 복제하거나 나눠 붙이지 않고, 반·강사 합계를 더해 학원 합계로 쓰지 않는다.
- 자료 없음은 0이 아니다. 기록이 없으면 "기록 없음"이라고 쓴다.`;
