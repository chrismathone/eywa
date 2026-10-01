# DB 오류 문구 전수 검수 (2026-10-01)

> 원장 지시: *"다른 오류들도 이러한 경우가 더 있는지 검수하고 오류 고도화"* — 반 이름 PL4→PL5 개명이 23505(`classes_tenant_name_subject_idx`, 종강 반이 이름을 쥠)로 실패했는데 화면엔 "저장에 실패했습니다"만, 로그는 0줄이었다.
> 공용 판정 = [`src/lib/supabase/db-error.ts`](../../src/lib/supabase/db-error.ts) `describeDbError`/`explainDbError`/`logDbError` + 제약 문구표 [`db-error-constraints.ts`](../../src/lib/supabase/db-error-constraints.ts). 함정 기록 = gotchas #138.

## 방법

- 대상: `src/features/**/server/*.ts` · `src/app/**/actions.ts` · `src/app/api/**/route.ts` = **548개 파일**(테스트 제외).
- TypeScript AST로 `if (<오류 변수>)` 자리 중 그 변수가 **같은 함수 안에서 `.from()`/`.rpc()`/storage/auth.admin 결과를 직접 받은** 곳만 셌다(`const { error } = await supabase.from(...)`). ⚠️ 쿼리 빌더를 변수에 담았다 실행하는 자리(`const { error } = await del`)는 이 방식에 안 잡힌다 — 원생상담 4곳을 손으로 더 찾아 고쳤다(아래 '스캔 밖').
- 가능한 원인 코드: 운영 DB `pg_indexes`·`pg_constraint`·`pg_trigger` **SELECT**(2026-10-01, 유니크 118 · CHECK/FK/EXCLUDE/UNIQUE 711 · RAISE 트리거 7표). 모든 쓰기는 이 밖에도 RLS 42501·네트워크 실패가 가능하다(표에선 생략).
- 우선순위: **P1** 매일 쓰는 화면의 쓰기(원생·수강·콜&상담·원생상담·직원·출결·수납·시간표·반·교재·원스크린·강사 시트·성적·퇴원·강의실) · **P2** 그 밖 쓰기 · **P3** 조회 실패·백그라운드(cron·웹훅·알림).
- 줄 번호 = 수정 전 `origin/main`(f6ed1f4f0) 기준.

## 수치

- 찾은 곳: **1070곳**(쓰기 616 · 조회 454).
- 쓰기의 수정 전 모양: 영문 원문 노출 213 · 상수·도우미 문구 115 · 일반 문구 86 · humanizeDbError(문구 파싱) 64 · 기타 40 · throw(화면은 일반 오류) 40 · 기타 반환 36 · 코드별 일부 매핑 22.
- 쓰기 중 로그가 없던 곳: **563/616**.
- 이번 조치(전체): — 781 · 고침(번역기 내부) 86 · 로그만 82 · 고침(이유+로그) 104 · 보고만(fix/class-name-free 작업 중) 16 · 안쪽 자리에 로그 1 (+ 스캔 밖 손으로 고친 4곳).

## 핵심 발견 — "같은 코드, 다른 원인"

1. **학생 저장**(`students/server/actions.ts` `translateDbError`): 모든 23505를 "동일한 이름·학교·학년의 재원 학생"으로 말했다 — 학생 표엔 유니크가 셋(`ux_students_active_natural_key`·`ux_students_attendance_code_active`·`ux_students_makeedu`)이라 **출결번호 중복도 이름 칸을 고치게** 만들었다. 게다가 실제 인덱스 이름(`ux_students_active_natural_key`)과 다른 `students_natural_key`를 찾고 있었다.
2. **42501은 RLS만이 아니다**: `users` 표의 보호 트리거(`guard_user_privilege_columns`)가 42501로 *"급여 항목은 원장만 바꿀 수 있습니다"* 같은 한글 이유를 RAISE한다. "권한이 없습니다" 한 줄로 뭉치면 이유가 사라진다 → 공용 판정은 한글 RAISE 문장을 살린다.
3. **23503은 방향에 따라 뜻이 반대**: 지울 때 = "다른 기록이 쓰고 있다"(`invoices`→`students` RESTRICT 등 6종), 넣을 때 = "연결할 대상이 없다". 같은 제약 이름이 둘 다에 나온다 → 호출부가 `op: "delete"`를 넘긴다.
4. **P0001은 반은 사람 문장, 반은 코드**: 수납 배분 RPC는 *"같은 반을 두 번 배분할 수 없습니다"*처럼 한글로, 폴더·시트 RPC는 `folder_cycle`·`ECS_BAD_TERM` 같은 코드로 RAISE한다 → 한글 문장만 그대로 보이고 코드는 일반 문구.
5. **영문 원문 노출이 일반 문구보다 많다**: 쓰기의 수정 전 `영문 원문 노출` 213곳 — 원장이 본 "저장에 실패했습니다"와 반대로, 이쪽은 `duplicate key value violates unique constraint ...`가 토스트에 그대로 뜬다.
6. **재원 복구의 숨은 실패**: 퇴원 학생을 재원으로 돌릴 때 ① 같은 이름·학교·학년의 다른 재원생이 생겼으면 23505(자연키는 퇴원생을 빼고 센다), ② 그 사이 같은 반에 다시 배정됐으면 수강 재개가 23P01 — 둘 다 영문 원문이 떴다.

## 이번에 고친 화면(이유 + 로그)

| 화면 | 파일 | 대표 이유 |
|---|---|---|
| 원생 등록·수정·삭제·상태(퇴원·휴원·복구)·메모·성적·레벨테스트·목표·코멘트 | `students/server/actions.ts` (27곳) | 자연키 중복 → 이름 칸 · 출결번호 중복 → 출결번호 칸 · 청구 기록 있는 학생 삭제 |
| 퇴원·복구·수강 종료(공유 도우미) | `students/server/enrollment-sync.ts` (9곳) | 수강 재개 겹침(23P01) |
| 수강 배정·반 이동·날짜·예약 | `enrollments/db-errors.ts` 번역기 + 호출부 scope 12곳 | 삭제된 반(23503) · 겹침 |
| 반 폐지·종강·재운영의 수강 정리 | `classes/server/enrollment-lifecycle.ts` (3곳) | 그대로 + 로그 |
| 콜&상담 등록·수정·상태·삭제·녹음 | `enrollment/server/actions.ts` (10곳) | 영문 원문 → 한글 |
| QR 접수 링크 관리 / 공개 제출 | `enrollment/server/intake-actions.ts` (4곳 + 공개 1곳 로그만) | — |
| 원생상담 등록·수정·후속·삭제·녹음·케어 | `consultations/server/actions.ts`·`audio-actions.ts` (7곳) | 영문 원문 → 한글 |
| 직원 등록·수정·역할·이메일·이름·근무설정·삭제·내 정보 이메일 | `staff/server/actions.ts`·`account-actions.ts`·`me-actions.ts` (12곳) | 이메일 중복 → 이메일 칸 · 보호 트리거의 한글 이유 |
| 강의실 추가·수정·정원·삭제·보관 | `owner/server/classroom-actions.ts` (5곳) | 같은 이름(보관한 강의실 포함) |
| 출석부(칸·범위·메모·보강 연결·대리 입력) | `attendance/server/actions.ts` (13곳) | 시수 범위 CHECK(0 초과 20 이하) |
| 교재 요청·주문 | `billing/server/textbook-actions.ts` (7곳) | 영문 원문 → 한글 |
| 영어 강사 시트(Shouting·월간 계획) | `class-sheets/server/actions.ts`·`month-plan-actions.ts` | `저장에 실패했습니다: <영문>` → 한글 |
| 성적 원장 상담일 연결 | `grades/unified/server/consultation.ts`(+호출부 2곳) | `상담일을 저장하지 못했습니다: <영문>` → 한글 이유 |
| 교재목록·재고·셔틀·키오스크·자리 교시·자리 배치·문서 폴더 번역기 | 각 `access.ts`·`friendly`·`*Error` | 제약별 이유 + 로그(중복은 호출부 문구 우선 · 자리 번역기의 "표 없음" 오판도 바로잡음) |

> 리뷰 반영(2026-10-01): NOT NULL(23502)·형식 오류(22P02 등)는 대개 코드 버그라 **이유 대신 지금 문구 + 에러 로그**로 둔다(사용자를 탓하지 않는다). CHECK `_len`은 "비었거나 너무 김"(정의가 `between 1 and N`), 규약과 정의가 다른 CHECK 3개는 표에 직접.

## 보고만 — 다른 브랜치가 고치는 중

`src/features/classes/server/actions.ts`·`src/features/timetable/server/actions.ts`는 `fix/class-name-free`(반 이름 충돌)가 고치는 중이라 손대지 않았다. 그 브랜치가 들어간 뒤 공용 판정으로 합칠 자리:

- `src/features/classes/server/actions.ts:279` classes insert — 상수·도우미 문구(로그 없음): SAVE_FAILED
- `src/features/classes/server/actions.ts:298` class_schedules insert — 일반 문구(로그 없음): "스케줄 저장에 실패했습니다. 잠시 후 다시 시도해주세요."
- `src/features/classes/server/actions.ts:407` classes update — 상수·도우미 문구(로그 없음): SAVE_FAILED
- `src/features/classes/server/actions.ts:482` class_schedules insert — 상수·도우미 문구(로그 없음): restore.error
- `src/features/classes/server/actions.ts:509` class_schedules insert — 기타(로그 없음): 
- `src/features/classes/server/actions.ts:682` classes update — 영문 원문 노출(로그 없음): error.message
- `src/features/classes/server/actions.ts:723` classes update — 영문 원문 노출(로그 없음): updErr.message
- `src/features/classes/server/actions.ts:756` classes update — 영문 원문 노출(로그 없음): updErr.message
- `src/features/classes/server/actions.ts:859` classes update — 영문 원문 노출(로그 없음): updErr.message
- `src/features/classes/server/actions.ts:898` classes update — 영문 원문 노출(로그 없음): updErr.message
- `src/features/classes/server/actions.ts:939` classes update — 영문 원문 노출(로그 없음): updErr.message
- `src/features/classes/server/actions.ts:1016` classes update — 영문 원문 노출(로그 없음): updErr.message
- `src/features/classes/server/actions.ts:1121` class_delegations insert — 영문 원문 노출(로그 없음): insErr.message
- `src/features/classes/server/actions.ts:1177` class_delegations update — 영문 원문 노출(로그 없음): updErr.message
- `src/features/timetable/server/actions.ts:75` classes update — 일반 문구(로그 없음): '이미 "${newName
- `src/features/timetable/server/actions.ts:76` classes update — 일반 문구(로그 없음): '이미 "${newName

## 스캔 밖에서 찾은 곳

- `consultations/server/actions.ts` 생성·수정·후속·삭제 4곳(쿼리 빌더 변수 실행) — 영문 원문 → 고침.

## 남은 것(다음 묶음 후보)

- 쓰기 중 **영문 원문 노출이 남은 곳 140곳** — 파일별: `approvals/server/actions.ts` 9 · `class-sheets/server/actions.ts` 9 · `billing/server/expense-actions.ts` 8 · `billing/session-terms/server/actions.ts` 7 · `admin/server/actions.ts` 6 · `calendar/server/actions.ts` 6 · `billing/server/tuition-catalog-actions.ts` 5 · `documents/server/actions.ts` 5 · `integrations/server/actions.ts` 5 · `billing/server/catalog-actions.ts` 4 · `dashboard/server/actions.ts` 4 · `math-sheets/server/actions.ts` 4 · `retention/server/actions.ts` 4 · `super-admin/server/actions.ts` 4 · `attendance/seat/server/actions.ts` 3 · `billing/server/refund-actions.ts` 3 · `billing/session-terms/server/receipt-allocation-actions.ts` 3 · `classes/server/handover.ts` 3 · `payroll/server/actions.ts` 3 · `attendance/server/makeup-anchor-cells.ts` 2 · `grades/server/write.ts` 2 · `grades/unified/server/actions.ts` 2 · `leave/server/actions.ts` 2 · `meetings/server/actions.ts` 2 · `notices/server/translate.ts` 2 ….
- `humanizeDbError`(문구 파싱) 쓰는 곳 64곳 — 한글이라 화면은 괜찮지만 판정이 영문 단어 매칭이고 로그가 없다. `explainDbError`로 옮기면 제약별 이유 + 로그가 붙는다.
- throw 하는 곳(40) — 서버 액션의 throw는 프로덕션에서 Next가 문구를 가리고 서버 로그에만 남긴다. 화면이 "오류가 발생했습니다"로 끝나는 자리라 사용자 화면에 이유를 주려면 반환형으로 바꿔야 한다.
- 0행 update(RLS가 조용히 걸러 낸 경우)는 DB 오류가 아니라 이 검수 범위 밖 — 각 액션이 `.select()` 건수로 따로 판정한다.

## 전수 표 — 쓰기(616)

| 파일:줄 | 표·동작 | 가능한 원인 코드 | 수정 전 문구(종류) | 로그(전) | 우선 | 이번 조치 |
|---|---|---|---|---|---|---|
| `features/attendance/kiosk/server/actions.ts:62` | kiosk_devices insert | 23505(kiosk_devices_token_hash_idx) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P1 | 고침(번역기 내부) |
| `features/attendance/kiosk/server/actions.ts:104` | kiosk_devices update | 23505(kiosk_devices_token_hash_idx) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P1 | 고침(번역기 내부) |
| `features/attendance/kiosk/server/actions.ts:162` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 기타: — | 없음 | P1 | — |
| `features/attendance/kiosk/server/actions.ts:192` | kakao_channels upsert | 23505(kakao_channels_tenant_idx) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P1 | 고침(번역기 내부) |
| `features/attendance/kiosk/server/checkin.ts:245` | attendance_checkins update | 23505(checkins_tenant_student_date_idx) · 23503(대상 없음) | 기타 반환: return { ok: false, reason: "error", detail: error.message }; | 없음 | P1 | — |
| `features/attendance/kiosk/server/checkin.ts:259` | attendance_checkins insert | 23505(checkins_tenant_student_date_idx) · 23503(대상 없음) | 기타 반환: return { ok: false, reason: "error", detail: error.message }; | 없음 | P1 | — |
| `features/attendance/kiosk/server/checkin.ts:270` | attendance_checkins update | 23505(checkins_tenant_student_date_idx) · 23503(대상 없음) | 기타 반환: return { ok: false, reason: "error", detail: error.message }; | 없음 | P1 | — |
| `features/attendance/live/server/actions.ts:123` | attendance_followups upsert | 23505(attendance_followups_cell_uq) · 23514(CHECK 4) · 23503(대상 없음) | 상수·도우미 문구: missingTable | 없음 | P1 | — |
| `features/attendance/live/server/actions.ts:256` | notification_events upsert | 23505(notification_events_tenant_id_event_type_subject_key_bucket_key) · 23503(대상 없음) | 일반 문구: "요청을 기록하지 못했습니다" | 없음 | P1 | 로그만 |
| `features/attendance/live/server/actions.ts:406` | notification_events upsert | 23505(notification_events_tenant_id_event_type_subject_key_bucket_key) · 23503(대상 없음) | 일반 문구: "요청을 기록하지 못했습니다" | 없음 | P1 | 로그만 |
| `features/attendance/live/server/prefs-actions.ts:72` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/attendance/recap/server/actions.ts:89` | attendance_day_recaps insert | 23505(attendance_day_recaps_tenant_id_from_date_recap_date_key) · 23514(CHECK 1) · 23503(대상 없음) | 코드별 일부 매핑: — | 있음 | P1 | — |
| `features/attendance/recap/server/actions.ts:91` | attendance_day_recaps insert | 23505(attendance_day_recaps_tenant_id_from_date_recap_date_key) · 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "이미 정리가 진행 중입니다. 완료되면 화면이 자동으로 갱신됩니다." | 없음 | P1 | — |
| `features/attendance/recap/server/queries.ts:121` | rpc:dashboard_absence_risk rpc | P0001(RPC RAISE)·42501 | 기타 반환: { reportError(error, { scope: "attendance.recap.repeatAbsences" }); return new Map(); } | 있음 | P1 | — |
| `features/attendance/seat/server/actions.ts:37` | attendance_records update | 23514(CHECK 3) · 23503(대상 없음) | 기타 반환: return null; | 없음 | P1 | — |
| `features/attendance/seat/server/actions.ts:38` | attendance_records update | 23514(CHECK 3) · 23503(대상 없음) | 영문 원문 노출: first.error.message | 없음 | P1 | — |
| `features/attendance/seat/server/actions.ts:509` | attendance_records delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/attendance/seat/server/actions.ts:652` | attendance_records delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/attendance/seat/server/mark-actions.ts:108` | class_sheet_student_marks upsert | 23505(class_sheet_student_marks_tenant_id_class_id_student_id_mar_key) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: ''${jjMarkLabel(field) | 없음 | P1 | — |
| `features/attendance/seat/server/mark-actions.ts:109` | class_sheet_student_marks upsert | 23505(class_sheet_student_marks_tenant_id_class_id_student_id_mar_key) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: ''${jjMarkLabel(field) | 없음 | P1 | — |
| `features/attendance/seat/server/monthly-prefs.ts:37` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/attendance/seat/server/period-actions.ts:134` | seat_period_moves upsert | 23505(seat_period_moves_tenant_id_seat_session_date_class_id_stud_key) · 23514(CHECK 1) · 23503(대상 없음) | 상수·도우미 문구: periodError(error) | 없음 | P1 | 고침(번역기 내부) |
| `features/attendance/seat/server/period-actions.ts:153` | seat_period_pins upsert | 23505(seat_period_pins_tenant_id_seat_day_of_week_class_id_studen_key) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: "교시는 옮겼지만 고정에 실패했습니다 — 다시 시도해 주세요" | 없음 | P1 | 로그만 |
| `features/attendance/seat/server/placement-actions.ts:123` | seat_placements delete | 42501(RLS)·기타 | 상수·도우미 문구: placementError(error) | 없음 | P1 | 고침(번역기 내부) |
| `features/attendance/server/actions.ts:143` | attendance_records insert | 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: null | 없음 | P1 | — |
| `features/attendance/server/actions.ts:144` | attendance_records insert | 23514(CHECK 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/attendance/server/actions.ts:156` | attendance_records insert | 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: null | 없음 | P1 | — |
| `features/attendance/server/actions.ts:157` | attendance_records insert | 23514(CHECK 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/attendance/server/actions.ts:797` | attendance_records update | 23514(CHECK 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/attendance/server/actions.ts:872` | attendance_records delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/attendance/server/actions.ts:883` | attendance_records delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/attendance/server/actions.ts:2248` | attendance_records delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/attendance/server/makeup-anchor-cells.ts:104` | attendance_records insert | 23514(CHECK 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/attendance/server/makeup-anchor-cells.ts:158` | attendance_records update | 23514(CHECK 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/attendance/server/makeup-anchor-cells.ts:181` | attendance_records update | 23514(CHECK 3) · 23503(대상 없음) | 기타: — | 있음 | P1 | — |
| `features/attendance/server/makeup-pool.ts:129` | classes insert | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 코드별 일부 매핑: — | 있음 | P1 | — |
| `features/attendance/server/makeup-pool.ts:131` | classes insert | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 기타 반환: { const { data: again } = await admin .from("classes") .select("id") .eq("tenant_id", inpu | 없음 | P1 | — |
| `features/attendance/server/makeup-pool.ts:141` | classes insert | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 기타 반환: return null; | 없음 | P1 | — |
| `features/attendance/server/makeup-pool.ts:258` | attendance_records insert | 23514(CHECK 3) · 23503(대상 없음) | 기타 반환: { console.error("[makeup-pool] 예약 반 보강 출결 저장 실패", insErr.message); return { ok: false }; } | 있음 | P1 | — |
| `features/attendance/server/makeup-pool.ts:302` | attendance_records insert | 23514(CHECK 3) · 23503(대상 없음) | 기타 반환: { console.error("[makeup-pool] 보강 출결 저장 실패", insErr.message); return { ok: false }; } | 있음 | P1 | — |
| `features/attendance/server/makeup-reservation-actions.ts:146` | attendance_records update | 23514(CHECK 3) · 23503(대상 없음) | 일반 문구: "결석 칸 메모를 쓰지 못했습니다" | 있음 | P1 | — |
| `features/attendance/server/makeup-reservation-actions.ts:248` | makeup_reservations insert | 23505(makeup_reservations_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 코드별 일부 매핑: — | 있음 | P1 | — |
| `features/attendance/server/makeup-reservation-actions.ts:249` | makeup_reservations insert | 23505(makeup_reservations_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 상수·도우미 문구: NOT_APPLIED | 없음 | P1 | — |
| `features/attendance/server/makeup-reservation-actions.ts:250` | makeup_reservations insert | 23505(makeup_reservations_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 일반 문구: "같은 날 같은 교시에 이미 이 학생의 보강 예약이 있습니다" | 없음 | P1 | — |
| `features/attendance/server/makeup-reservation-actions.ts:283` | makeup_reservations delete | 42501(RLS)·기타 | 기타: — | 있음 | P1 | — |
| `features/attendance/server/makeup-reservation-actions.ts:377` | makeup_reservations delete | 42501(RLS)·기타 | 일반 문구: "예약을 취소하지 못했습니다 — 잠시 후 다시 시도하세요" | 있음 | P1 | — |
| `features/attendance/server/makeup-reservation-complete.ts:243` | makeup_reservations update | 23505(makeup_reservations_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 기타 반환: return undefined; | 없음 | P1 | — |
| `features/attendance/server/makeup-reservation-complete.ts:270` | attendance_records update | 23514(CHECK 3) · 23503(대상 없음) | 기타: — | 없음 | P1 | — |
| `features/attendance/server/makeup-reservation-complete.ts:321` | makeup_reservations update | 23505(makeup_reservations_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 기타 반환: return; | 없음 | P1 | — |
| `features/attendance/server/prefs-actions.ts:106` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/attendance/server/salary-rates-actions.ts:35` | attendance_salary_rates upsert | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/actions.ts:91` | invoices insert | 23505(invoices_tenant_student_period_idx) · 23503(대상 없음) · P0001(트리거) | 코드별 일부 매핑: — | 없음 | P1 | — |
| `features/billing/server/actions.ts:92` | invoices insert | 23505(invoices_tenant_student_period_idx) · 23503(대상 없음) · P0001(트리거) | 일반 문구: "이미 해당 학생의 이 달 청구서가 있습니다" | 없음 | P1 | — |
| `features/billing/server/catalog-actions.ts:57` | textbook_catalog insert | 23505(ux_textbook_catalog_makeedu) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/catalog-actions.ts:88` | textbook_catalog update | 23505(ux_textbook_catalog_makeedu) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/catalog-actions.ts:107` | textbook_catalog delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/catalog-actions.ts:127` | textbook_catalog update | 23505(ux_textbook_catalog_makeedu) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/expense-actions.ts:199` | expenses insert | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/expense-actions.ts:265` | expenses update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/expense-actions.ts:320` | expenses delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/expense-actions.ts:378` | expenses update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/expense-actions.ts:448` | expenses insert | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/expense-actions.ts:494` | expenses update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/expense-actions.ts:587` | expenses update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/expense-actions.ts:633` | expenses update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/manual-invoice-actions.ts:70` | invoices update | 23505(invoices_tenant_student_period_idx) · 23503(대상 없음) · P0001(트리거) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/billing/server/manual-invoice-actions.ts:115` | invoices update | 23505(invoices_tenant_student_period_idx) · 23503(대상 없음) · P0001(트리거) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/billing/server/queries.ts:219` | rpc:invoice_periods rpc | P0001(RPC RAISE)·42501 | 기타: — | 있음 | P1 | — |
| `features/billing/server/refund-actions.ts:89` | academy_documents update | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: '저장 실패: ${error.message | 없음 | P1 | — |
| `features/billing/server/refund-actions.ts:111` | academy_documents insert | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: '저장 실패: ${error?.message ?? "unknown" | 없음 | P1 | — |
| `features/billing/server/refund-actions.ts:200` | academy_documents delete | 42501(RLS)·기타 | 영문 원문 노출: '삭제 실패: ${error.message | 없음 | P1 | — |
| `features/billing/server/textbook-actions.ts:132` | textbook_orders insert | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/billing/server/textbook-actions.ts:201` | textbook_orders insert | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/billing/server/textbook-actions.ts:293` | textbook_orders update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/billing/server/textbook-actions.ts:329` | textbook_orders delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/billing/server/textbook-actions.ts:376` | textbook_orders update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/billing/server/textbook-actions.ts:443` | textbook_orders update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/billing/server/textbook-actions.ts:480` | textbook_orders delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/billing/server/textbook-notice-actions.ts:271` | textbook_orders update | 23503(대상 없음) | 기타: — | 있음 | P1 | — |
| `features/billing/server/tuition-catalog-actions.ts:55` | tuition_catalog insert | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/tuition-catalog-actions.ts:79` | tuition_catalog update | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/tuition-catalog-actions.ts:98` | tuition_catalog delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/tuition-catalog-actions.ts:128` | tuition_catalog update | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/tuition-catalog-actions.ts:148` | tuition_catalog update | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/server/tuition-quote-actions.ts:80` | tuition_quotes update | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/billing/server/tuition-quote-actions.ts:92` | tuition_quotes insert | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/billing/server/tuition-quote-actions.ts:111` | tuition_quotes delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/session-terms/server/actions.ts:188` | invoice_session_terms upsert | 23505(invoice_session_terms_tenant_id_invoice_id_class_id_key) · 23514(CHECK 4) · 23503(대상 없음) · P0001(트리거) | 영문 원문 노출: '계획 저장 실패: ${error.message | 없음 | P1 | — |
| `features/billing/session-terms/server/actions.ts:192` | invoice_session_terms delete | P0001(트리거) | 영문 원문 노출: '정리 실패: ${error.message | 없음 | P1 | — |
| `features/billing/session-terms/server/actions.ts:215` | invoice_session_terms update | 23505(invoice_session_terms_tenant_id_invoice_id_class_id_key) · 23514(CHECK 4) · 23503(대상 없음) · P0001(트리거) | 영문 원문 노출: '${label | 없음 | P1 | — |
| `features/billing/session-terms/server/actions.ts:485` | invoice_session_terms update | 23505(invoice_session_terms_tenant_id_invoice_id_class_id_key) · 23514(CHECK 4) · 23503(대상 없음) · P0001(트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/session-terms/server/actions.ts:536` | invoice_session_terms update | 23505(invoice_session_terms_tenant_id_invoice_id_class_id_key) · 23514(CHECK 4) · 23503(대상 없음) · P0001(트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/session-terms/server/actions.ts:613` | rpc:session_term_attendance rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: attErr.message | 없음 | P1 | — |
| `features/billing/session-terms/server/actions.ts:665` | invoice_session_terms update | 23505(invoice_session_terms_tenant_id_invoice_id_class_id_key) · 23514(CHECK 4) · 23503(대상 없음) · P0001(트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/session-terms/server/delete-actions.ts:94` | invoice_session_terms delete | P0001(트리거) | 일반 문구: "회차를 삭제하지 못했습니다. 다시 시도해 주세요" | 없음 | P1 | 로그만 |
| `features/billing/session-terms/server/money-carryover-actions.ts:101` | rpc:save_session_term_money_carryover rpc | P0001(RPC RAISE)·42501 | 코드별 일부 매핑: — | 있음 | P1 | — |
| `features/billing/session-terms/server/money-carryover-actions.ts:103` | rpc:save_session_term_money_carryover rpc | P0001(RPC RAISE)·42501 | 상수·도우미 문구: UNAVAILABLE | 없음 | P1 | — |
| `features/billing/session-terms/server/money-carryover-actions.ts:105` | rpc:save_session_term_money_carryover rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/session-terms/server/monthly-sessions.ts:23` | invoice_session_terms update | 23505(invoice_session_terms_tenant_id_invoice_id_class_id_key) · 23514(CHECK 4) · 23503(대상 없음) · P0001(트리거) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/billing/session-terms/server/note-actions.ts:44` | invoice_session_terms update | 23505(invoice_session_terms_tenant_id_invoice_id_class_id_key) · 23514(CHECK 4) · 23503(대상 없음) · P0001(트리거) | 일반 문구: "메모를 저장하지 못했습니다. 다시 시도해 주세요" | 없음 | P1 | 로그만 |
| `features/billing/session-terms/server/receipt-allocation-actions.ts:91` | rpc:edit_receipt_merge_group rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/session-terms/server/receipt-allocation-actions.ts:143` | rpc:save_session_receipt_allocations rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/session-terms/server/receipt-allocation-actions.ts:184` | rpc:save_session_receipt_allocations_free rpc | P0001(RPC RAISE)·42501 | 코드별 일부 매핑: — | 있음 | P1 | — |
| `features/billing/session-terms/server/receipt-allocation-actions.ts:185` | rpc:save_session_receipt_allocations_free rpc | P0001(RPC RAISE)·42501 | 일반 문구: "자유 배분 기능이 아직 켜지지 않았습니다. 관리자에게 알려 주세요(SQL 적용 필요)" | 없음 | P1 | — |
| `features/billing/session-terms/server/receipt-allocation-actions.ts:186` | rpc:save_session_receipt_allocations_free rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/billing/session-terms/server/splits-actions.ts:104` | invoice_teacher_splits upsert | 23505(invoice_teacher_splits_tenant_id_invoice_id_class_id_key) · 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "분배 저장에 실패했습니다 — 기존 스냅샷은 보존됐습니다. 다시 시도하세요" | 있음 | P1 | — |
| `features/billing/session-terms/server/splits-actions.ts:136` | invoice_teacher_splits delete | 42501(RLS)·기타 | 일반 문구: "저장은 완료됐으나 이전 잔여 행 정리에 실패했습니다 — 다시 저장하세요" | 있음 | P1 | — |
| `features/class-sheets/server/actions.ts:153` | rpc:ecs_copy_week rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: '지난주 복사에 실패했습니다: ${error.message | 없음 | P1 | — |
| `features/class-sheets/server/actions.ts:227` | class_sheet_goals delete | 42501(RLS)·기타 | 영문 원문 노출: '저장에 실패했습니다: ${error.message | 없음 | P1 | — |
| `features/class-sheets/server/actions.ts:245` | class_sheet_goals upsert | 23505(class_sheet_goals_tenant_id_class_id_scope_period_start_rol_key) · 23514(CHECK 6) · 23503(대상 없음) | 영문 원문 노출: '저장에 실패했습니다: ${error.message | 없음 | P1 | — |
| `features/class-sheets/server/actions.ts:372` | class_sheet_student_marks upsert | 23505(class_sheet_student_marks_tenant_id_class_id_student_id_mar_key) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: '저장에 실패했습니다: ${error.message | 없음 | P1 | — |
| `features/class-sheets/server/actions.ts:439` | class_sheet_memos delete | 42501(RLS)·기타 | 영문 원문 노출: '저장에 실패했습니다: ${error.message | 없음 | P1 | — |
| `features/class-sheets/server/actions.ts:454` | class_sheet_memos upsert | 23505(class_sheet_memos_tenant_id_class_id_week_start_memo_key_key) · 23514(CHECK 3) · 23503(대상 없음) | 영문 원문 노출: '저장에 실패했습니다: ${error.message | 없음 | P1 | — |
| `features/class-sheets/server/actions.ts:501` | class_sheet_slot_flags delete | 42501(RLS)·기타 | 상수·도우미 문구: saveError(error) | 없음 | P1 | 고침(번역기 내부) |
| `features/class-sheets/server/actions.ts:529` | class_sheet_slot_flags upsert | 23505(class_sheet_slot_flags_tenant_id_class_id_flag_date_slot_st_key) · 23503(대상 없음) | 상수·도우미 문구: saveError(error) | 없음 | P1 | 고침(번역기 내부) |
| `features/class-sheets/server/actions.ts:739` | rpc:ecs_mark_present_if_absent rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: '출석 저장에 실패했습니다: ${error.message | 없음 | P1 | — |
| `features/class-sheets/server/actions.ts:807` | rpc:ecs_clear_present rpc | P0001(RPC RAISE)·42501 | 기타: — | 없음 | P1 | — |
| `features/class-sheets/server/actions.ts:810` | rpc:ecs_clear_present rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: '출석 취소에 실패했습니다: ${error.message | 없음 | P1 | — |
| `features/class-sheets/server/actions.ts:1023` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/class-sheets/server/carry-marks.ts:114` | class_sheet_student_marks upsert | 23505(class_sheet_student_marks_tenant_id_class_id_student_id_mar_key) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: null | 있음 | P1 | — |
| `features/class-sheets/server/carry-marks.ts:115` | class_sheet_student_marks upsert | 23505(class_sheet_student_marks_tenant_id_class_id_student_id_mar_key) · 23514(CHECK 2) · 23503(대상 없음) | 상수·도우미 문구: null | 없음 | P1 | — |
| `features/class-sheets/server/month-memo-actions.ts:60` | class_sheet_month_memos delete | 42501(RLS)·기타 | 일반 문구: "메모 칸은 아직 준비 중입니다(관리자에게 문의하세요)" | 없음 | P1 | — |
| `features/class-sheets/server/month-memo-actions.ts:61` | class_sheet_month_memos delete | 42501(RLS)·기타 | 일반 문구: "메모 칸은 아직 준비 중입니다(관리자에게 문의하세요)" | 없음 | P1 | — |
| `features/class-sheets/server/month-memo-actions.ts:79` | class_sheet_month_memos upsert | 23505(class_sheet_month_memos_tenant_id_class_id_month_key) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: "메모 칸은 아직 준비 중입니다(관리자에게 문의하세요)" | 없음 | P1 | — |
| `features/class-sheets/server/month-memo-actions.ts:80` | class_sheet_month_memos upsert | 23505(class_sheet_month_memos_tenant_id_class_id_month_key) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: "메모 칸은 아직 준비 중입니다(관리자에게 문의하세요)" | 없음 | P1 | — |
| `features/class-sheets/server/month-plan-actions.ts:106` | class_month_plan_cells delete | 42501(RLS)·기타 | 상수·도우미 문구: saveError(error) | 없음 | P1 | 고침(번역기 내부) |
| `features/class-sheets/server/month-plan-actions.ts:125` | class_month_plan_cells upsert | 23505(class_month_plan_cells_pos_uq) · 23514(CHECK 2) · 23503(대상 없음) | 상수·도우미 문구: saveError(error) | 없음 | P1 | 고침(번역기 내부) |
| `features/class-sheets/server/plan-write.ts:391` | rpc:ecs_copy_slot rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: "이 기능은 아직 준비 중입니다(DB 반영 대기)" | 없음 | P1 | — |
| `features/class-sheets/server/plan-write.ts:393` | rpc:ecs_copy_slot rpc | P0001(RPC RAISE)·42501 | 일반 문구: "이 기능은 아직 준비 중입니다(DB 반영 대기)" | 없음 | P1 | — |
| `features/classes/server/actions.ts:279` | classes insert | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 상수·도우미 문구: SAVE_FAILED | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:298` | class_schedules insert | 23503(대상 없음) | 일반 문구: "스케줄 저장에 실패했습니다. 잠시 후 다시 시도해주세요." | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:407` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 상수·도우미 문구: SAVE_FAILED | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:482` | class_schedules insert | 23503(대상 없음) | 상수·도우미 문구: restore.error | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:509` | class_schedules insert | 23503(대상 없음) | 기타: — | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:682` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:723` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: updErr.message | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:756` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: updErr.message | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:859` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: updErr.message | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:898` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: updErr.message | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:939` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: updErr.message | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:1016` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: updErr.message | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:1121` | class_delegations insert | 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: insErr.message | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/actions.ts:1177` | class_delegations update | 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: updErr.message | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/classes/server/enrollment-lifecycle.ts:75` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: toKorean(bulkErr.message) | 없음 | P1 | 고침(이유+로그) |
| `features/classes/server/enrollment-lifecycle.ts:83` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: toKorean(error.message) | 없음 | P1 | 고침(이유+로그) |
| `features/classes/server/enrollment-lifecycle.ts:116` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: toKorean(error.message) | 없음 | P1 | 고침(이유+로그) |
| `features/classes/server/handover.ts:77` | class_schedules insert | 23503(대상 없음) | 영문 원문 노출: archErr.message | 없음 | P1 | — |
| `features/classes/server/handover.ts:86` | class_schedules update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/classes/server/handover.ts:129` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/classes/server/list-prefs.ts:36` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/consultations/server/actions.ts:178` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/consultations/server/audio-actions.ts:111` | student_consultations insert | 23505(ux_student_consultations_makeedu) · 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: '상담 생성 실패: ${insertErr?.message ?? "unknown" | 없음 | P1 | 고침(이유+로그) |
| `features/consultations/server/audio-actions.ts:204` | student_consultations update | 23505(ux_student_consultations_makeedu) · 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: updErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/consultations/server/class-support.ts:91` | rpc:consultation_class_candidates rpc | P0001(RPC RAISE)·42501 | 기타 반환: { if (isMissingClassSchema(error)) return null; throw new Error('반 후보 조회 실패: ${error.messa | 없음 | P1 | — |
| `features/consultations/server/class-support.ts:92` | rpc:consultation_class_candidates rpc | P0001(RPC RAISE)·42501 | 기타 반환: return null; | 없음 | P1 | — |
| `features/consultations/server/stats.ts:48` | rpc:consultation_stats rpc | P0001(RPC RAISE)·42501 | 기타 반환: { noteClassSchema(true); return { full: true, today, ...(data as Omit<Extract<Consultation | 없음 | P1 | — |
| `features/consultations/server/stats.ts:52` | rpc:consultation_stats rpc | P0001(RPC RAISE)·42501 | throw(화면은 일반 오류): new Error('상담 통계 조회 실패: ${error.message}') | 없음 | P1 | — |
| `features/consultations/server/stats.ts:53` | rpc:consultation_stats rpc | P0001(RPC RAISE)·42501 | 기타: — | 없음 | P1 | — |
| `features/consultations/server/stats.ts:92` | rpc:consultation_gap_students rpc | P0001(RPC RAISE)·42501 | 기타 반환: return { full: true, today, ...(data as Omit<Extract<GapStats, { full: true }>, "full" \| " | 없음 | P1 | — |
| `features/consultations/server/stats.ts:93` | rpc:consultation_gap_students rpc | P0001(RPC RAISE)·42501 | throw(화면은 일반 오류): new Error('상담 공백 조회 실패: ${error.message}') | 없음 | P1 | — |
| `features/enrollment/server/actions.ts:201` | enrollment_consultations insert | 23505(ec_tenant_legacy_key_uidx, ux_enrollment_consultations_makeedu) · 23503(대상 없음) | 영문 원문 노출: error?.message ?? "저장 실패" | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/actions.ts:257` | enrollment_consultations insert | 23505(ec_tenant_legacy_key_uidx, ux_enrollment_consultations_makeedu) · 23503(대상 없음) | 영문 원문 노출: '상담 생성 실패: ${insertErr?.message ?? "unknown" | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/actions.ts:314` | consultation_recordings insert | 23503(대상 없음) | 기타 반환: return '녹음 행 생성 실패: ${recErr?.message ?? "unknown"}'; | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/actions.ts:394` | enrollment_consultations update | 23505(ec_tenant_legacy_key_uidx, ux_enrollment_consultations_makeedu) · 23503(대상 없음) | 기타 반환: return '음성 첨부 실패: ${updErr.message}'; | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/actions.ts:468` | enrollment_consultations update | 23505(ec_tenant_legacy_key_uidx, ux_enrollment_consultations_makeedu) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/actions.ts:559` | enrollment_consultations update | 23505(ec_tenant_legacy_key_uidx, ux_enrollment_consultations_makeedu) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/actions.ts:677` | enrollment_consultations update | 23505(ec_tenant_legacy_key_uidx, ux_enrollment_consultations_makeedu) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/actions.ts:741` | enrollment_consultations delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/actions.ts:947` | students insert | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 기타: — | 없음 | P1 | — |
| `features/enrollment/server/actions.ts:1006` | enrollments insert | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 일반 문구: "학생은 준비됐으나 반 배정에 실패했습니다. 학생 상세에서 반을 배정해 주세요." | 있음 | P1 | — |
| `features/enrollment/server/actions.ts:1136` | consultation_ai_analysis update | 23505(ai_consultation_model_idx) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/actions.ts:1322` | enrollment_consultations update | 23505(ec_tenant_legacy_key_uidx, ux_enrollment_consultations_makeedu) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/intake-actions.ts:59` | intake_tokens insert | 23505(intake_tokens_token_key) · 23503(대상 없음) | 일반 문구: "접수 링크를 만들지 못했습니다" | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/intake-actions.ts:84` | intake_tokens delete | 42501(RLS)·기타 | 일반 문구: "접수 링크를 삭제하지 못했습니다" | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/intake-actions.ts:95` | intake_tokens update | 23505(intake_tokens_token_key) · 23503(대상 없음) | 일반 문구: "만료일을 바꾸지 못했습니다" | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/intake-actions.ts:108` | intake_tokens update | 23505(intake_tokens_token_key) · 23503(대상 없음) | 일반 문구: "접수 링크 상태를 바꾸지 못했습니다" | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/intake-actions.ts:300` | enrollment_consultations insert | 23505(ec_tenant_legacy_key_uidx, ux_enrollment_consultations_makeedu) · 23503(대상 없음) | 일반 문구: "제출에 실패했습니다. 잠시 후 다시 시도해주세요" | 없음 | P1 | 고침(이유+로그) |
| `features/enrollment/server/merge-actions.ts:169` | rpc:merge_enrollment_consultations rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/enrollment/server/prep-actions.ts:36` | enrollment_consultations update | 23505(ec_tenant_legacy_key_uidx, ux_enrollment_consultations_makeedu) · 23503(대상 없음) | 일반 문구: "생성 시작에 실패했습니다 — 잠시 후 다시 시도해 주세요" | 있음 | P1 | — |
| `features/enrollment/server/prep-generate.ts:76` | enrollment_consultations update | 23505(ec_tenant_legacy_key_uidx, ux_enrollment_consultations_makeedu) · 23503(대상 없음) | 일반 문구: "브리프 저장에 실패했습니다" | 있음 | P1 | — |
| `features/enrollment/server/school-prefs-actions.ts:47` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/enrollment/server/stats-queries.ts:177` | rpc:consultation_monthly_stats rpc | P0001(RPC RAISE)·42501 | throw(화면은 일반 오류): error | 없음 | P1 | — |
| `features/enrollments/server/actions.ts:117` | enrollments insert | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 상수·도우미 문구: await describeOverlapConflict(supabase | 없음 | P1 | 고침(이유+로그) |
| `features/enrollments/server/actions.ts:119` | enrollments insert | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 상수·도우미 문구: await describeOverlapConflict(supabase | 없음 | P1 | — |
| `features/enrollments/server/actions.ts:223` | rpc:move_class_enrollments_batch rpc | P0001(RPC RAISE)·42501 | 상수·도우미 문구: toKoreanDbError(error | 없음 | P1 | 고침(이유+로그) |
| `features/enrollments/server/actions.ts:319` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 상수·도우미 문구: toKoreanDbError(error | 없음 | P1 | 고침(이유+로그) |
| `features/enrollments/server/actions.ts:515` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 상수·도우미 문구: await describeOverlapConflict( | 없음 | P1 | 고침(이유+로그) |
| `features/enrollments/server/actions.ts:516` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 상수·도우미 문구: await describeOverlapConflict( | 없음 | P1 | — |
| `features/enrollments/server/actions.ts:796` | enrollments delete | 42501(RLS)·기타 | 상수·도우미 문구: toKoreanDbError(delErr | 없음 | P1 | 고침(이유+로그) |
| `features/enrollments/server/bulk-assign-actions.ts:103` | enrollments insert | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 상수·도우미 문구: await describeOverlapConflict(supabase | 없음 | P1 | 고침(이유+로그) |
| `features/enrollments/server/bulk-assign-actions.ts:104` | enrollments insert | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 상수·도우미 문구: await describeOverlapConflict(supabase | 없음 | P1 | — |
| `features/enrollments/server/lab-separate-actions.ts:66` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 일반 문구: "따로 수업(*LAB) 배정 칸이 아직 없습니다 — 관리자에게 문의하세요(0271b 미적용)" | 없음 | P1 | 고침(이유+로그) |
| `features/enrollments/server/lab-separate-actions.ts:67` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 일반 문구: "따로 수업(*LAB) 배정 칸이 아직 없습니다 — 관리자에게 문의하세요(0271b 미적용)" | 없음 | P1 | — |
| `features/enrollments/server/scheduled-actions.ts:95` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 상수·도우미 문구: toKoreanDbError(upErr | 없음 | P1 | 고침(이유+로그) |
| `features/enrollments/server/scheduled-actions.ts:112` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 일반 문구: "새 반의 시작일은 바꿨지만 이전 반의 종료일을 못 바꿨습니다 — 두 날짜가 어긋났습니다. " + | 없음 | P1 | 고침(이유+로그) |
| `features/enrollments/server/scheduled-actions.ts:160` | enrollments delete | 42501(RLS)·기타 | 상수·도우미 문구: toKoreanDbError(delErr | 없음 | P1 | 고침(이유+로그) |
| `features/enrollments/server/scheduled-actions.ts:175` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 일반 문구: "예약은 지웠지만 이전 반을 되살리지 못했습니다 — 그대로 두면 그 날짜부터 반이 없습니다. " + | 없음 | P1 | 고침(이유+로그) |
| `features/grades/server/list-prefs.ts:41` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/grades/server/write.ts:153` | student_grades upsert | 23505(ux_grades_exam_student, ux_grades_term_slot_month) · 23514(CHECK 5) · 23503(대상 없음) | 기타: — | 없음 | P1 | — |
| `features/grades/server/write.ts:164` | student_grades upsert | 23505(ux_grades_exam_student, ux_grades_term_slot_month) · 23514(CHECK 5) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('성적 저장 실패: ${retry.error.message}') | 없음 | P1 | — |
| `features/grades/server/write.ts:182` | student_grades upsert | 23505(ux_grades_exam_student, ux_grades_term_slot_month) · 23514(CHECK 5) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('성적 삭제 실패: ${error.message}') | 없음 | P1 | — |
| `features/grades/server/write.ts:238` | student_grades update | 23505(ux_grades_exam_student, ux_grades_term_slot_month) · 23514(CHECK 5) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/grades/server/write.ts:259` | student_grades update | 23505(ux_grades_exam_student, ux_grades_term_slot_month) · 23514(CHECK 5) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/grades/unified/server/actions.ts:99` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | 영문 원문 노출: saveError?.message ?? "테스트 점수를 저장하지 못했습니다" | 없음 | P1 | — |
| `features/grades/unified/server/actions.ts:123` | level_tests update | 23503(대상 없음) | 영문 원문 노출: saveError?.message ?? "입학테스트를 저장하지 못했습니다" | 없음 | P1 | — |
| `features/math-sheets/server/actions.ts:74` | math_month_goals delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/math-sheets/server/actions.ts:88` | math_month_goals upsert | 23505(math_month_goals_pos_uq) · 23514(CHECK 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/math-sheets/server/actions.ts:172` | math_month_goals upsert | 23505(math_month_goals_pos_uq) · 23514(CHECK 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/math-sheets/server/actions.ts:212` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/math-sheets/server/learning-actions.ts:211` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: "수업 유형을 저장하지 못했습니다. 다시 시도해 주세요." | 없음 | P1 | 로그만 |
| `features/newcomers/server/actions.ts:83` | student_onboarding_checks upsert | 23505(student_onboarding_checks_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 기타: — | 없음 | P1 | — |
| `features/newcomers/server/actions.ts:90` | student_onboarding_checks upsert | 23505(student_onboarding_checks_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: missing | 없음 | P1 | — |
| `features/newcomers/server/actions.ts:110` | student_onboarding_checks update | 23505(student_onboarding_checks_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 기타: — | 있음 | P1 | — |
| `features/newcomers/server/consult-link.ts:189` | student_onboarding_checks upsert | 23505(student_onboarding_checks_uniq) · 23514(CHECK 3) · 23503(대상 없음) | throw(화면은 일반 오류): new Error(error.message) | 없음 | P1 | — |
| `features/newcomers/server/consult-link.ts:197` | student_onboarding_checks update | 23505(student_onboarding_checks_uniq) · 23514(CHECK 3) · 23503(대상 없음) | throw(화면은 일반 오류): new Error(again.error.message) | 없음 | P1 | — |
| `features/newcomers/server/consult-link.ts:202` | student_onboarding_checks insert | 23505(student_onboarding_checks_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 기타 반환: return false; | 없음 | P1 | — |
| `features/newcomers/server/consult-link.ts:203` | student_onboarding_checks insert | 23505(student_onboarding_checks_uniq) · 23514(CHECK 3) · 23503(대상 없음) | throw(화면은 일반 오류): new Error(error.message) | 없음 | P1 | — |
| `features/newcomers/server/consult-link.ts:216` | student_onboarding_checks update | 23505(student_onboarding_checks_uniq) · 23514(CHECK 3) · 23503(대상 없음) | throw(화면은 일반 오류): new Error(error.message) | 없음 | P1 | — |
| `features/onescreen/server/actions.ts:371` | lesson_reports upsert | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | 영문 원문 노출: error?.message ?? "보고서 저장에 실패했습니다" | 없음 | P1 | — |
| `features/onescreen/server/actions.ts:876` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/onescreen/server/actions.ts:949` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/onescreen/server/actions.ts:1009` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/onescreen/server/actions.ts:1184` | onescreen_daily_sessions insert | 23505(onescreen_daily_sessions_teacher_uniq) · 23503(대상 없음) | 기타 반환: return { ok: true, updatedAt: (ins.data?.updated_at as string \| undefined) ?? undefined }; | 없음 | P1 | — |
| `features/onescreen/server/actions.ts:1212` | onescreen_daily_sessions update | 23505(onescreen_daily_sessions_teacher_uniq) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/onescreen/server/actions.ts:1399` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/onescreen/server/actions.ts:1451` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/onescreen/server/actions.ts:1505` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 일반 문구: "설정을 저장하지 못했습니다" | 없음 | P1 | 로그만 |
| `features/onescreen/server/attachment-actions.ts:199` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | 영문 원문 노출: '등록 실패: ${error.message | 없음 | P1 | — |
| `features/onescreen/server/attachment-actions.ts:241` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | 영문 원문 노출: '삭제 실패: ${error.message | 없음 | P1 | — |
| `features/onescreen/server/calendar-actions.ts:41` | rpc:onescreen_send_calendar rpc | P0001(RPC RAISE)·42501 | 일반 문구: "달력을 불러오지 못했습니다" | 없음 | P1 | 로그만 |
| `features/onescreen/server/makeup-remove-actions.ts:162` | lesson_reports delete | 42501(RLS)·기타 | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/onescreen/server/ment-style-build.ts:156` | teacher_ment_styles upsert | 23505(teacher_ment_styles_teacher_uniq) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('저장 실패: ${error.message}') | 없음 | P1 | — |
| `features/onescreen/server/notice-actions.ts:237` | classnote_notices insert | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/onescreen/server/order-actions.ts:62` | onescreen_student_order upsert | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/onescreen/server/prompt-actions.ts:125` | ai_prompt_overrides insert | 23505(ai_prompt_overrides_active_key) · 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/onescreen/server/prompt-actions.ts:150` | ai_prompt_overrides update | 23505(ai_prompt_overrides_active_key) · 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/owner/server/classroom-actions.ts:53` | classrooms insert | 23505(classrooms_tenant_name_idx) · 23503(대상 없음) | 코드별 일부 매핑: — | 없음 | P1 | 고침(이유+로그) |
| `features/owner/server/classroom-actions.ts:85` | classrooms update | 23505(classrooms_tenant_name_idx) · 23503(대상 없음) | 코드별 일부 매핑: — | 없음 | P1 | 고침(이유+로그) |
| `features/owner/server/classroom-actions.ts:129` | classrooms update | 23505(classrooms_tenant_name_idx) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/owner/server/classroom-actions.ts:178` | classrooms delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/owner/server/classroom-actions.ts:230` | classrooms update | 23505(classrooms_tenant_name_idx) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/account-actions.ts:175` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 코드별 일부 매핑: — | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/account-actions.ts:176` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 일반 문구: "이미 사용 중인 이메일입니다" | 없음 | P1 | — |
| `features/staff/server/account-actions.ts:269` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: dbErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/account-actions.ts:379` | users delete | 23503(사용 중: attendance_records_recorded_by_users_id_fk, help_answers_author_id_fkey 외) · 42501·P0001(보호 트리거) | 코드별 일부 매핑: — | 있음 | P1 | 고침(이유+로그) |
| `features/staff/server/account-actions.ts:382` | users delete | 23503(사용 중: attendance_records_recorded_by_users_id_fk, help_answers_author_id_fkey 외) · 42501·P0001(보호 트리거) | 일반 문구: "연결된 데이터가 있어 삭제를 완료하지 못했습니다. 관리자에게 문의하세요." | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/account-actions.ts:435` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/actions.ts:201` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 상수·도우미 문구: dbErr | 없음 | P1 | — |
| `features/staff/server/actions.ts:208` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: retryErr | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/actions.ts:211` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: '직원 정보 저장 실패: ${retryErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/actions.ts:216` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: '직원 정보 저장 실패: ${dbErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/actions.ts:222` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 기타: — | 없음 | P1 | — |
| `features/staff/server/actions.ts:401` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 일반 문구: "나머지는 저장했습니다. '셔틀 담당' 토글만 아직 저장할 수 없습니다(0227a 미적용) — 관리자에게 문의하세요." | 없음 | P1 | — |
| `features/staff/server/actions.ts:407` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 일반 문구: "나머지는 저장했습니다. '셔틀 담당' 토글만 아직 저장할 수 없습니다(0227a 미적용) — 관리자에게 문의하세요." | 없음 | P1 | — |
| `features/staff/server/actions.ts:415` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 상수·도우미 문구: retry | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/actions.ts:417` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 상수·도우미 문구: retry | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/actions.ts:502` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: dbErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/actions.ts:635` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/actions.ts:823` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/contract-actions.ts:74` | staff_contracts insert | 23505(staff_contracts_user_seq_idx) · 23514(CHECK 3) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/contract-actions.ts:141` | staff_contracts update | 23505(staff_contracts_user_seq_idx) · 23514(CHECK 3) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/contract-actions.ts:189` | staff_contracts delete | 42501(RLS)·기타 | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/contract-file-actions.ts:72` | academy_documents insert | 23514(CHECK 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/contract-file-actions.ts:116` | academy_documents delete | 42501(RLS)·기타 | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/intake-token-actions.ts:90` | academy_documents insert | 23514(CHECK 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/intake-token-actions.ts:179` | academy_documents update | 23514(CHECK 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/list-prefs.ts:45` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/staff/server/me-actions.ts:59` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: '이메일 변경 실패 — ${dbErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/staff/server/me-actions.ts:122` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 일반 문구: "DB 업데이트(0217a)가 아직 적용되지 않았습니다 — 관리자에게 문의하세요" | 있음 | P1 | — |
| `features/staff/server/me-actions.ts:124` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 일반 문구: "DB 업데이트(0217a)가 아직 적용되지 않았습니다 — 관리자에게 문의하세요" | 없음 | P1 | — |
| `features/staff/server/notion.ts:321` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 일반 문구: "매핑 저장에 실패했습니다" | 없음 | P1 | 로그만 |
| `features/staff/server/public-intake-actions.ts:91` | academy_documents insert | 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "등록 처리에 실패했습니다 — 학원에 문의해 주세요" | 없음 | P1 | 로그만 |
| `features/staff/server/public-intake-actions.ts:124` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 일반 문구: "등록 처리에 실패했습니다 — 학원에 문의해 주세요" | 없음 | P1 | 로그만 |
| `features/staff/server/resume-actions.ts:257` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 기타 반환: { await admin.auth.admin.deleteUser(authData.user.id); await admin.from("users").delete(). | 없음 | P1 | — |
| `features/staff/server/resume-actions.ts:344` | academy_documents update | 23514(CHECK 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/resume-actions.ts:399` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/resume-actions.ts:484` | academy_documents insert | 23514(CHECK 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/staff/server/resume-actions.ts:529` | academy_documents delete | 42501(RLS)·기타 | humanizeDbError(문구 파싱): — | 없음 | P1 | — |
| `features/students/server/actions.ts:200` | students insert | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 영문 원문 노출: translateDbError(error?.message ?? "학생 등록 실패") | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:252` | students delete | 23503(사용 중: invoices_student_id_students_id_fk) | 영문 원문 노출: translateDbError(error.message) | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:387` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 영문 원문 노출: translateDbError(error.message) | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:408` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: enrErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:545` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 영문 원문 노출: schErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:567` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 영문 원문 노출: stuErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:581` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 영문 원문 노출: stuErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:589` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: enrErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:611` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 영문 원문 노출: stuErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:624` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: enrErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:657` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:802` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 일반 문구: "수강을 대기로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요." | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:812` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 일반 문구: "수강을 되돌리지 못했습니다. 잠시 후 다시 시도해 주세요." | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:867` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1003` | student_memos insert | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1028` | student_memos delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1059` | student_memos update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1087` | student_memos update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1173` | student_grades delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1229` | level_tests insert | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1251` | level_tests delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1321` | grade_goals insert | 23505(ux_grade_goals_cell) · 23514(CHECK 2) · 23503(대상 없음) | 코드별 일부 매핑: — | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1340` | grade_goals delete | 42501(RLS)·기타 | 영문 원문 노출: delErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1385` | grade_comments insert | 23503(대상 없음) | 영문 원문 노출: insErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1418` | grade_comments update | 23503(대상 없음) | 영문 원문 노출: updErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1439` | grade_comments delete | 42501(RLS)·기타 | 영문 원문 노출: delErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/actions.ts:1461` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/enrollment-sync.ts:87` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/enrollment-sync.ts:154` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/enrollment-sync.ts:168` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: uErr.message | 없음 | P1 | 고침(이유+로그) |
| `features/students/server/list-prefs.ts:36` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/textbooks/server/actions.ts:74` | textbooks update | 23505(textbooks_tenant_title_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: friendlyTextbookError(error | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/actions.ts:85` | textbooks insert | 23505(textbooks_tenant_title_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: friendlyTextbookError( | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/actions.ts:128` | textbooks delete | 42501(RLS)·기타 | 상수·도우미 문구: friendlyTextbookError(error | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/actions.ts:189` | textbook_lessons delete | 42501(RLS)·기타 | 상수·도우미 문구: friendlyTextbookError(error | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/actions.ts:204` | textbook_lessons upsert | 23505(textbook_lessons_pos_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: friendlyTextbookError(error | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/cover-actions.ts:104` | textbooks update | 23505(textbooks_tenant_title_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: friendlyTextbookError(error | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/cover-actions.ts:140` | textbooks update | 23505(textbooks_tenant_title_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: friendlyTextbookError(error | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/plan-actions.ts:210` | class_textbook_plans update | 23505(class_textbook_plans_pos_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 상수·도우미 문구: SLOTS_NOT_READY | 없음 | P1 | — |
| `features/textbooks/server/plan-actions.ts:221` | class_textbook_plans update | 23505(class_textbook_plans_pos_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 상수·도우미 문구: friendlyTextbookError(error | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/plan-actions.ts:238` | class_textbook_plans insert | 23505(class_textbook_plans_pos_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 상수·도우미 문구: SLOTS_NOT_READY | 없음 | P1 | — |
| `features/textbooks/server/plan-actions.ts:247` | class_textbook_plans insert | 23505(class_textbook_plans_pos_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 상수·도우미 문구: friendlyTextbookError(error ?? { | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/plan-actions.ts:273` | class_textbook_plans delete | 42501(RLS)·기타 | 상수·도우미 문구: friendlyTextbookError(error | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/plan-actions.ts:884` | rpc:ecs_apply_textbook_lessons rpc | P0001(RPC RAISE)·42501 | 상수·도우미 문구: friendlyTextbookError(error | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/plan-actions.ts:972` | class_lesson_shifts upsert | 23505(class_lesson_shifts_cell_uniq) · 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "회차 미루기는 마이그레이션 0282a가 필요합니다 — 적용한 뒤 다시 시도해 주세요" | 없음 | P1 | 고침(번역기 내부) |
| `features/textbooks/server/plan-actions.ts:974` | class_lesson_shifts upsert | 23505(class_lesson_shifts_cell_uniq) · 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "회차 미루기는 마이그레이션 0282a가 필요합니다 — 적용한 뒤 다시 시도해 주세요" | 없음 | P1 | — |
| `features/timetable/server/actions.ts:75` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: '이미 "${newName | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/timetable/server/actions.ts:76` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: '이미 "${newName | 없음 | P1 | 보고만(fix/class-name-free 작업 중) |
| `features/timetable/server/import-actions.ts:383` | timetable_snapshots insert | 23503(대상 없음) | 일반 문구: "되돌리기용 스냅샷을 저장하지 못해 적용을 중단했습니다(변경 없음). 잠시 후 다시 시도해 주세요." | 있음 | P1 | — |
| `features/timetable/server/import-actions.ts:450` | rpc:move_enrollments_batch rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/timetable/server/import-actions.ts:471` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 기타: — | 없음 | P1 | — |
| `features/timetable/server/import-actions.ts:518` | enrollments insert | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 기타: — | 없음 | P1 | — |
| `features/timetable/server/import-actions.ts:534` | timetable_snapshots update | 23503(대상 없음) | 기타: — | 있음 | P1 | — |
| `features/timetable/server/move-actions.ts:250` | class_schedules insert | 23503(대상 없음) | 기타: — | 없음 | P1 | — |
| `features/timetable/server/move-actions.ts:284` | class_schedules insert | 23503(대상 없음) | 일반 문구: "새 배치를 넣지 못해 되돌렸습니다. 잠시 후 다시 시도해 주세요" | 없음 | P1 | 로그만 |
| `features/timetable/server/queries.ts:585` | rpc:timetable_latest_reports rpc | P0001(RPC RAISE)·42501 | throw(화면은 일반 오류): new Error('timetable_latest_reports RPC 실패: ${error.message}') | 없음 | P1 | — |
| `features/timetable/server/structure-import-actions.ts:361` | rpc:apply_english_structure rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/timetable/server/structure-import-actions.ts:409` | rpc:rollback_english_structure rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/timetable/server/view-prefs-actions.ts:72` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/withdrawals/server/actions.ts:84` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P1 | — |
| `features/withdrawals/server/actions.ts:144` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 일반 문구: "상담 추적을 저장하지 못했습니다" | 없음 | P1 | 로그만 |
| `features/withdrawals/server/actions.ts:201` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 일반 문구: "재원 복구에 실패했습니다. 잠시 후 다시 시도해 주세요." | 없음 | P1 | 로그만 |
| `features/admin/server/actions.ts:67` | ? update | 42501(RLS)·기타 | 영문 원문 노출: '${table | 없음 | P2 | — |
| `features/admin/server/actions.ts:150` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/admin/server/actions.ts:166` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: uErr.message | 없음 | P2 | — |
| `features/admin/server/actions.ts:238` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/admin/server/actions.ts:249` | enrollments update | 23P01(enrollments_no_overlap) · 23503(대상 없음) | 영문 원문 노출: enrErr.message | 없음 | P2 | — |
| `features/admin/server/actions.ts:312` | students delete | 23503(사용 중: invoices_student_id_students_id_fk) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/approvals/server/actions.ts:658` | approval_steps update | 23505(approval_steps_document_id_approver_id_key, approval_steps_document_id_step_no_key) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: '후결 처리 실패 — ${deferErr.message | 없음 | P2 | — |
| `features/approvals/server/actions.ts:677` | approval_steps update | 23505(approval_steps_document_id_approver_id_key, approval_steps_document_id_step_no_key) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: '결재 저장 실패 — ${stepErr.message | 없음 | P2 | — |
| `features/approvals/server/actions.ts:693` | approval_steps update | 23505(approval_steps_document_id_approver_id_key, approval_steps_document_id_step_no_key) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: '전결 처리 실패 — ${skipErr.message | 없음 | P2 | — |
| `features/approvals/server/actions.ts:730` | approval_documents update | 23505(approval_documents_tenant_id_doc_no_key) · 23514(CHECK 2) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/approvals/server/actions.ts:745` | approval_documents update | 23505(approval_documents_tenant_id_doc_no_key) · 23514(CHECK 2) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/approvals/server/actions.ts:880` | approval_steps update | 23505(approval_steps_document_id_approver_id_key, approval_steps_document_id_step_no_key) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: '후결 확인 실패 — ${error.message | 없음 | P2 | — |
| `features/approvals/server/actions.ts:929` | approval_documents update | 23505(approval_documents_tenant_id_doc_no_key) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: '회수 실패 — ${error.message | 없음 | P2 | — |
| `features/approvals/server/actions.ts:1006` | approval_comments insert | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: isMissingRelation(error) | 없음 | P2 | — |
| `features/approvals/server/actions.ts:1063` | approval_comments delete | 42501(RLS)·기타 | 영문 원문 노출: '댓글 삭제 실패 — ${error.message | 없음 | P2 | — |
| `features/approvals/server/actions.ts:1126` | approval_line_templates upsert | 23505(approval_line_templates_tenant_id_owner_id_name_key) · 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: missing | 없음 | P2 | — |
| `features/approvals/server/actions.ts:1159` | approval_line_templates delete | 42501(RLS)·기타 | 영문 원문 노출: '삭제 실패 — ${error.message | 없음 | P2 | — |
| `features/calendar/server/actions.ts:207` | calendar_events update | 23505(calendar_events_google_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: '일정 수정 실패 — ${error.message | 없음 | P2 | — |
| `features/calendar/server/actions.ts:224` | calendar_events insert | 23505(calendar_events_google_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: "반복 일정은 DB 마이그레이션(0222a) 적용 후 사용할 수 있습니다" | 없음 | P2 | — |
| `features/calendar/server/actions.ts:225` | calendar_events insert | 23505(calendar_events_google_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: "반복 일정은 DB 마이그레이션(0222a) 적용 후 사용할 수 있습니다" | 없음 | P2 | — |
| `features/calendar/server/actions.ts:244` | calendar_events insert | 23505(calendar_events_google_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 영문 원문 노출: missing | 없음 | P2 | — |
| `features/calendar/server/actions.ts:305` | calendar_events delete | 42501(RLS)·기타 | 영문 원문 노출: '삭제 실패 — ${error.message | 없음 | P2 | — |
| `features/calendar/server/actions.ts:326` | calendar_events delete | 42501(RLS)·기타 | 영문 원문 노출: '삭제 실패 — ${error.message | 없음 | P2 | — |
| `features/calendar/server/actions.ts:370` | calendar_tags update | 23505(calendar_tags_name_unique) · 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "수정할 태그를 찾을 수 없습니다" | 없음 | P2 | — |
| `features/calendar/server/actions.ts:417` | calendar_tags delete | 42501(RLS)·기타 | 영문 원문 노출: '태그 삭제 실패 — ${error.message | 없음 | P2 | — |
| `features/calendar/server/google-sync-core.ts:226` | calendar_events insert | 23505(calendar_events_google_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 기타: — | 없음 | P2 | — |
| `features/calendar/server/google-sync-core.ts:239` | calendar_events update | 23505(calendar_events_google_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 기타: — | 없음 | P2 | — |
| `features/calendar/server/google-sync-core.ts:262` | calendar_events delete | 42501(RLS)·기타 | 기타: — | 없음 | P2 | — |
| `features/calendar/server/sync-state.ts:64` | ? upsert | 42501(RLS)·기타 | throw(화면은 일반 오류): new Error('calendar_sync_state 쓰기 실패: ${error.message}') | 없음 | P2 | — |
| `features/calendar/server/sync-state.ts:84` | ? upsert | 42501(RLS)·기타 | 기타 반환: { if (isMissingTable(seedErr)) return { status: "unavailable" }; throw new Error('calendar | 없음 | P2 | — |
| `features/calendar/server/sync-state.ts:85` | ? upsert | 42501(RLS)·기타 | 기타 반환: return { status: "unavailable" }; | 없음 | P2 | — |
| `features/calendar/server/sync-state.ts:99` | ? update | 42501(RLS)·기타 | throw(화면은 일반 오류): new Error('calendar_sync_state 잠금 실패: ${error.message}') | 없음 | P2 | — |
| `features/calendar/server/sync-state.ts:108` | ? update | 42501(RLS)·기타 | throw(화면은 일반 오류): new Error('calendar_sync_state 표시 실패: ${mErr.message}') | 없음 | P2 | — |
| `features/class-review/server/actions.ts:138` | academy_documents insert | 23514(CHECK 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/class-review/server/actions.ts:226` | academy_documents update | 23514(CHECK 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/class-review/server/actions.ts:282` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/class-review/server/actions.ts:349` | academy_documents update | 23514(CHECK 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/class-review/server/actions.ts:380` | academy_documents delete | 42501(RLS)·기타 | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/class-review/server/actions.ts:438` | academy_documents update | 23514(CHECK 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/class-review/server/actions.ts:446` | academy_documents insert | 23514(CHECK 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/class-review/server/actions.ts:482` | academy_documents delete | 42501(RLS)·기타 | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/class-review/server/final-review-actions.ts:65` | academy_documents update | 23514(CHECK 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/classnote-reply/server/reaction-actions.ts:71` | classnote_parent_reactions update | 23505(classnote_parent_reactions_message_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 상수·도우미 문구: RETRY | 없음 | P2 | — |
| `features/classnote-reply/server/reaction-actions.ts:93` | classnote_parent_reactions update | 23505(classnote_parent_reactions_message_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 코드별 일부 매핑: — | 있음 | P2 | — |
| `features/classnote-reply/server/reaction-actions.ts:94` | classnote_parent_reactions update | 23505(classnote_parent_reactions_message_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 상수·도우미 문구: UNAVAILABLE | 없음 | P2 | — |
| `features/classnote-reply/server/reaction-actions.ts:95` | classnote_parent_reactions update | 23505(classnote_parent_reactions_message_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 상수·도우미 문구: RETRY | 있음 | P2 | — |
| `features/classnote-reply/server/reaction-actions.ts:149` | classnote_parent_reactions update | 23505(classnote_parent_reactions_message_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 상수·도우미 문구: RETRY | 있음 | P2 | — |
| `features/classnote-reply/server/reply-actions.ts:163` | classnote_parent_replies insert | 23505(classnote_parent_replies_client_key_uniq, classnote_parent_replies_same_body_uniq) · 23514(CHECK 7) · 23503(대상 없음) | 코드별 일부 매핑: — | 있음 | P2 | — |
| `features/classnote-reply/server/reply-actions.ts:164` | classnote_parent_replies insert | 23505(classnote_parent_replies_client_key_uniq, classnote_parent_replies_same_body_uniq) · 23514(CHECK 7) · 23503(대상 없음) | 상수·도우미 문구: SAME_BODY | 없음 | P2 | — |
| `features/classnote-reply/server/reply-actions.ts:173` | classnote_parent_replies insert | 23505(classnote_parent_replies_client_key_uniq, classnote_parent_replies_same_body_uniq) · 23514(CHECK 7) · 23503(대상 없음) | 일반 문구: "사용할 수 없는 기능입니다" | 없음 | P2 | — |
| `features/dashboard/server/actions.ts:60` | announcements insert | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/dashboard/server/actions.ts:101` | announcements update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/dashboard/server/actions.ts:137` | announcements delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/dashboard/server/actions.ts:209` | daily_briefings insert | 23505(daily_briefings_tenant_id_briefing_date_key) · 23503(대상 없음) | 코드별 일부 매핑: — | 있음 | P2 | — |
| `features/dashboard/server/actions.ts:210` | daily_briefings insert | 23505(daily_briefings_tenant_id_briefing_date_key) · 23503(대상 없음) | 일반 문구: "이미 생성이 진행 중입니다. 완료되면 화면이 자동으로 갱신됩니다." | 없음 | P2 | — |
| `features/dashboard/server/actions.ts:260` | announcements update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/dashboard/server/briefing.ts:312` | daily_briefings upsert | 23505(daily_briefings_tenant_id_briefing_date_key) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('브리핑 저장 실패: ${upsertError.message}') | 없음 | P2 | — |
| `features/dashboard/server/briefing.ts:329` | daily_briefings upsert | 23505(daily_briefings_tenant_id_briefing_date_key) · 23503(대상 없음) | 기타: — | 있음 | P2 | — |
| `features/dashboard/server/queries.ts:578` | rpc:dashboard_unassigned_enrolled_admin rpc | P0001(RPC RAISE)·42501 | throw(화면은 일반 오류): new Error('getUnassignedEnrolledStudents: ${error.message}') | 없음 | P2 | — |
| `features/dashboard/server/queries.ts:770` | rpc:dashboard_top_outstanding rpc | P0001(RPC RAISE)·42501 | throw(화면은 일반 오류): new Error('getTopOutstanding: ${error.message}') | 없음 | P2 | — |
| `features/dashboard/server/queries.ts:827` | rpc:dashboard_top_outstanding_admin rpc | P0001(RPC RAISE)·42501 | throw(화면은 일반 오류): new Error('getTopOutstandingCached: ${error.message}') | 없음 | P2 | — |
| `features/dashboard/server/queries.ts:878` | rpc:dashboard_absence_risk_admin rpc | P0001(RPC RAISE)·42501 | throw(화면은 일반 오류): new Error('getAbsenceRiskStudents: ${error.message}') | 없음 | P2 | — |
| `features/dashboard/server/queries.ts:956` | rpc:dashboard_absence_risk_admin rpc | P0001(RPC RAISE)·42501 | throw(화면은 일반 오류): new Error('getAbsenceRiskCached: ${error.message}') | 없음 | P2 | — |
| `features/documents/server/actions.ts:125` | academy_documents insert | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: '등록 실패: ${error?.message ?? "unknown" | 없음 | P2 | — |
| `features/documents/server/actions.ts:175` | academy_documents insert | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: '저장 실패: ${error?.message ?? "unknown" | 없음 | P2 | — |
| `features/documents/server/actions.ts:221` | academy_documents insert | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: '등록 실패: ${error?.message ?? "unknown" | 없음 | P2 | — |
| `features/documents/server/actions.ts:285` | academy_documents update | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: '수정 실패: ${error.message | 없음 | P2 | — |
| `features/documents/server/actions.ts:330` | academy_documents delete | 42501(RLS)·기타 | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/documents/server/actions.ts:400` | academy_documents update | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: '고정 변경 실패: ${error.message | 없음 | P2 | — |
| `features/documents/server/category-actions.ts:42` | rpc:mutate_document_folder rpc | P0001(RPC RAISE)·42501 | 상수·도우미 문구: folderError(error) | 없음 | P2 | 고침(번역기 내부) |
| `features/documents/server/file-actions.ts:36` | academy_documents update | 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "파일을 이동하지 못했습니다. 폴더가 변경되었는지 확인한 뒤 다시 시도해 주세요." | 없음 | P2 | 로그만 |
| `features/documents/server/file-actions.ts:61` | academy_documents update | 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "파일 이름을 저장하지 못했습니다." | 없음 | P2 | 로그만 |
| `features/help/board/server/actions.ts:30` | help_posts insert | 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: HELP_BOARD_NOT_READY | 없음 | P2 | — |
| `features/help/board/server/actions.ts:31` | help_posts insert | 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: HELP_BOARD_NOT_READY | 없음 | P2 | — |
| `features/help/board/server/actions.ts:67` | help_posts update | 23514(CHECK 3) · 23503(대상 없음) | 일반 문구: "수정하지 못했습니다" | 없음 | P2 | 로그만 |
| `features/help/board/server/actions.ts:97` | help_posts delete | 42501(RLS)·기타 | 일반 문구: "삭제하지 못했습니다" | 없음 | P2 | 로그만 |
| `features/help/board/server/actions.ts:132` | help_answers insert | 23514(CHECK 1) · 23503(대상 없음) | 상수·도우미 문구: HELP_BOARD_NOT_READY | 없음 | P2 | — |
| `features/help/board/server/actions.ts:133` | help_answers insert | 23514(CHECK 1) · 23503(대상 없음) | 상수·도우미 문구: HELP_BOARD_NOT_READY | 없음 | P2 | — |
| `features/help/board/server/actions.ts:180` | help_posts update | 23514(CHECK 3) · 23503(대상 없음) | 일반 문구: "닫지 못했습니다" | 없음 | P2 | 로그만 |
| `features/ijw/server/link-actions.ts:53` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 코드별 일부 매핑: — | 있음 | P2 | — |
| `features/ijw/server/link-actions.ts:54` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 상수·도우미 문구: NOT_READY | 없음 | P2 | — |
| `features/ijw/server/link-actions.ts:55` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 일반 문구: "이 인재원 아이디는 이미 다른 학생에게 연결돼 있습니다." | 없음 | P2 | — |
| `features/ijw/server/link-actions.ts:115` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 일반 문구: "연결을 끊지 못했습니다. 잠시 후 다시 시도해 주세요." | 있음 | P2 | — |
| `features/ijw/server/memorized-words.ts:215` | class_sheet_student_marks upsert | 23505(class_sheet_student_marks_tenant_id_class_id_student_id_mar_key) · 23514(CHECK 2) · 23503(대상 없음) | 기타 반환: { return { ok: false, kind: "local", message: "단어수를 저장하지 못했습니다", detail: error.message, }; | 없음 | P2 | — |
| `features/ijw/server/report-snapshot.ts:142` | report_jj_snapshots upsert | 23503(대상 없음) | 기타 반환: return { ok: true }; | 없음 | P2 | — |
| `features/ijw/server/report-snapshot.ts:143` | report_jj_snapshots upsert | 23503(대상 없음) | 기타 반환: return { ok: false, reason: "missing_table" }; | 없음 | P2 | — |
| `features/ijw/server/report-snapshot.ts:164` | report_jj_snapshots delete | 42501(RLS)·기타 | 기타: — | 있음 | P2 | — |
| `features/ijw/server/report-snapshot.ts:183` | report_jj_snapshots delete | 42501(RLS)·기타 | 기타: — | 있음 | P2 | — |
| `features/integrations/server/actions.ts:185` | user_integrations upsert | 23505(user_integrations_tenant_provider_idx) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/integrations/server/actions.ts:227` | user_integrations upsert | 23505(user_integrations_tenant_provider_idx) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/integrations/server/actions.ts:265` | user_integrations upsert | 23505(user_integrations_tenant_provider_idx) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/integrations/server/actions.ts:429` | makeedu_sync_requests insert | 23503(대상 없음) | 영문 원문 노출: '동기화 요청 접수 실패: ${insErr.message | 없음 | P2 | — |
| `features/integrations/server/actions.ts:500` | makeedu_push_requests insert | 23503(대상 없음) | 영문 원문 노출: '전송 요청 접수 실패: ${insErr.message | 없음 | P2 | — |
| `features/inventory/server/asset-actions.ts:121` | inventory_assets insert | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/asset-actions.ts:180` | inventory_assets update | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/asset-actions.ts:230` | inventory_assets update | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/asset-actions.ts:277` | inventory_assets update | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/asset-actions.ts:317` | inventory_assets delete | 42501(RLS)·기타 | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/audit-actions.ts:63` | inventory_audits insert | 23505(inventory_audits_code_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(insErr | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/audit-actions.ts:71` | inventory_assets update | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(upErr | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/audit-actions.ts:141` | inventory_audits update | 23505(inventory_audits_code_uniq) · 23514(CHECK 5) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/audit-actions.ts:193` | inventory_audits delete | 42501(RLS)·기타 | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/excel-actions.ts:304` | inventory_categories insert | 23505(inventory_categories_key_uniq, inventory_categories_label_uniq 외 1) · 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/excel-actions.ts:338` | inventory_assets insert | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/excel-actions.ts:356` | inventory_assets update | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/excel-actions.ts:370` | inventory_supplies insert | 23505(inventory_supplies_code_uniq) · 23514(CHECK 7) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/excel-actions.ts:378` | inventory_supplies update | 23505(inventory_supplies_code_uniq) · 23514(CHECK 7) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/loan-actions.ts:75` | inventory_loans insert | 23505(inventory_loans_code_uniq, inventory_loans_open_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(insErr | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/loan-actions.ts:82` | inventory_assets update | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(upErr | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/loan-actions.ts:152` | inventory_loans update | 23505(inventory_loans_code_uniq, inventory_loans_open_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(upLoanErr | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/loan-actions.ts:167` | inventory_assets update | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(upAssetErr | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/loan-actions.ts:236` | inventory_loans update | 23505(inventory_loans_code_uniq, inventory_loans_open_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/loan-actions.ts:245` | inventory_assets update | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(upErr | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/loan-actions.ts:299` | inventory_assets update | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/loan-actions.ts:350` | inventory_assets update | 23505(inventory_assets_code_uniq) · 23514(CHECK 9) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(upErr | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/loan-actions.ts:354` | inventory_loans delete | 42501(RLS)·기타 | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/prefs.ts:35` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/inventory/server/supply-actions.ts:93` | inventory_supplies update | 23505(inventory_supplies_code_uniq) · 23514(CHECK 7) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/supply-actions.ts:127` | inventory_supplies delete | 42501(RLS)·기타 | 상수·도우미 문구: friendlyInventoryError(error | 없음 | P2 | 고침(번역기 내부) |
| `features/inventory/server/supply-actions.ts:203` | inventory_supplies insert | 23505(inventory_supplies_code_uniq) · 23514(CHECK 7) · 23503(대상 없음) | 상수·도우미 문구: friendlyInventoryError(error ?? { | 없음 | P2 | 고침(번역기 내부) |
| `features/leave/server/actions.ts:227` | leave_adjustments insert | 23514(CHECK 4) · 23503(대상 없음) | 영문 원문 노출: TABLE_MISSING_MSG | 없음 | P2 | — |
| `features/leave/server/actions.ts:228` | leave_adjustments insert | 23514(CHECK 4) · 23503(대상 없음) | 상수·도우미 문구: TABLE_MISSING_MSG | 없음 | P2 | — |
| `features/leave/server/actions.ts:230` | leave_adjustments insert | 23514(CHECK 4) · 23503(대상 없음) | 상수·도우미 문구: USED_RANGE_MISSING_MSG | 없음 | P2 | — |
| `features/leave/server/actions.ts:232` | leave_adjustments insert | 23514(CHECK 4) · 23503(대상 없음) | 상수·도우미 문구: REASON_REQUIRED_MSG | 없음 | P2 | — |
| `features/leave/server/actions.ts:339` | leave_adjustments delete | 42501(RLS)·기타 | 영문 원문 노출: '삭제 실패 — ${error.message | 없음 | P2 | — |
| `features/meetings/server/actions.ts:59` | meeting_minutes update | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/meetings/server/actions.ts:94` | meeting_minutes update | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/meetings/server/actions.ts:141` | meeting_minutes update | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/meetings/server/actions.ts:201` | meeting_minutes update | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/meetings/server/actions.ts:294` | meeting_minutes insert | 23503(대상 없음) | 영문 원문 노출: '회의록 생성 실패: ${insertErr?.message ?? "unknown" | 없음 | P2 | — |
| `features/meetings/server/actions.ts:395` | meeting_minutes insert | 23503(대상 없음) | 영문 원문 노출: '회의록 생성 실패: ${error?.message ?? "unknown" | 없음 | P2 | — |
| `features/meetings/server/actions.ts:450` | meeting_minutes delete | 42501(RLS)·기타 | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/notices/server/actions.ts:95` | notice_popups insert | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/notices/server/actions.ts:205` | notice_popups update | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/notices/server/actions.ts:238` | notice_popups update | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/notices/server/actions.ts:273` | notice_popups delete | 42501(RLS)·기타 | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/notices/server/dismiss-actions.ts:44` | notice_dismissals upsert | 23503(대상 없음) | 일반 문구: "설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." | 없음 | P2 | 로그만 |
| `features/notices/server/dismiss-actions.ts:61` | notice_dismissals delete | 42501(RLS)·기타 | 일반 문구: "설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." | 없음 | P2 | 로그만 |
| `features/notices/server/translate.ts:104` | notice_popup_translations upsert | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/notices/server/translate.ts:149` | notice_popup_translations upsert | 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/notifications/server/events.ts:118` | notification_events upsert | 23505(notification_events_tenant_id_event_type_subject_key_bucket_key) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('recordNew ${eventType}: ${error.message}') | 없음 | P2 | — |
| `features/notifications/server/prune.ts:35` | notification_events delete | 42501(RLS)·기타 | throw(화면은 일반 오류): new Error(error.message) | 없음 | P2 | — |
| `features/notifications/server/prune.ts:51` | notifications delete | 42501(RLS)·기타 | throw(화면은 일반 오류): new Error(error.message) | 없음 | P2 | — |
| `features/onboarding/server/prefs.ts:32` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 일반 문구: "저장하지 못했습니다" | 없음 | P2 | 로그만 |
| `features/owner/server/scheduled-groups.ts:96` | tenant_settings update | 23503(대상 없음) · P0001(트리거) | 기타 반환: return { status: "error", reason: "학원 설정을 저장하지 못했습니다" }; | 없음 | P2 | — |
| `features/owner/server/subject-actions.ts:218` | ? update | 42501(RLS)·기타 | 코드별 일부 매핑: — | 없음 | P2 | 안쪽 자리에 로그 |
| `features/owner/server/subject-actions.ts:220` | ? update | 42501(RLS)·기타 | 일반 문구: "그 사이 같은 이름의 반이 생겨 흡수할 수 없습니다 — 반 이름을 바꾼 뒤 다시 시도해 주세요." | 없음 | P2 | 로그만 |
| `features/owner/server/subject-actions.ts:234` | rpc:absorb_subject_key rpc | P0001(RPC RAISE)·42501 | 영문 원문 노출: 'absorb_subject_key: ${error.message | 없음 | P2 | — |
| `features/payroll/server/actions.ts:89` | payroll_records upsert | 23505(payroll_tenant_user_period_idx) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/payroll/server/actions.ts:129` | payroll_records update | 23505(payroll_tenant_user_period_idx) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/payroll/server/actions.ts:182` | payroll_records upsert | 23505(payroll_tenant_user_period_idx) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/payroll/server/actions.ts:232` | staff_leaves insert | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/payroll/server/actions.ts:260` | staff_leaves update | 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/payroll/server/actions.ts:286` | staff_leaves delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/payroll/server/class-salary-actions.ts:79` | class_salary_settings upsert | 23514(CHECK 3) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/payroll/server/comp-actions.ts:110` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/payroll/server/payslip-actions.ts:127` | payslips upsert | 23505(payslips_tenant_id_user_id_period_key) · 23514(CHECK 6) · 23503(대상 없음) | 기타 반환: return reject('저장 실패: ${error.message}', formData); | 없음 | P2 | — |
| `features/payroll/server/payslip-actions.ts:192` | payslips upsert | 23505(payslips_tenant_id_user_id_period_key) · 23514(CHECK 6) · 23503(대상 없음) | 영문 원문 노출: '발행 실패: ${error.message | 없음 | P2 | — |
| `features/payroll/server/payslip-actions.ts:226` | payslips update | 23505(payslips_tenant_id_user_id_period_key) · 23514(CHECK 6) · 23503(대상 없음) | 영문 원문 노출: '발행 취소 실패: ${error.message | 없음 | P2 | — |
| `features/periods/server/actions.ts:127` | rpc:save_operating_periods rpc | P0001(RPC RAISE)·42501 | 상수·도우미 문구: humanize(error.code | 없음 | P2 | — |
| `features/periods/server/queries.ts:170` | operating_periods update | 23505(operating_periods_label_uq) · 23P01(operating_periods_no_overlap) · 23514(CHECK 4) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('세션 기간: ${error.message}') | 없음 | P2 | — |
| `features/progress/server/anomaly-actions.ts:51` | progress_events update | 23505(progress_events_report_type_key) · 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: updateError.message | 없음 | P2 | — |
| `features/progress/server/ingest.ts:284` | progress_containers insert | 23505(progress_containers_active_key, progress_containers_seq_key) · 23514(CHECK 2) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('openContainer 실패: ${error?.message ?? "no id"}') | 없음 | P2 | — |
| `features/progress/server/ingest.ts:308` | progress_containers update | 23505(progress_containers_active_key, progress_containers_seq_key) · 23514(CHECK 2) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('closeContainer 실패: ${error.message}') | 없음 | P2 | — |
| `features/progress/server/ingest.ts:337` | progress_entries insert | 23505(progress_entries_report_key) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('appendEntry(entry) 실패: ${entryErr.message}') | 없음 | P2 | — |
| `features/progress/server/ingest.ts:346` | progress_containers update | 23505(progress_containers_active_key, progress_containers_seq_key) · 23514(CHECK 2) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('appendEntry(update) 실패: ${updErr.message}') | 없음 | P2 | — |
| `features/progress/server/ingest.ts:381` | progress_events upsert | 23505(progress_events_report_type_key) · 23514(CHECK 1) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('logEvent(${e.eventType}) 실패: ${error.message}') | 없음 | P2 | — |
| `features/progress/server/rollback-actions.ts:78` | progress_events delete | 42501(RLS)·기타 | 기타: — | 있음 | P2 | — |
| `features/progress/server/rollback-actions.ts:87` | progress_entries delete | 42501(RLS)·기타 | 기타 반환: { // 못 지웠으면 컨테이너 수치도 건드리지 않는다(수치가 실물과 어긋나면 더 나쁘다). console.error("[progress-rollback] 엔트리  | 있음 | P2 | — |
| `features/progress/server/rollback-actions.ts:122` | progress_containers delete | 42501(RLS)·기타 | 기타: — | 있음 | P2 | — |
| `features/progress/server/rollback-actions.ts:135` | progress_containers update | 23505(progress_containers_active_key, progress_containers_seq_key) · 23514(CHECK 2) · 23503(대상 없음) | 기타: — | 있음 | P2 | — |
| `features/report-admin/server/actions.ts:162` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/actions.ts:338` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/actions.ts:431` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/actions.ts:448` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/actions.ts:696` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/board-roster-actions.ts:148` | classnote_student_links insert | 23505(classnote_student_links_child_uniq) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/board-roster-actions.ts:178` | classnote_student_links delete | 42501(RLS)·기타 | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/class-notice-actions.ts:68` | classnote_class_notices insert | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/classnote-sync-actions.ts:145` | classnote_sync_requests insert | 23505(classnote_sync_requests_active_uniq) · 23514(CHECK 1) · 23503(대상 없음) | 코드별 일부 매핑: — | 없음 | P2 | — |
| `features/report-admin/server/classnote-sync-actions.ts:146` | classnote_sync_requests insert | 23505(classnote_sync_requests_active_uniq) · 23514(CHECK 1) · 23503(대상 없음) | 기타 반환: { const again = await loadSyncRows(admin, g.tenantId).catch(() => null); if (again?.active | 없음 | P2 | — |
| `features/report-admin/server/classnote-sync-actions.ts:154` | classnote_sync_requests insert | 23505(classnote_sync_requests_active_uniq) · 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "사용할 수 없는 기능입니다" | 없음 | P2 | — |
| `features/report-admin/server/compose-actions.ts:214` | lesson_reports upsert | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | 영문 원문 노출: error?.message ?? "보고서 저장에 실패했습니다" | 없음 | P2 | — |
| `features/report-admin/server/compose-actions.ts:517` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/compose-actions.ts:836` | lesson_reports upsert | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/compose-actions.ts:884` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/notice-actions.ts:225` | classnote_notices insert | 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-admin/server/recall-actions.ts:156` | lesson_reports update | 23505(lesson_reports_share_token_key, lesson_reports_student_date_unit_key 외 1) · 23503(대상 없음) | humanizeDbError(문구 파싱): — | 없음 | P2 | — |
| `features/report-templates/server/actions.ts:102` | report_templates update | 23505(report_templates_owner_name_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 코드별 일부 매핑: — | 있음 | P2 | — |
| `features/report-templates/server/actions.ts:103` | report_templates update | 23505(report_templates_owner_name_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 상수·도우미 문구: NOT_READY | 없음 | P2 | — |
| `features/report-templates/server/actions.ts:104` | report_templates update | 23505(report_templates_owner_name_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: "같은 이름의 템플릿이 이미 있습니다. 이름을 바꿔 주세요." | 없음 | P2 | — |
| `features/report-templates/server/actions.ts:124` | report_templates delete | 42501(RLS)·기타 | 상수·도우미 문구: NOT_READY | 있음 | P2 | — |
| `features/report-templates/server/actions.ts:125` | report_templates delete | 42501(RLS)·기타 | 상수·도우미 문구: NOT_READY | 없음 | P2 | — |
| `features/retention/server/actions.ts:43` | student_consultations insert | 23505(ux_student_consultations_makeedu) · 23514(CHECK 1) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/retention/server/actions.ts:84` | reenrollment_campaign_targets insert | 23505(rct_tenant_student_uq) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/retention/server/actions.ts:110` | reenrollment_campaign_targets update | 23505(rct_tenant_student_uq) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/retention/server/actions.ts:135` | reenrollment_campaign_targets delete | 42501(RLS)·기타 | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/shuttle/server/actions.ts:96` | shuttle_stops insert | 23505(shuttle_stops_tenant_name_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:118` | shuttle_stops update | 23505(shuttle_stops_tenant_name_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:152` | shuttle_stops update | 23505(shuttle_stops_tenant_name_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:176` | shuttle_vehicles update | 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:227` | shuttle_runs insert | 23505(shuttle_runs_vehicle_season_no_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:234` | shuttle_run_stops insert | 23505(shuttle_run_stops_run_stop_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: "회차는 만들었지만 학원 출발/도착 칸을 넣지 못했습니다" | 없음 | P2 | 로그만 |
| `features/shuttle/server/actions.ts:256` | shuttle_runs update | 23505(shuttle_runs_vehicle_season_no_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:277` | shuttle_runs delete | 42501(RLS)·기타 | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:310` | shuttle_run_stops insert | 23505(shuttle_run_stops_run_stop_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 코드별 일부 매핑: — | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:311` | shuttle_run_stops insert | 23505(shuttle_run_stops_run_stop_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 일반 문구: "이 회차에 이미 있는 정류장입니다" | 없음 | P2 | — |
| `features/shuttle/server/actions.ts:342` | shuttle_run_stops update | 23505(shuttle_run_stops_run_stop_uniq) · 23514(CHECK 2) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:367` | shuttle_run_stops delete | 42501(RLS)·기타 | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:459` | shuttle_riders upsert | 23505(shuttle_riders_stop_student_io_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:481` | shuttle_riders update | 23505(shuttle_riders_stop_student_io_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:499` | shuttle_riders delete | 42501(RLS)·기타 | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:527` | shuttle_riders update | 23505(shuttle_riders_stop_student_io_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 코드별 일부 매핑: — | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:528` | shuttle_riders update | 23505(shuttle_riders_stop_student_io_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 일반 문구: "그 정류장에 이미 배정된 학생입니다" | 없음 | P2 | — |
| `features/shuttle/server/actions.ts:602` | shuttle_boardings upsert | 23505(shuttle_boardings_day_student_run_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:681` | shuttle_ride_exceptions upsert | 23505(shuttle_ride_exceptions_day_student_uniq) · 23514(CHECK 4) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:722` | shuttle_ride_exceptions delete | 42501(RLS)·기타 | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:746` | shuttle_boardings delete | 42501(RLS)·기타 | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:807` | shuttle_trips upsert | 23505(shuttle_trips_day_run_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:837` | shuttle_trips update | 23505(shuttle_trips_day_run_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:866` | shuttle_trips update | 23505(shuttle_trips_day_run_uniq) · 23514(CHECK 3) · 23503(대상 없음) | 상수·도우미 문구: friendly(error | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:940` | shuttle_stops update | 23505(shuttle_stops_tenant_name_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 코드별 일부 매핑: — | 없음 | P2 | 고침(번역기 내부) |
| `features/shuttle/server/actions.ts:942` | shuttle_stops update | 23505(shuttle_stops_tenant_name_uniq) · 23514(CHECK 6) · 23503(대상 없음) | 일반 문구: "정류장 좌표 기능이 아직 준비되지 않았습니다 (마이그레이션 0244a 필요)" | 없음 | P2 | — |
| `features/shuttle/server/today-prefs.ts:42` | users update | 23505(users_tenant_email_idx, users_tenant_notion_user_id_key) · 23514(CHECK 4) · 23503(대상 없음) · 42501·P0001(보호 트리거) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/slack/server/connection-actions.ts:109` | slack_outbox update | 23505(slack_outbox_dedupe_key_key) · 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "다시 보내지 못했습니다" | 없음 | P2 | 로그만 |
| `features/slack/server/expand.ts:162` | slack_outbox upsert | 23505(slack_outbox_dedupe_key_key) · 23514(CHECK 1) · 23503(대상 없음) | throw(화면은 일반 오류): new Error('slack outbox upsert: ${upErr.message}') | 없음 | P2 | — |
| `features/slack/server/link-actions.ts:80` | slack_user_links insert | 23505(slack_user_links_tenant_id_slack_user_id_key) · 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "연결하지 못했습니다 — 이미 다른 직원에 연결된 슬랙 계정이 있을 수 있습니다" | 없음 | P2 | 로그만 |
| `features/slack/server/link-actions.ts:90` | slack_user_links delete | 42501(RLS)·기타 | 일반 문구: "연결을 해제하지 못했습니다" | 없음 | P2 | 로그만 |
| `features/slack/server/reconcile.ts:63` | slack_inbox upsert | 23505(slack_inbox_tenant_id_source_source_id_key) · 23503(대상 없음) | 기타: — | 없음 | P2 | — |
| `features/slack/server/self-link-actions.ts:53` | slack_link_codes upsert | 23503(대상 없음) | 일반 문구: "코드를 만들지 못했습니다" | 없음 | P2 | 로그만 |
| `features/slack/server/self-link-actions.ts:94` | slack_user_links insert | 23505(slack_user_links_tenant_id_slack_user_id_key) · 23514(CHECK 1) · 23503(대상 없음) | 일반 문구: "연결하지 못했습니다" | 없음 | P2 | 로그만 |
| `features/slack/server/self-link-actions.ts:104` | slack_user_links delete | 42501(RLS)·기타 | 일반 문구: "연결을 해제하지 못했습니다" | 없음 | P2 | 로그만 |
| `features/slack/server/store.ts:82` | slack_connections upsert | 23503(대상 없음) | 기타 반환: return {}; | 없음 | P2 | — |
| `features/slack/server/store.ts:170` | slack_rules insert | 23514(CHECK 4) · 23503(대상 없음) | 상수·도우미 문구: isMissingTable(error) ? SLACK_TABLE_MISSING_MESSAGE : "규칙을 저장하지 못했습니다" | 없음 | P2 | — |
| `features/slack/server/store.ts:180` | slack_rules update | 23514(CHECK 4) · 23503(대상 없음) | 일반 문구: "규칙을 저장하지 못했습니다" | 없음 | P2 | 로그만 |
| `features/super-admin/server/actions.ts:66` | tenants insert | 23505(tenants_slug_unique) | 코드별 일부 매핑: — | 없음 | P2 | — |
| `features/super-admin/server/actions.ts:67` | tenants insert | 23505(tenants_slug_unique) | 기타 반환: { return { fieldErrors: { slug: "이미 사용 중인 slug 입니다" } }; } | 없음 | P2 | — |
| `features/super-admin/server/actions.ts:81` | tenant_settings insert | 23503(대상 없음) · P0001(트리거) | 영문 원문 노출: '학원 설정 생성 실패: ${settingsErr.message | 없음 | P2 | — |
| `features/super-admin/server/actions.ts:147` | tenants update | 23505(tenants_slug_unique) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/super-admin/server/actions.ts:347` | tenant_licenses upsert | 23505(tenant_licenses_tenant_feature_idx) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/super-admin/server/actions.ts:385` | tenant_licenses upsert | 23505(tenant_licenses_tenant_feature_idx) · 23503(대상 없음) | 영문 원문 노출: error.message | 없음 | P2 | — |
| `features/super-admin/server/protected-integrity.ts:70` | super_admin_audit_logs insert | 42501(RLS)·기타 | 기타: — | 있음 | P2 | — |
| `features/support/server/actions.ts:44` | support_requests insert | 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: SUPPORT_NOT_READY | 없음 | P2 | — |
| `features/support/server/actions.ts:45` | support_requests insert | 23514(CHECK 6) · 23503(대상 없음) | 상수·도우미 문구: SUPPORT_NOT_READY | 없음 | P2 | — |
| `features/support/server/actions.ts:102` | support_requests update | 23514(CHECK 6) · 23503(대상 없음) | 일반 문구: "수정하지 못했습니다" | 없음 | P2 | 로그만 |
| `features/support/server/admin-actions.ts:51` | support_requests update | 23514(CHECK 6) · 23503(대상 없음) | 일반 문구: "저장하지 못했습니다" | 없음 | P2 | 로그만 |
| `features/support/server/admin-actions.ts:95` | support_notices update | 23514(CHECK 2) | 상수·도우미 문구: SUPPORT_NOT_READY | 없음 | P2 | — |
| `features/support/server/admin-actions.ts:96` | support_notices update | 23514(CHECK 2) | 상수·도우미 문구: SUPPORT_NOT_READY | 없음 | P2 | — |
| `features/support/server/admin-actions.ts:117` | support_notices delete | 42501(RLS)·기타 | 상수·도우미 문구: isMissingSupportTables(error) ? SUPPORT_NOT_READY : "삭제하지 못했습니다" | 없음 | P2 | — |
| `features/timetable-dev/server/actions.ts:101` | ? delete | 42501(RLS)·기타 | throw(화면은 일반 오류): new Error(error.message) | 없음 | P2 | — |
| `features/timetable-dev/server/actions.ts:427` | ? upsert | 42501(RLS)·기타 | throw(화면은 일반 오류): new Error(error.message) | 없음 | P2 | — |
| `features/timetable-dev/server/actions.ts:466` | ? delete | 42501(RLS)·기타 | throw(화면은 일반 오류): new Error(error.message) | 없음 | P2 | — |
| `features/timetable-dev/server/sheet-import-actions.ts:463` | ? delete | 42501(RLS)·기타 | throw(화면은 일반 오류): new Error(error.message) | 없음 | P2 | — |
| `features/usage/server/record.ts:25` | rpc:record_page_usage rpc | P0001(RPC RAISE)·42501 | 기타: — | 있음 | P2 | — |
| `app/api/cron/apply-due-class-updates/route.ts:155` | audit_logs insert | 23503(대상 없음) | 기타: — | 있음 | P3 | — |
| `app/api/cron/apply-due-class-updates/route.ts:164` | classes update | 23505(classes_makeup_pool_per_teacher_uq, classes_tenant_name_subject_idx 외 1) · 23514(CHECK 2) · 23503(대상 없음) | 기타: — | 있음 | P3 | — |
| `app/api/cron/apply-due-class-updates/route.ts:191` | audit_logs insert | 23503(대상 없음) | 기타: — | 있음 | P3 | — |
| `app/api/cron/apply-due-withdrawals/route.ts:75` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | throw(화면은 일반 오류): uErr | 없음 | P3 | — |
| `app/api/cron/apply-due-withdrawals/route.ts:87` | students update | 23505(students_tenant_edutrix_student_id_key, students_tenant_ijw_student_id_uniq 외 3) · 23503(대상 없음) | 기타: — | 있음 | P3 | — |
| `app/api/cron/close-ended-class-periods/route.ts:33` | rpc:close_ended_class_period_enrollments rpc | P0001(RPC RAISE)·42501 | 일반 문구: "운영 기간 종료 처리에 실패했습니다" | 있음 | P3 | — |
| `app/api/cron/close-ended-class-periods/route.ts:34` | rpc:close_ended_class_period_enrollments rpc | P0001(RPC RAISE)·42501 | 기타 반환: return NextResponse.json({ ok: true, skipped: "0274a 미적용" }); | 없음 | P3 | — |
| `app/api/cron/reconcile-transcriptions/route.ts:62` | ? update | 42501(RLS)·기타 | 기타: — | 있음 | P3 | — |
| `app/api/cron/recordings-retention/route.ts:72` | ? update | 42501(RLS)·기타 | 기타: — | 있음 | P3 | — |
| `app/api/cron/sheets-sync/route.ts:165` | user_integrations update | 23505(user_integrations_tenant_provider_idx) · 23503(대상 없음) | 기타: — | 있음 | P3 | — |
| `app/api/push/route.ts:109` | push_subscriptions update | 23505(push_subscriptions_endpoint_idx) · 23503(대상 없음) | 기타 반환: return NextResponse.json({ ok: false, reason: "save_failed" }, { status: 200 }); | 없음 | P3 | — |
| `app/api/push/route.ts:128` | push_subscriptions upsert | 23505(push_subscriptions_endpoint_idx) · 23503(대상 없음) | 기타 반환: return NextResponse.json({ ok: false, reason: "save_failed" }, { status: 200 }); | 없음 | P3 | — |
| `features/attendance/intake/server/notify.ts:67` | notification_events upsert | 23505(notification_events_tenant_id_event_type_subject_key_bucket_key) · 23503(대상 없음) | throw(화면은 일반 오류): dedupError | 없음 | P3 | — |
| `features/attendance/live/server/absent-notify.ts:72` | notification_events upsert | 23505(notification_events_tenant_id_event_type_subject_key_bucket_key) · 23503(대상 없음) | throw(화면은 일반 오류): dedupError | 없음 | P3 | — |
| `features/attendance/live/server/cross-notify.ts:95` | notification_events upsert | 23505(notification_events_tenant_id_event_type_subject_key_bucket_key) · 23503(대상 없음) | throw(화면은 일반 오류): dedupError | 없음 | P3 | — |
| `features/attendance/parent-alerts/server/classify.ts:138` | classnote_parent_messages update | 23505(classnote_parent_messages_src_idx) · 23503(대상 없음) | 기타: — | 없음 | P3 | — |
| `features/attendance/parent-alerts/server/classify.ts:264` | notifications insert | 23503(대상 없음) | 기타 반환: return 0; | 없음 | P3 | — |
| `features/attendance/recap/server/ai.ts:41` | attendance_day_recaps update | 23505(attendance_day_recaps_tenant_id_from_date_recap_date_key) · 23514(CHECK 1) · 23503(대상 없음) | 기타: — | 있음 | P3 | — |
| `features/attendance/server/complete-notify.ts:120` | notification_events upsert | 23505(notification_events_tenant_id_event_type_subject_key_bucket_key) · 23503(대상 없음) | throw(화면은 일반 오류): dedupError | 없음 | P3 | — |
| `features/billing/session-terms/server/term-materialize.ts:265` | invoice_session_terms upsert | 23505(invoice_session_terms_tenant_id_invoice_id_class_id_key) · 23514(CHECK 4) · 23503(대상 없음) · P0001(트리거) | 기타 반환: { for (const t of creatable) if (!result.ids.has(t.virtualId)) result.failed.set(t.virtual | 없음 | P3 | — |
| `features/notifications/server/failed-notify-sweep.ts:135` | notifications insert | 23503(대상 없음) | throw(화면은 일반 오류): new Error('알림 생성: ${insErr.message}') | 없음 | P3 | — |
| `features/notifications/server/notify.ts:37` | notifications insert | 23503(대상 없음) | 기타: — | 있음 | P3 | — |

## 조회 실패 자리 — 파일별 요약(454)

| 파일 | 자리 수 | 수정 전 모양 | 로그 없던 곳 | 이번 조치 |
|---|---|---|---|---|
| `features/attendance/server/makeup-pool.ts` | 11 | 기타 반환 11 | 5 | — 11 |
| `features/staff/server/actions.ts` | 9 | 영문 원문 노출 3, 일반 문구 3, 기타 반환 1, 기타 1, humanizeDbError(문구 파싱) 1 | 9 | — 6, 로그만 2, 고침(이유+로그) 1 |
| `features/help/board/server/actions.ts` | 8 | 상수·도우미 문구 8 | 8 | — 8 |
| `features/shuttle/server/queries.ts` | 8 | 기타 반환 8 | 4 | — 8 |
| `features/super-admin/server/actions.ts` | 8 | 영문 원문 노출 4, 일반 문구 4 | 8 | — 5, 로그만 3 |
| `features/shuttle/server/actions.ts` | 7 | 일반 문구 7 | 7 | 로그만 7 |
| `features/dashboard/server/queries.ts` | 6 | throw(화면은 일반 오류) 6 | 6 | — 6 |
| `features/ijw/server/report-snapshot.ts` | 6 | 기타 반환 4, 기타 2 | 2 | — 6 |
| `features/notifications/server/events.ts` | 6 | throw(화면은 일반 오류) 6 | 6 | — 6 |
| `features/staff/server/account-actions.ts` | 6 | 일반 문구 2, 영문 원문 노출 3, 상수·도우미 문구 1 | 6 | 로그만 1, — 5 |
| `features/students/server/queries.ts` | 6 | 기타 반환 1, throw(화면은 일반 오류) 5 | 6 | — 6 |
| `features/class-sheets/server/carry-marks.ts` | 5 | throw(화면은 일반 오류) 1, 기타 반환 4 | 5 | — 5 |
| `features/class-sheets/server/edit-audit-actions.ts` | 5 | 기타 반환 5 | 5 | — 5 |
| `features/newcomers/server/consult-link.ts` | 5 | 기타 반환 4, throw(화면은 일반 오류) 1 | 5 | — 5 |
| `features/shuttle/server/duty.ts` | 5 | 기타 반환 4, 기타 1 | 2 | — 5 |
| `app/api/exports/consultations/route.ts` | 4 | throw(화면은 일반 오류) 1, 일반 문구 1, 영문 원문 노출 2 | 4 | — 4 |
| `features/attendance/live/server/queries.ts` | 4 | 기타 2, 기타 반환 2 | 2 | — 4 |
| `features/attendance/server/makeup-reservation-complete.ts` | 4 | 기타 반환 2, 기타 2 | 2 | — 4 |
| `features/attendance/server/makeup-reservation-queries.ts` | 4 | 기타 반환 4 | 4 | — 4 |
| `features/billing/session-terms/server/actions.ts` | 4 | 영문 원문 노출 4 | 4 | — 4 |
| `features/billing/session-terms/server/receipt-allocation-actions.ts` | 4 | 영문 원문 노출 1, 기타 반환 1, 일반 문구 2 | 4 | — 2, 로그만 2 |
| `features/calendar/server/queries.ts` | 4 | 기타 반환 3, 기타 1 | 2 | — 4 |
| `features/calendar/server/sync-state.ts` | 4 | 기타 반환 4 | 4 | — 4 |
| `features/classnote-reply/server/reply-data.ts` | 4 | throw(화면은 일반 오류) 3, 기타 반환 1 | 4 | — 4 |
| `features/class-sheets/server/actions.ts` | 4 | 영문 원문 노출 4 | 4 | — 4 |
| `features/enrollments/server/actions.ts` | 4 | 일반 문구 1, 기타 반환 2, 상수·도우미 문구 1 | 2 | 로그만 1, — 2, 고침(이유+로그) 1 |
| `features/grades/unified/server/actions.ts` | 4 | 일반 문구 4 | 4 | 로그만 3, 고침(이유+로그) 1 |
| `features/inventory/server/loan-actions.ts` | 4 | 상수·도우미 문구 4 | 4 | 고침(번역기 내부) 4 |
| `features/leave/server/admin.ts` | 4 | throw(화면은 일반 오류) 2, 기타 반환 2 | 4 | — 4 |
| `features/onescreen/server/actions.ts` | 4 | 기타 반환 1, 일반 문구 2, 영문 원문 노출 1 | 4 | — 2, 로그만 2 |
| `features/onescreen/server/ment-style-db.ts` | 4 | 기타 반환 2, 기타 1, 영문 원문 노출 1 | 2 | — 4 |
| `features/staff/server/contract-actions.ts` | 4 | humanizeDbError(문구 파싱) 4 | 4 | — 4 |
| `features/staff/server/queries.ts` | 4 | 기타 반환 3, 기타 1 | 2 | — 4 |
| `features/textbooks/server/plan-actions.ts` | 4 | 상수·도우미 문구 3, 기타 1 | 4 | 고침(번역기 내부) 2, — 2 |
| `features/admin/server/actions.ts` | 3 | 영문 원문 노출 3 | 3 | — 3 |
| `features/approvals/server/queries.ts` | 3 | 기타 반환 3 | 3 | — 3 |
| `features/attendance/kiosk/server/queries.ts` | 3 | throw(화면은 일반 오류) 3 | 3 | — 3 |
| `features/attendance/seat/server/actions.ts` | 3 | 일반 문구 1, 영문 원문 노출 2 | 3 | 로그만 1, — 2 |
| `features/consultations/server/actions.ts` | 3 | 일반 문구 3 | 3 | — 1, 로그만 2 |
| `features/documents/server/file-actions.ts` | 3 | 일반 문구 3 | 3 | 로그만 3 |
| `features/grades/unified/server/create-action.ts` | 3 | 일반 문구 3 | 3 | 로그만 3 |
| `features/help/board/server/queries.ts` | 3 | 상수·도우미 문구 1, 기타 반환 1, 기타 1 | 1 | — 3 |
| `features/integrations/server/actions.ts` | 3 | 기타 반환 1, 영문 원문 노출 2 | 3 | — 3 |
| `features/inventory/server/audit-actions.ts` | 3 | 상수·도우미 문구 3 | 3 | 고침(번역기 내부) 3 |
| `features/math-sheets/server/actions.ts` | 3 | 영문 원문 노출 3 | 3 | — 3 |
| `features/onescreen/server/ment-style-build.ts` | 3 | throw(화면은 일반 오류) 1, 기타 반환 2 | 3 | — 3 |
| `features/staff/server/resume-queries.ts` | 3 | throw(화면은 일반 오류) 3 | 3 | — 3 |
| `features/students/server/actions.ts` | 3 | 영문 원문 노출 2, 기타 반환 1 | 3 | 고침(이유+로그) 2, — 1 |
| `features/students/server/enrollment-sync.ts` | 3 | 영문 원문 노출 3 | 3 | 고침(이유+로그) 3 |
| `features/super-admin/server/protected-integrity.ts` | 3 | throw(화면은 일반 오류) 1, 기타 반환 2 | 3 | — 3 |
| `features/super-admin/server/queries.ts` | 3 | throw(화면은 일반 오류) 3 | 3 | — 3 |
| `app/api/cron/google-calendar-import/route.ts` | 2 | 일반 문구 2 | 0 | — 2 |
| `app/api/cron/recordings-retention/route.ts` | 2 | 기타 2 | 0 | — 2 |
| `features/attendance/kiosk/server/checkin.ts` | 2 | 기타 반환 2 | 2 | — 2 |
| `features/attendance/live/server/cross-notify.ts` | 2 | 기타 반환 2 | 2 | — 2 |
| `features/attendance/recap/server/queries.ts` | 2 | throw(화면은 일반 오류) 1, 기타 반환 1 | 1 | — 2 |
| `features/attendance/seat/server/mark-actions.ts` | 2 | 일반 문구 1, 기타 반환 1 | 2 | 로그만 1, — 1 |
| `features/attendance/server/makeup-anchor-cells.ts` | 2 | throw(화면은 일반 오류) 1, 기타 반환 1 | 2 | — 2 |
| `features/attendance/server/makeup-reservation-actions.ts` | 2 | throw(화면은 일반 오류) 1, 기타 반환 1 | 2 | — 2 |
| `features/attendance/server/salary-rates.ts` | 2 | 기타 반환 1, throw(화면은 일반 오류) 1 | 2 | — 2 |
| `features/attendance/server/taught-by-db.ts` | 2 | 기타 반환 1, 기타 1 | 1 | — 2 |
| `features/billing/server/expense-actions.ts` | 2 | 영문 원문 노출 2 | 2 | — 2 |
| `features/billing/server/manual-invoice-actions.ts` | 2 | humanizeDbError(문구 파싱) 1, 일반 문구 1 | 2 | — 1, 로그만 1 |
| `features/billing/session-terms/server/delete-actions.ts` | 2 | 일반 문구 2 | 2 | 로그만 2 |
| `features/classes/server/list-prefs.ts` | 2 | 영문 원문 노출 1, 기타 반환 1 | 2 | — 2 |
| `features/class-review/server/actions.ts` | 2 | 영문 원문 노출 1, humanizeDbError(문구 파싱) 1 | 2 | — 2 |
| `features/class-sheets/server/plan-write.ts` | 2 | 영문 원문 노출 1, 일반 문구 1 | 2 | — 2 |
| `features/consultations/server/class-support.ts` | 2 | 기타 반환 1, 기타 1 | 2 | — 2 |
| `features/enrollment/server/actions.ts` | 2 | 기타 반환 1, 일반 문구 1 | 2 | — 1, 로그만 1 |
| `features/enrollment/server/queries.ts` | 2 | throw(화면은 일반 오류) 1, 기타 반환 1 | 2 | — 2 |
| `features/enrollments/server/lab-separate.ts` | 2 | 기타 반환 2 | 2 | — 2 |
| `features/enrollments/server/lab-separate-actions.ts` | 2 | 상수·도우미 문구 2 | 2 | 고침(이유+로그) 2 |
| `features/enrollments/server/movable-actions.ts` | 2 | 일반 문구 2 | 2 | 로그만 2 |
| `features/enrollments/server/scheduled-queries.ts` | 2 | 기타 반환 2 | 0 | — 2 |
| `features/grades/server/goals.ts` | 2 | 기타 반환 2 | 2 | — 2 |
| `features/grades/server/list-prefs.ts` | 2 | 영문 원문 노출 1, 기타 반환 1 | 2 | — 2 |
| `features/ijw/server/link-actions.ts` | 2 | 상수·도우미 문구 2 | 1 | — 2 |
| `features/ijw/server/links.ts` | 2 | 기타 반환 1, throw(화면은 일반 오류) 1 | 2 | — 2 |
| `features/ijw/server/queries.ts` | 2 | 기타 반환 2 | 2 | — 2 |
| `features/inventory/server/category-queries.ts` | 2 | 기타 반환 2 | 0 | — 2 |
| `features/inventory/server/supply-actions.ts` | 2 | 상수·도우미 문구 2 | 2 | 고침(번역기 내부) 2 |
| `features/leave/server/actions.ts` | 2 | 영문 원문 노출 2 | 2 | — 2 |
| `features/math-sheets/server/goal-audit-actions.ts` | 2 | 기타 반환 2 | 2 | — 2 |
| `features/math-sheets/server/learning-actions.ts` | 2 | 일반 문구 1, 코드별 일부 매핑 1 | 2 | — 2 |
| `features/notices/server/queries.ts` | 2 | 기타 반환 2 | 2 | — 2 |
| `features/onescreen/server/makeup-remove-actions.ts` | 2 | humanizeDbError(문구 파싱) 1, 일반 문구 1 | 2 | — 1, 로그만 1 |
| `features/onescreen/server/ment-source-db.ts` | 2 | 기타 반환 1, 기타 1 | 1 | — 2 |
| `features/onescreen/server/report-author-name.ts` | 2 | 기타 반환 2 | 2 | — 2 |
| `features/onescreen/server/send-class.ts` | 2 | throw(화면은 일반 오류) 2 | 2 | — 2 |
| `features/owner/server/actions.ts` | 2 | 일반 문구 2 | 1 | — 1, 로그만 1 |
| `features/owner/server/subject-actions.ts` | 2 | throw(화면은 일반 오류) 2 | 2 | — 2 |
| `features/payroll/server/queries.ts` | 2 | throw(화면은 일반 오류) 2 | 2 | — 2 |
| `features/periods/server/queries.ts` | 2 | 기타 반환 2 | 0 | — 2 |
| `features/report-admin/server/actions.ts` | 2 | humanizeDbError(문구 파싱) 2 | 2 | — 2 |
| `features/report-admin/server/notice-actions.ts` | 2 | humanizeDbError(문구 파싱) 2 | 2 | — 2 |
| `features/report-templates/server/actions.ts` | 2 | 기타 반환 2 | 1 | — 2 |
| `features/slack/server/store.ts` | 2 | 기타 반환 2 | 2 | — 2 |
| `features/staff/server/contract-file-actions.ts` | 2 | humanizeDbError(문구 파싱) 2 | 2 | — 2 |
| `features/staff/server/contract-queries.ts` | 2 | throw(화면은 일반 오류) 2 | 2 | — 2 |
| `features/staff/server/list-prefs.ts` | 2 | 영문 원문 노출 1, 기타 반환 1 | 2 | — 2 |
| `features/staff/server/resume-actions.ts` | 2 | humanizeDbError(문구 파싱) 1, 기타 반환 1 | 2 | — 2 |
| `features/students/server/list-prefs.ts` | 2 | 영문 원문 노출 1, 기타 반환 1 | 2 | — 2 |
| `features/support/server/actions.ts` | 2 | 상수·도우미 문구 2 | 2 | — 2 |
| `features/support/server/admin-queries.ts` | 2 | 기타 반환 2 | 2 | — 2 |
| `features/support/server/queries.ts` | 2 | 기타 반환 2 | 2 | — 2 |
| `features/textbooks/server/actions.ts` | 2 | 상수·도우미 문구 2 | 2 | 고침(번역기 내부) 2 |
| `features/textbooks/server/queries.ts` | 2 | throw(화면은 일반 오류) 1, 기타 1 | 2 | — 2 |
| `features/timetable/server/queries.ts` | 2 | throw(화면은 일반 오류) 2 | 2 | — 2 |
| `features/timetable/server/scheduled-import-actions.ts` | 2 | 일반 문구 1, 상수·도우미 문구 1 | 1 | 로그만 1, — 1 |
| `features/video-homework/server/assignments.ts` | 2 | 기타 반환 1, 기타 1 | 1 | — 2 |
| `app/api/cron/apply-due-class-updates/route.ts` | 1 | 일반 문구 1 | 0 | — 1 |
| `app/api/cron/apply-due-withdrawals/route.ts` | 1 | 일반 문구 1 | 0 | — 1 |
| `app/api/cron/ment-style-rebuild/route.ts` | 1 | 영문 원문 노출 1 | 0 | — 1 |
| `app/api/cron/notification-maintenance/route.ts` | 1 | 영문 원문 노출 1 | 0 | — 1 |
| `app/api/cron/sheets-sync/route.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `app/api/push/route.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/approvals/server/actions.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/attendance/intake/server/actions.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/attendance/kiosk/server/actions.ts` | 1 | 상수·도우미 문구 1 | 1 | 고침(번역기 내부) 1 |
| `features/attendance/live/server/absent-notify.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/attendance/live/server/desk-optin.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/attendance/live/server/prefs-actions.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/attendance/live/server/write-policy.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/attendance/parent-alerts/server/classify.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/attendance/recap/server/actions.ts` | 1 | 일반 문구 1 | 0 | — 1 |
| `features/attendance/recap/server/poll-actions.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/attendance/seat/server/duty.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/attendance/seat/server/monthly-prefs.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/attendance/seat/server/placements.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/attendance/server/absence-cell.ts` | 1 | 영문 원문 노출 1 | 0 | — 1 |
| `features/attendance/server/actions.ts` | 1 | 영문 원문 노출 1 | 1 | 고침(이유+로그) 1 |
| `features/attendance/server/class-billing.ts` | 1 | 기타 반환 1 | 0 | — 1 |
| `features/attendance/server/complete-notify.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/attendance/server/makeup-options.ts` | 1 | 기타 1 | 0 | — 1 |
| `features/attendance/server/prefs-actions.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/attendance/server/queries.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/attendance/server/salary-rates-actions.ts` | 1 | 일반 문구 1 | 1 | — 1 |
| `features/billing/server/expense-queries.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/billing/server/textbook-queries.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/billing/server/tuition-catalog-queries.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/billing/server/tuition-quote-queries.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/billing/session-terms/server/money-carryover-actions.ts` | 1 | 일반 문구 1 | 0 | — 1 |
| `features/billing/session-terms/server/note-actions.ts` | 1 | 일반 문구 1 | 1 | 로그만 1 |
| `features/calendar/server/actions.ts` | 1 | 일반 문구 1 | 1 | 로그만 1 |
| `features/calendar/server/google-incremental.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/classes/server/class-scope.ts` | 1 | 일반 문구 1 | 1 | — 1 |
| `features/classes/server/handover.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/classnote-reply/server/reaction-data.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/classnote-reply/server/reply-eligibility.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/classnote-reply/server/reply-queries.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/class-review/server/final-review-actions.ts` | 1 | humanizeDbError(문구 파싱) 1 | 1 | — 1 |
| `features/class-sheets/server/day-plan.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/class-sheets/server/plan-edit-audit.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/connected-apps/server/visible.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/consultations/server/stats-prefs.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/dashboard/server/actions.ts` | 1 | 일반 문구 1 | 0 | — 1 |
| `features/dashboard/server/briefing.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/dashboard/server/makeup-upcoming.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/documents/server/actions.ts` | 1 | 일반 문구 1 | 1 | 로그만 1 |
| `features/documents/server/favorite-queries.ts` | 1 | 기타 반환 1 | 0 | — 1 |
| `features/documents/server/queries.ts` | 1 | 기타 반환 1 | 0 | — 1 |
| `features/enrollment/server/poll-actions.ts` | 1 | 기타 반환 1 | 0 | — 1 |
| `features/enrollment/server/school-prefs-actions.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/enrollments/server/scheduled-actions.ts` | 1 | 일반 문구 1 | 1 | 로그만 1 |
| `features/grades/server/queries.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/grades/server/write.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/grades/unified/server/consultation.ts` | 1 | 영문 원문 노출 1 | 1 | 고침(이유+로그) 1 |
| `features/grades/unified/server/roster-action.ts` | 1 | 일반 문구 1 | 1 | 로그만 1 |
| `features/help/board/server/notify.ts` | 1 | 기타 반환 1 | 0 | — 1 |
| `features/inventory/server/asset-actions.ts` | 1 | 상수·도우미 문구 1 | 1 | 고침(번역기 내부) 1 |
| `features/inventory/server/asset-queries.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/inventory/server/prefs.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/math-sheets/server/learning-track.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/notices/server/actions.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/notifications/server/failed-notify-sweep.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/onboarding/server/prefs.ts` | 1 | 일반 문구 1 | 1 | 로그만 1 |
| `features/onescreen/server/absence-gate.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/onescreen/server/makeup-anchor-sync.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/onescreen/server/makeup-class-actions.ts` | 1 | 일반 문구 1 | 1 | 로그만 1 |
| `features/onescreen/server/notice-actions.ts` | 1 | humanizeDbError(문구 파싱) 1 | 1 | — 1 |
| `features/owner/server/public-branding.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/owner/server/queries.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/owner/server/scheduled-groups.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/payroll/server/class-salary-actions.ts` | 1 | humanizeDbError(문구 파싱) 1 | 1 | — 1 |
| `features/progress/server/anomaly-actions.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/progress/server/backfill-actions.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/progress/server/ingest.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/progress/server/rollback-actions.ts` | 1 | 기타 반환 1 | 0 | — 1 |
| `features/report-admin/server/classnote-sync-core.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/report-admin/server/recall-actions.ts` | 1 | humanizeDbError(문구 파싱) 1 | 1 | — 1 |
| `features/report-admin/server/resolve-class.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/shuttle/server/today-prefs.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/slack/server/actor-col.ts` | 1 | 기타 1 | 1 | — 1 |
| `features/slack/server/deliver.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/slack/server/dispatch.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/slack/server/expand.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/slack/server/reconcile.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/staff/server/auth-ban.ts` | 1 | 기타 1 | 0 | — 1 |
| `features/staff/server/contract-extract-actions.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/staff/server/login-email-taken.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/staff/server/me-actions.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/staff/server/notion.ts` | 1 | 일반 문구 1 | 1 | 로그만 1 |
| `features/staff/server/public-intake-actions.ts` | 1 | 일반 문구 1 | 1 | 로그만 1 |
| `features/staff/server/resume-roster-sheet.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/students/server/homework-videos.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/students/server/read-scope.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/support/server/admin-actions.ts` | 1 | 상수·도우미 문구 1 | 1 | — 1 |
| `features/textbooks/server/cover-actions.ts` | 1 | 상수·도우미 문구 1 | 1 | 고침(번역기 내부) 1 |
| `features/timetable/server/end-scope.ts` | 1 | 기타 반환 1 | 0 | — 1 |
| `features/timetable/server/scheduled-class-change.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/timetable/server/scheduled-groups-queries.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/timetable/server/scheduled-import-queries.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/timetable/server/student-busy.ts` | 1 | 기타 반환 1 | 1 | — 1 |
| `features/timetable/server/view-prefs-actions.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/timetable-dev/server/actions.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/timetable-dev/server/queries.ts` | 1 | throw(화면은 일반 오류) 1 | 1 | — 1 |
| `features/video-homework/server/actions.ts` | 1 | 영문 원문 노출 1 | 1 | — 1 |
| `features/withdrawals/server/trend-prefs.ts` | 1 | 기타 반환 1 | 1 | — 1 |
