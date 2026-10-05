# 보강 소비처 목록 (2026-10-05 계약 마무리)

앱이 보강을 읽거나 쓰는 자리와, 돈 함수를 그대로 둔 근거다. SQL 적용·운영 DB 증명은 이 목록의 범위가 아니다.

## 권한 — 저장을 허용하는 쪽은 SQL

`makeup_private.actor()` (0344a) 가 저장의 권한이다.

- `wide` = 메뉴 접근이 `full`. 역할 이름과 무관하다.
- `privileged` = `wide` 이면서 역할이 원장·관리자이거나 플랫폼 보호 계정.
- `can_configure` = 원장 또는 플랫폼 보호 계정.
- `require_level` 은 읽기 전용 쓰기를 막고, `wide`/`privileged` 가 아니면 그 수준을 거절한다.

화면 게이트 `decideMakeupAction` (`src/features/makeups/permissions.ts`) 은 그보다 좁다. 매니저이고 접근이 `full` 이면 대사(`reconcile`)와 운영 처리(`resolve_reconciliation`)만 연다. 같은 접근을 가진 강사는 열지 않는다. 승인·검증은 원장·관리자만. 수기 시수 인정(`manualUnitsAcceptance`)도 원장·관리자와 `full` 만. 실시한 사람의 자기검토(`verify`, `resolve_reconciliation`)는 계정 종류와 상관없이 거절한다.

SQL `cmd_reconcile` (0349e) 는 `wide`와 사유를 필수로 검사한다. 앱 파서(`schemas.ts`)도 사유를 필수로 두고 개정 번호는 요구하지 않는다(`REVISION_REQUIRED` 에 `reconcile` 없음). `executeMakeupCommand`는 신선한 로그인·메뉴·운영 모드를 확인하고 사용자 세션 `makeup_command`로 넘긴다. SQL이 관계와 권한을 다시 검증한다.

SQL `cmd_resolve` (0346k) 는 시수·출결·근거·수납·원수업 충돌·수량(`units_mismatch`, `units_review`, `attendance_observed`, `evidence_removed`, `billing_review`, `quantity_drift`, `source_conflict`)을 `privileged` 로 두고, 그 밖은 `wide` 다. 차이가 남아 있으면 `accept_manual_units: true` 와 사유만 닫는다. 시수·출결 값은 거기서 고치지 않는다. 검증은 실시 강사(`actual_teacher_id`)의 자기검토를 거절한다(0346f).

0348g 읽기 권한과 화면은 `permissions.accept_manual_units`를 사용한다. 해결 명령의 본문 키도 `accept_manual_units`다. 권한 이름을 일치시켰으며, 실제 승인에는 SQL의 권한·근거 검증이 필요하다.

## 쓰기

| 경로 | 하는 일 | 돈 |
|---|---|---|
| `executeMakeupCommand` | 사용자 세션 `makeup_command`. 접수·예약·참여·승인·검증·대사·해결 포함 | 청구 함수를 호출하지 않음 |
| `settings.ts` `makeup_command` | 운영 모드 설정 명령 | 같은 명령 문. 이번 편집 아님 |
| `sendParticipation` | 참여 명령. 명령 id는 effect·정렬한 본문·현재 로그인 주체의 해시. 주체 없으면 거절 | 시수 컬럼을 쓰지 않음 |
| `noteEffectGap` | `makeup_note_effect_gap`. `queued:true`·`id`·같은 `effect_key`·`kind` 일 때만 대기열에 넣은 것으로 본다 | 시수 컬럼을 쓰지 않음 |
| `retryParticipationEffect` | 먼저 `makeup_projection_evidence`. `state=done` 이고 `verification.ok` 이고 출결 id·시수 칸·담당 칸·실시 강사가 있을 때만 완료. 아니면 참여를 한 번 더 보내고 다시 읽는다 | 시수 컬럼을 쓰지 않음 |
| `handleMappedFulfill` / `handleMappedAbsence` | 연결 예약. 정규일이면 참여를 보내지 않는다. 완료(`projection_state=done` 이고 `verification.ok`)면 실패 기록을 덮지 않는다. 대기·실패·명령 거절은 `participation_pending` / `participation_failed` 로 남긴다 | 시수 쓰기는 아래 한 함수 |
| `completeMakeupReservations` | 옛 예약 이행 훅. 연결분은 위 함수로 가고, 없는 연결만 옛 `fulfil` | 옛 경로는 기존 시수 식 |

연결 예약의 시수 쓰기는 `planMappedAttendanceUnits` → 출결 `session_units` 한 칸이다. 수기 값이 있으면 덮지 않는다. 같은 담당의 정규+보강은 그 칸에 한 번만 더한다. 시간표 담당과 그날 모든 현재 유효 시수 상태 출결의 실제 담당이 보강 담당과 일치해야 합산한다. 유효한 교시 담당이 있으면 반 담임 대신 사용한다. 혼합·미확인 담당 또는 시간표·설정 조회 실패는 시수 쓰기 전에 보류한다. 일반 출결 저장은 되돌리지 않는다. `unitsFromMinutes`, `session-units.ts` 반올림, `reservationAutoUnits` 식은 바꾸지 않았다.

당일 정규 시간표가 없다고 확인한 휴강·폐강·비활성 반은 보강 분량만 쓴다. 확인하지 못한 상태와 구분한다.
등록 조회 실패·출결 페이지 실패·정규 수업 길이 페이지 실패는 연결 시수 기록 전에 보류한다.
하루 출결과 연결 경로의 수업 길이는 `fetchAllPaged`와 id 정렬로 모두 읽는다. 현재 유효 교시는 전 페이지를 모은 뒤 고른다.
실제 담당이 보강 담당과 다르면 정규 수강일이 아닌 날에도 시수를 쓰지 않는다.
연결 계산은 당일 시간표를 확인할 때 엄격히 읽은 설정을 `lessonProfileOf`로 해석해 사용한다.
별도의 캐시된 프로필이나 읽기 실패 시 기본값으로 덮지 않는다. 미연결 기존 이행의 프로필 조회·산식은 유지한다.

## 읽기

- `makeup_list_participants`: `readParticipantPages`. 첫 요청은 `page=1`·`page_size=500` 만, 다음 요청은 `after` 만. 응답 `next_after` 를 우선하고 없으면 마지막 줄 커서다. `total` 이 있고 모은 수가 그보다 많거나 같으면 끝이다. 호출자가 준 `limit` 은 500으로 맞춘다.
- 8쪽(4,000줄) 뒤에도 `truncated` 이면 `보강 참여가 더 있습니다. 기간을 나눠 다시 조회해 주세요`. 같은 id 나 멈추는 커서는 `보강 참여 목록이 잘렸습니다`. 빈 성공으로 바꾸지 않는다.
- 소비: 원스크린 명단, 영어 시트 오늘, 영상 숙제 조회, 시수 마스터, 대시보드 예정, 학생 예정 배너, 시간표 `nativeAttendanceLinks`, 연결 분류(`completion.ts`).
- 기존 화면의 일곱 부가 조회는 `sharedRead`를 쓴다. 구조화된 권한 거절(42501 + detail.code=forbidden)만 보강 부가 정보를 생략한다. 실제 조회 오류·깨진 응답은 그대로 실패한다. 보고서·삭제·취소 쓰기 보호는 이 옵션을 쓰지 않는다.
- 연결 분류에서도 같은 권한 거절일 때 기존 예약 이행·되돌림을 유지한다. 연결된 예약의 직접 변경은 0349a가 메모·시수 변경 전에 막으며 출결 관측은 그대로 남는다. 자리/PIN은 키오스크처럼 관측만 한다.
- 케이스 목록·상세·검색은 `queries.ts` 의 기존 읽기 RPC. 이번 어댑터 편집 아님.
- `makeup_projection_evidence`: 재시도만 사용자 세션으로 읽는다. 출결 표를 따로 읽어 완료로 올리지 않는다.

SQL `makeup_list_participants` (0348c) 는 `after` 가 있으면 page 를 1로 두고, 커서 모양이 틀리면 거절한다. 앱은 둘을 같이 보내지 않는다. 하루 1,001줄의 운영 DB 증명은 이번 작업에서 실행하지 않았다. 테스트는 그 계약을 지키는 대역이다.

## 수량·급여·청구

- 수량 C/O/R 은 `evaluateQuantity` (`quantity.ts`) 순수 함수. 청구액·시수를 쓰지 않는다. 이번 식은 그대로다.
- 급여는 `computeTeacherTuition` 과 `tier-rows.ts` 가 출결 `session_units`(없으면 1)를 읽는다. 그 파일을 수정하지 않았다.
- 청구 회차 소비는 0267a의 현재 유효 학생·반·날짜·교시 행을 먼저 고른 뒤 `sum(coalesce(session_units, 1))`로 합산한다. 같은 교시 정정 이력을 모두 합하지 않는다(session-consumption 배선 테스트가 본문을 잠근다). 골든마스터는 동결 입력을 쓰고 보강 RPC를 호출하지 않는다. 계산 파일과 골든 픽스처를 수정하지 않았다.
- 반영 재시도와 실패 기록은 출결 `session_units` 를 갱신하지 않는다. 대기·실패를 완료로 올려 돈을 바꾸지 않는다.
- 직접 명령의 실시 인정과 보완 요청 모두 실제 실시자의 자기검토를 거절한다. UI와 0346f의 서버 검사가 같다.

## 영상·퇴원·폐강·인계

- 영상 숙제 조회는 `participantsOrLegacy` 로 그날 참여를 기존 반 짝에 더한다. 영상 저장 식은 바꾸지 않았다.
- 퇴원·휴원·폐강은 앱이 보강 돈을 쓰지 않는다. SQL `scan_handover` (0349d) 가 `student_withdrawn`, `student_on_hold`, `class_closed` 를 열고, `reconcile_scan` (0349e) 가 그 관찰과 수량 어긋남 표시를 돈다. 스캔은 출결·시수·청구를 고치지 않는다.

## 화면에 보이는 구분과 학생 링크

- 대시보드 예정 줄은 `origin` 이 `native` 또는 `additional` 일 때만 `rosterOriginLabel` 을 태그로 그린다 (`kpi-popups-day.tsx`). 예약 줄에는 그 태그를 붙이지 않는다. 조회가 `reservation` / `native` 를 채운다 (`makeup-upcoming.ts`).
- 학생·반 배너 문장은 `scheduledMakeupLabel`. 인자가 없거나 `reservation` 이면 기존 문장과 같고, `native` 는 `보강 참여`, `additional` 은 `추가 지도` 를 뒤에 붙인다.
- 학생 상세는 `getStudentUpcomingReservations` 결과를 `ScheduledChangeBanner` 에 넘긴다. 링크는 케이스 id 가 UUID 일 때만 `/makeups/{id}` (`makeupCaseHref`, `WindowLink`, 창 제목 `보강 상세`). 참여는 `caseIds[0]`, 연결된 옛 예약은 `legacy_maps.case_id` 다. 예약 id·참여 id·일반 글자는 주소를 만들지 않는다. UUID 를 타이핑하는 칸은 없다.

## 이번에 만들지 않은 것

운영 DB에 SQL을 적용하거나 운영 명단 1,001줄을 세지 않았다. 로컬 합성 SQL·단위 회귀·브라우저 결과는 별도 검증 기록에 남긴다. 명세 81건과 추가 19건을 모두 수락 완료로 세지 않는다.
