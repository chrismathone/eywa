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
- 원생 = students(보호자는 같은 줄의 parent_* · parent2_* 칸) · 형제 = student_siblings(student_a · student_b · linked)
- 반 = classes(subject = 과목 · teacher_id = 지금 담임 · closed_at = 닫은 날 · is_makeup_pool = 보강용 반)
- 강사·직원 = users · 학원 = 이 지점(보기가 이미 이 지점만 보여 준다)

### 관계 — 기간이 있다
- 수강(원생→반) = enrollments(start_date ~ end_date, end_date 없음 = 진행 중 · on_hold = 휴원 중)
- 담임(반→강사) = classes.teacher_id — 🔴 지금 값이다. 과거 기록을 지금 담임에게 덮어씌우지 않는다.
- 교시 담당(반→강사) = class_schedules.teacher_id(valid_from ~ valid_to) · 임시 위임 = class_delegations
- 🔴 담임·교시 담당·위임은 '배정'이지 실제로 가르쳤다는 증거가 아니다. 실제로 수업한 사람은 출결의 attendance_records.taught_by.
- 과거 시점을 물으면 그때 유효했던 관계(수강 기간·교시 담당 기간)로 본다.

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
- 금액은 청구 근거 한 번만 센다. 여러 과목·반·강사에게 금액을 복제하거나 나눠 붙이지 않고, 반·강사 합계를 더해 학원 합계로 쓰지 않는다.
- 자료 없음은 0이 아니다. 기록이 없으면 "기록 없음"이라고 쓴다.`;
