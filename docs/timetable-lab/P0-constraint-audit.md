# P0 제약 검사기 비교 조사

2026-10-02 · 대상 결정: [D09](decisions.md) · [D11~D14](decisions.md) · [D16](decisions.md) · [D21](decisions.md) · 실행 계획 [P0](execution-roadmap.md) 항목 3·4·6

## 조사 범위와 표기

- 기준: 브랜치 `chrismathone/timetable-lab`, HEAD `5a16e7935`. 소스 정적 판독만 했다. **DB 조회·브라우저·테스트 실행은 하지 않았다.**
- 아래 "현재 결과"는 코드를 읽고 예측한 값이다. 실행 확인 전이므로 P0 Vitest 비교 시험으로 확정한다.
- `✅` = 해당 줄에서 확인함. `⚠️ 런타임 미확인` = 실데이터·실행 순서·DB 함수 본문에 달려 있어 정적 판독으로 판정할 수 없음.
- 경로는 저장소 루트 기준이다. `파일:줄`은 HEAD 기준 줄 번호다.

## 1. 검사 경로 다섯 개

| # | 경로 | 진입점(검증한 위치) | 판정 단위 | 결과 형태 |
|---|---|---|---|---|
| ① | 드래그 반 이동 | 화면 `classMoveBlockers`, 서버 `moveClassSlots` → `moveBlockers` (`src/features/timetable/server/move-actions.ts:151-183`) | 화면에 보이는 **블록**(배치 여러 줄, `class-move.ts:10-14`) | `MoveBlocker[]` = student·teacher·room·self·shape (`class-move.ts:142-147`) |
| ② | 구조 충돌(시트 가져오기 두 경로 공용) | 구 가져오기 `diff.ts:120`, 마스터 시트 `plan.ts:485-531` | 목표 배치 쌍 | `ScheduleConflict[]` = room·teacher·duplicate·merged (`conflicts.ts:35`) |
| ③ | 마스터 시트 학생 충돌 | `plan.ts:748` → `masterStudentConflicts` | 학생 × 배치 날짜 구간 | `MasterIssue`(`severity:"confirm"`) (`student-conflicts.ts:142-150`) |
| ④ | 마스터 시트 반영 트랜잭션 | `applyMasterTransaction` (`master-sheet-store.ts:158-385`) | 시트 전체 계획 | 해시·확인 키 대조 후 반영 |
| ⑤ | 숨은 월별 계획 | `requireTimetablePlanAccess` (`src/features/timetable-dev/server/access.ts:35-51`) | 달 × 칸 | **충돌 검사 없음.** `src/app/(shell)/timetable-dev`·`src/features/timetable-dev`에서 위 판정 함수 import 0건(grep) |
| 참고 | 반 수정 폼 | `findOverlaps` (`src/features/classes/overlap.ts:118-169`) | 후보 슬롯 × 기존 슬롯 | 경고 전용, 저장을 막지 않음 (`overlap.ts:4-8`) |

공용 원시 함수:

- 시각 겹침 `timeRangesOverlap`: 경계 접촉은 겹침이 아니다 (`overlap.ts:73-80`).
- 날짜 겹침 `dateRangesOverlap`: `null`은 무기한이다 (`overlap.ts:83-92`).
- 분리등원 `enrollmentAttendsOnDay` (`src/features/enrollments/eligibility.ts:92-97`)와 `attendsOn` (`class-move.ts:201-203`)은 같은 규칙이다.
- 종료일 규약 `isEnrollmentEndedOn`: 반이동은 종료일 제외, 일반 종료는 종료일 포함이다 (`eligibility.ts:11-18`).
- 강의실 비교 토큰 `roomToken` (`src/features/timetable/lib/room-token.ts:11-16`).
- LAB·JJ 판정 `specialSlotLabel` (`src/features/timetable/lib/teacher-label.ts:104-107`).

## 2. 축별 비교 표

### 2-1. 학생·강사·방·같은 반

| 축 | ① 드래그 이동 | ② 구조 충돌 | ③ 학생 충돌 | ⑤ 월별 계획 |
|---|---|---|---|---|
| 학생 | 다른 반에 잡힌 **재원** 학생의 시간 (`class-move.ts:244`, `448-464`). 과목 구분 없음 | **검사 안 함** | `studentId` 기준. 전 과목 배치(`master-sheet-store.ts:75`, 과목 필터 없음) | 없음 |
| 학생 식별 | 색인은 id로 모으지만 `BusyWindow`의 이름·요일은 **이름 키**: `names` 중복 제거 (`class-move.ts:276-280`), `daysByName[name]` 덮어쓰기 (`:281`) | — | `studentId` 키 (`student-conflicts.ts:71-125`) | — |
| 표시 인원 상한 | 이름 4명(`NAME_CAP`, `:188`). 나머지는 `more`. 이름 일부가 요일로 걸러지면 `more`를 0으로 버림 (`:453`) | — | 상한 없음 | — |
| 강사 | 해석된 표시 라벨 문자열 비교 (`:488-491`). 슬롯 `queries.ts:441`과 블록 `queries.ts:1262` 모두 `resolveTeacherLabel`을 거침 | 이름 문자열. 마스터 경로는 `englishName \|\| displayName` (`plan.ts:134-140`, `500-510`) | 검사 안 함 | 없음 |
| 방 | FK가 양쪽에 있으면 FK, 아니면 라벨 토큰 (`sameRoom`, `:179-185`) | **라벨 토큰만** 비교, FK 미사용 (`conflicts.ts:150-152`) | 검사 안 함 | 없음 |
| 같은 반 동시 | `self`: 남은 자기 반 칸과 겹치면 차단. 자리 칸도 셈 (`:478-486`) | `duplicate`: 같은 `classId` 두 줄. 단 자리 행은 쌍을 만들기 전에 제외 (`:137`, `158-161`) | 같은 반 쌍 건너뜀 (`student-conflicts.ts:133`) | 유니크 앵커 `(월, 반, 요일, 시작)`만 있음 (`0232a:43`) |
| 블록 모양·길이 | 행·열 오프셋 유지, 원래 길이 유지 (`placeBlock :409-427`, `movedEndTime :219-222`). 서버도 원래 길이로 다시 계산 (`move-actions.ts:141-143`) | — | — | — |

### 2-2. 합반·LAB/JJ

| 항목 | ① 드래그 이동 | ② 구조 충돌 | ③ 학생 충돌 | 근거 |
|---|---|---|---|---|
| 합반 개념 | **없음.** 같은 강사·같은 방의 다른 반은 teacher·room 두 사유로 차단 | 같은 강사 + 같은 방(또는 방 미상) = `merged`, 적용 허용 (`conflicts.ts:166-170`, `38-40`) | 없음 | `merge_group`은 "실제 0행"이라 쓰지 않는다 (`conflicts.ts:13-14`). 2026-08-28 주석이며 현재 행 수는 ⚠️ 런타임 미확인 |
| 방 미상 + 같은 강사 | teacher로 차단 | `merged`로 분류. "확실하지 않은 것으로 적용을 막지 않는다" (`:166-170`) | — | |
| 복수 강사 칸 | 줄마다 실효 강사 하나 (`slotTeacherOf`, `:158-160`) | 강사 전원으로 쌍을 만듦 (`:153-154`) | — | 반영 시에는 첫 강사만 저장한다: `slotTeacherLabel: p.teacherNames[0]` (`master-sheet-store.ts:243`), `teacherId: t.teachers[0]` (`diff.ts:100`). 마스터 경로는 `multi-teacher` 확인 항목을 만든다 (`plan.ts:532-540`) |
| LAB·JJ 강사·방 축 | 줄 단위로 제외 (`:487`, `MovePart.seat`) | 자리 행을 아예 제외 (`:137`) | — | 강사·방 라벨 어느 쪽이든 자리면 자리 (`class-move.ts:196-198`, `conflicts.ts:98-101`) |
| LAB·JJ 학생 축 | **포함.** 자리 칸도 학생 위치로 셈 (`:251-257`은 비수업 블록만 제외) | 학생 축 없음 | **포함** (`fix` 문구 `:148`) | |
| 자기 반 자리 칸 | `self`로 막음 (`:310-327`, `480-486`) | 셀 수 없음 | 같은 반 쌍이라 건너뜀 | 경로마다 다르다(FX-08) |
| 반 메타 | 자리 줄은 강사·방이 비어 있음 (`:322-324`) | 미연결 강사·방은 자리면 면제, 아니면 `error` (`plan.ts:415-434`) | — | |

### 2-3. 분리등원과 LAB 분리 배정

| 항목 | 현재 처리 | 근거 / 공백 |
|---|---|---|
| 요일 분리등원 `attendance_days` | ①③ 모두 반영한다. 빈 배열은 전 요일 등원이다 | `class-move.ts:201-203`, `student-conflicts.ts:94` |
| 요일 이동 시 등원 요일 대응 | **어느 경로도 바꾸지 않는다.** ①은 `move-actions.ts`에 `attendance_days`를 쓰는 코드가 없다(grep 0건). ④는 이동 수강에 옛 요일을 그대로 넘긴다 (`master-sheet-store.ts:303-310`). ③도 이동 수강에 옛 값을 복사한다 (`student-conflicts.ts:22-28`) | 월목→화금 이동 뒤 `["thu"]`는 어느 요일과도 맞지 않는다. 결정 D11의 대상이다 |
| 요일 값 형식 | 판정은 `mon`~`sun` enum으로 비교한다. 1인·단체 배정 경로는 enum으로 정규화한다 (`assign-helpers.ts:58-73`) | 수학 내보내기 타입 주석은 한글 `["월","목"]`이다 (`exports/math-timetable/types.ts:12,66`). 내보내기 경계에서 변환한 값인지, DB에 한글이 섞였는지는 ⚠️ 런타임 미확인. 한글이 저장돼 있으면 그 학생은 어떤 축에도 걸리지 않는다 |
| `*LAB` 분리 수업 | 배치 칸 `class_schedules.lab_separate`(0271a), 수강 칸 `enrollments.lab_separate`(0271b) | 판정 규칙은 `labSplitSlotShows` (`src/features/attendance/seat/lab-split.ts:39`)다. 켠 학생은 `*LAB` 교시에만, 끈 학생은 일반 LAB 교시에만 선다. ①②③은 이 칸을 읽지 않는다(`plan.ts`·`conflicts.ts` 0건, `class-move.ts`·`student-conflicts.ts`는 `attendanceDays`만 사용). 학생이 반의 모든 LAB 교시에 있는 것으로 계산된다 |
| 자리 교시 고정·하루 이동 | `seat_period_pins`, `seat_period_moves`(0255a) | 충돌 검사기는 읽지 않는다. 고정 키는 `(seat, day_of_week, class_id, student_id)`이고 값이 `slot_start`다 (`0255a:63,69`) |

### 2-4. 날짜 구간과 학생 상태

| 항목 | ① 드래그 이동 | ② 구조 충돌 | ③ 학생 충돌 |
|---|---|---|---|
| 재료 기간 | 적용일이 속한 **한 주**(월~일). 각 요일 칸의 그 주 실제 날짜에 살아 있는 행만 쓴다 (`queries.ts:283-311`, `339-351`, `week.ts:159-170`) | 적용일에 살아 있는 영어 배치. `allLive` (`plan.ts:445-450`) + 시트 목표 | 적용일 이후 전 구간. `from = max(수강 시작, 배치 시작, 적용일)` (`student-conflicts.ts:97-99`) |
| 적용일 뒤 시작하는 배치 | 그 주 밖이면 보지 못함 | 영어는 `later:` **error**로 반영 차단 (`plan.ts:217-238`). 반영 단계도 다시 거절 (`master-sheet-store.ts:212-222`) | 날짜 구간으로 포함 |
| 적용일 전에 끝나는 같은 주 배치 | 그 주의 해당 요일 날짜에 살아 있으면 포함 | 제외. `valid_to >= 적용일` (`master-sheet-store.ts:75`) | 제외 |
| 수강 종료 | 그 주 기준 상태로 판단 (`queries.ts:815-829`) | — | 반이동이면 `end-1`, 일반 종료면 종료일 포함 (`student-conflicts.ts:100-110`). `isEnrollmentEndedOn`과 같은 규약 |
| 예정 수강(미래 시작) | `hold`로 분류돼 제외 (`queries.ts:824-829`, `class-move.ts:244`) | — | 시작일부터 포함 |
| 휴원 | `hold`로 제외 | — | `onHold` 수강 제외 (`student-conflicts.ts:85`) |
| 반 종강일 | 종강일이 기준일 전이면 제외 (`queries.ts:342`) | 활성·미종강 반만 (`master-sheet-store.ts:75`) | 배치 조회 단계에서만 거른다. 날짜 구간에 `closed_at`을 넣지 않는다. 종강 예정 반의 영향은 ⚠️ 런타임 미확인 |
| 비수업 블록 | 이동하는 반의 **과목** 블록만 적용일 하루 기준으로 읽는다 (`move-actions.ts:157-159`, `queries.ts:1240-1241`) | 블록을 넘기지 않는다 (`plan.ts:485-531`). 수업과 회의·연차 겹침을 검사하지 않음 | 해당 없음 |

### 2-5. 정보 부족 처리

| 정보 | ① | ② | ③ | ④ 마스터 계획 |
|---|---|---|---|---|
| 끝시각 없음 | DB `end_time NOT NULL`(`0001_parallel_meggan.sql:8`). 이후 마이그레이션 변경 여부는 확인하지 않음. 서버는 길이 ≤ 0이면 거절 (`move-actions.ts:141-142`) | 시작이 같으면 겹침, 아니면 길이 0으로 처리 (`conflicts.ts:85-88`) | **조용히 제외** (`student-conflicts.ts:93`) | 새 칸은 `time:` error (`plan.ts:435-443`) |
| 방 모름 | 라벨이 비면 방 축에서 빠짐 (`class-move.ts:492-493`) | `merged`로 떨어짐(같은 강사) 또는 충돌 아님 | — | 미연결 방은 error (`plan.ts:426-434`) |
| 강사 모름 | 라벨이 없으면 축에서 빠짐 | 사람 이름만 비교 (`conflicts.ts:91-95`) | — | 미연결 강사는 error (`plan.ts:415-425`) |
| 결과에 "확인한 축/못한 축" 구분 | 없음 | 없음 | 없음 | 없음 |

## 3. 감지 정책과 반영 확인 정책

같은 물리 상황도 경로마다 정책이 다르다. 결정 D12에 따라 기존 정책은 그대로 두고 새 경로는 명시적인 정책 표를 따른다.

| 경로 | 차단 | 사람이 확인하면 진행 | 경고만 | 서버 재검사·만료 판정 | 권한 |
|---|---|---|---|---|---|
| ① 드래그 이동 | 막는 사유 **전부**. 확인해서 진행하는 경로가 없음 (`move-actions.ts:180-183`). 추가 거절: 과거 적용일 (`:90`), 적용일 뒤 시작 행 (`:132-138`), 적용일 이후 그 교시 출결이 있는 경우 (`:185-214`) | 없음 | 없음 | 적용일 주를 다시 조회하고 **같은 함수**로 판정 (`:151-183`) | `canManageTenant("classes")`, 즉 full (`:79`) |
| ② 구 구조 가져오기 | 해시 불일치 (`structure-import-actions.ts:290-291`) | 이번 변경이 건드린 room·teacher·duplicate. 확인 키 집합이 **정확히** 같아야 함 (`:298-309`) | `merged`, 건드리지 않은 옛 충돌 (`conflicts.ts:201-203`) | 시트와 DB를 다시 읽어 해시와 키 집합 대조 | `canManageSheetSync` + `canWriteTenant("classes")` (`:263-264`) |
| ④ 마스터 시트 | `severity:"error"` 전체 (`master-sheet-store.ts:186-190`), 해시 불일치 (`:181-185`), 지난 날짜 (`:207-211`), 이후 예약 행 (`:213-222`) | `confirm` 전체: 건드린 room·teacher·duplicate (`plan.ts:541-552`), `student-time` (`student-conflicts.ts:144`), 이름 연결 확인, 복수 강사, 종강 대상 등. 키 집합 완전 일치 (`master-sheet-store.ts:191-202`) | `warning`: merged, 건드리지 않은 충돌, 시트에 없는 학생 유지 (`plan.ts:595-604`) 등 | 직렬화 트랜잭션 안에서 문맥을 다시 읽음 (`:167-185`). 해시 = `sha256(rulesVersion 5, input, grids, ctx)` (`:128-130`). ctx에 출결·예약·블록 포함 (`:43-108`) | `canManageSheetSync` + `canManageTimetableImport`(= classes full) (`master-sheet-actions.ts:55-65`, `import-access.ts:21-25`) |
| 반 수정 폼 | 없음 | 없음 | 겹침 전부 (`overlap.ts:4-8`) | 미조사 | 미조사 |
| ⑤ 월별 계획 | 없음 | 없음 | 없음 | 없음 | `timetable` 메뉴 full + `canWriteTenant` (`access.ts:41-48`). 반영 경로의 `classes` 메뉴와 **다른 메뉴 키**를 씀 |

정리하면 다음과 같다.

- 한 방에 다른 강사 두 반: ①은 차단, ②④는 확인 후 진행, 반 수정 폼은 경고, ⑤는 감지하지 않음.
- 합반 모양: ①은 차단, ②④는 경고만.
- 학생 시간 겹침: ①은 차단, ④는 확인 후 진행, ②는 감지하지 않음.
- `blocksApply`의 이름은 "막는다"지만, 실제로는 체크리스트에 올려 **확인을 요구하는** 종류다 (`conflicts.ts:38-40`, `201-203`).
- 반영 확인 키는 `kind|where|day|정렬된 (반@시작)쌍` 형태다 (`conflicts.ts:114-117`). 입력 순서가 바뀌어도 키는 같다. 학생 키는 `student-time:학생:요일:반쌍:시작쌍` (`student-conflicts.ts:141`).

## 4. 합성 픽스처

공통 기준 자료다. 이름·ID는 모두 합성이다.

```text
tenant      T1
적용일      2026-10-08(목) · 그 주 2026-10-05(월)~10-11(일)
강사        t-sam "Sam" · t-hannah "Hannah" · t-jane "Jane"
강의실      r-604 "본원604" · r-605 "본원605" · r-606 "본원606"
            r-602a "본원602" · r-602b "바른602" · r-201 "본원201"
반          cA 영어 A · cB 영어 B · cE EiE E(영어) · cM 수학 M · cM2 수학 M2
학생        s1~s12. s5·s6은 같은 이름 "김가윤"
배치 기본값 valid_from 2026-09-01, valid_to null, 수강 start_date 2026-09-01, end_date null
```

"현재"는 코드 판독으로 예측한 값이고 아직 실행하지 않았다. "기대"는 연습실 공통 검사 계약이 내야 할 결과다.

| ID | 입력(기준 자료에서 바뀌는 부분) | 현재 ① 드래그 | 현재 ② 구조 | 현재 ③ 학생 | 연습실 기대 | 연결 |
|---|---|---|---|---|---|---|
| FX-01 합반 모양 | cA 화 16:20-17:20 Sam r-604. cB 같은 시간 Sam r-604 | cB를 그 칸으로 옮기면 teacher + room 차단 | `merged`, `exact=true`, 확인 대상 아님 | — | `merged.shape` 정보 표시. 연습 저장 허용. 도우미는 `가능`으로 추천하지 않음. 반영 정책은 경로별 기존 값 | C06, D12, D19 |
| FX-02 한 방 두 강사 | cA 목 18:00-19:00 Hannah r-606. cB 목 18:30-19:30 Sam r-606 | room 차단 | `room`. 건드렸으면 확인, 아니면 경고 | — | 물리 충돌. 추천 불가. 연습실 반영에서 확인 가능 여부는 정책 표로 정할 **P0 결정 항목** | C06, D12 |
| FX-03 FK 충돌 | cA 화 17:00-18:00 Hannah r-602a. cB 같은 시간 Jane r-602b | FK가 달라 통과 | `roomToken` = "602"로 같아 `room` 충돌(오탐) | — | FK가 양쪽에 있으면 FK 우선. ②와의 차이는 "알려진 불일치"로 비교표에 기록 | D09, [[#122]] |
| FX-04 한쪽만 FK | cA r-201 FK(라벨 없음, 방 이름 "본원201"). cB 라벨 "201", FK 없음. 같은 시간·다른 강사 | 토큰 폴백으로 room 차단 | `room` | — | 같은 방으로 판정. 방 축 완전성은 `partial(라벨 폴백)` | [[#115]] |
| FX-05 목요일만 등원 | cA 월목 17:00-18:00 → 월목 18:00-19:00으로 이동. s1 cA `attendance_days=["thu"]`. s1 cM 월 18:00-19:00 | 막지 않음(월요일 칸에서 s1을 거름) | 학생 축 없음 | 월요일 쌍 건너뜀(이슈 0) | 거짓 충돌 0 | C03 |
| FX-06 월목→화금 | FX-05 상태에서 cA를 화금 18:00으로 이동. s1 cM 금 18:00-19:00 | 금요일 칸은 `attendsOn(["thu"],"fri")=false`라 통과. 이동 뒤 s1 요일값은 그대로 `["thu"]` | — | 시트 경로에서도 `["thu"]` 그대로라 감지 0 | 명령에 `{thu→fri}` 대응 포함 + 미리보기. 대응하면 s1 금 18:00 vs cM 학생 충돌. 대응을 정하지 않으면 정보 부족으로 반영 불가 | D11, L03 |
| FX-07 한글 요일값 | s1 cA `attendance_days=["목"]` | s1을 어떤 요일에도 셈하지 않음(조용한 누락) | — | 동일 | 경계에서 enum 정규화. 모르는 값은 학생 축 `partial` 이슈 | ⚠️ 데이터 존재 여부 미확인 |
| FX-08 자기 반 LAB | cE 정규 화 17:00-17:40 Jane r-604. cE LAB 화 17:40-18:20(`slot_teacher_label="LAB"`). 정규 줄만 화 17:40으로 이동 | `self` 차단 | 자리 행 제외로 `duplicate` 0 | 같은 반 쌍 건너뜀 | `class.self` 감지(자리 포함). 시트 경로 정책은 그대로 | C04 |
| FX-09 다른 반 LAB 학생 | s2 cB LAB 화 18:00-19:00 + cA 수강. cA를 화 18:00으로 이동 | student 차단(자리 칸도 학생 위치) | 감지 0 | 건드렸으면 `student-time` 확인 | `student.time`에 근거(자리 여부 포함). 강사·방 축은 자리 제외 | C04 |
| FX-10 `*LAB` 분리 | cE LAB 화 17:00-17:40(일반) + 화 17:40-18:20(`lab_separate=true`). s3 cE `lab_separate=true`, s4 false. s3 cM 화 17:00-17:40 | cM 블록을 화 17:00에 놓으면 s3 student 차단. 규칙상 s3는 17:00 LAB에 없으므로 오탐 | — | 같은 오탐 | 플래그를 읽었으면 `labSplitSlotShows` 적용, 못 읽었으면 학생 축 `partial("LAB 분리 배정 모름")` | 0271a·0271b |
| FX-11 회의 블록 | Hannah 회의 블록 수 15:00-16:00(english). Hannah 담당 cA를 수 15:20으로 이동 | teacher 차단(블록 라벨로 사유) | 시트에 같은 배치가 있어도 감지 0 | — | `block.teacher`. 과목과 관계없이 teacherId로 비교 | C05 |
| FX-11b 다른 과목 블록 | FX-11과 같지만 블록 `subject='math'` | 영어 반 이동에서는 수학 블록을 읽지 않아 통과(누락) | 감지 0 | — | 차단 근거 표시 | ⚠️ 두 과목을 맡는 강사의 실존 여부 미확인 |
| FX-12a 그 주 안에 끝난 배치 | cM 월 18:00-19:00 `valid_to=2026-10-06`. s1 cM. cA(s1)를 월 18:00으로, 적용일 10-08 | 10-05(월)에 살아 있어 student 차단(오탐) | — | 이슈 0 | 적용일 이후 구간으로 이슈 0 | D13 |
| FX-12b 그 주 뒤 시작 배치 | cM2 월 18:00-19:00 `valid_from=2026-10-12`, s1 수강 `start_date=2026-10-12`. 같은 이동 | 그 주에 없고 수강도 `hold`라 통과(누락) | — | `from=10-12`로 `student-time` 확인 | 이슈 1, 구간 `2026-10-12~` | C08, D13 |
| FX-13 반이동 경계 | s1 cB 목 18:00-19:00 `end_date=2026-10-15`(2026-10-15 = 목). 새 수강 cM 목 18:00-19:00 `start=2026-10-15`. ⓐ `is_transferred=true` ⓑ false. cB 배치는 이번 계획의 변경분 | 해당 없음 | — | ⓐ 겹침 0(10-14까지), ⓑ 10-15 하루 겹침. 한쪽이 변경분일 때만 보고 (`student-conflicts.ts:135`) | ③과 같은 구간 판정. 변경 여부와 관계없이 기존/신규로 구분해 표시 | `eligibility.ts:11-18` |
| FX-14 끝시각 없음 | 시트 목표 cB(영어) 월 18:00 `endTime=null`, Jane r-604. 기존 cA 월 18:00-19:00 Sam r-604. s1은 cA·cB 둘 다 수강 | — | 시작이 같아 겹침으로 보고 `room` | cB 배치를 조용히 제외(학생 이슈 0). ④는 `time:` error로 반영을 막음 | `info.missingEnd`. 추천과 `전부 충돌 없음` 인증 금지 | C07 |
| FX-15 방 모름 + 같은 강사 | cA 화 16:00-17:00 Sam 방 null. cB 화 16:30-17:30 Sam r-604 | teacher 차단 | `merged`(경고) | — | `teacher.time` + 방 축 `unknown`. 합반으로 단정하지 않음 | C06, C07 |
| FX-16 복수 강사 | 시트 목표 cA 금 16:20-17:20 강사 [Sam, Jane] r-604. cB 금 16:20 Jane r-605 | 반영 후 cA에는 Sam만 남아 이후 Jane 충돌을 못 봄 | `teacher`(Jane, 방이 다름) | — | `placement.teacherIds[]`를 보존. 첫 강사만 저장하면 그 손실을 미리보기에 명시 | `master-sheet-store.ts:243` |
| FX-17 동명이인 | cA 월목. s5 "김가윤" `["mon"]`, s6 "김가윤" `["thu"]`. 둘 다 cM 목 18:30-19:30. cA를 월목 18:30으로 이동 | 명단 순서가 s5→s6이면 차단, s6→s5이면 **누락**(마지막 `daysByName` 값이 이김) | — | s6만 이슈. 순서 무관 | studentId 기준, 입력 순서와 관계없이 같은 결과 | D09, L04, S10. ⚠️ 실제 순서 미확인 |
| FX-18 이름 상한 | cA 월목, s7~s12가 모두 cM 목 18:30. 앞 4명(s7~s10)은 `["mon"]`, s11·s12는 제한 없음. 같은 이동 | 이름 4명이 모두 걸러져 `more`가 0이 되어 **누락** | — | s11·s12 이슈 | 표시 상한은 화면에서만. 판정은 전원 | D09 |
| FX-19 손대지 않은 옛 충돌 | cX·cY의 기존 room 충돌. 초안에서는 관계없는 cZ만 이동 | cZ만 판정 | `touched=false`, 경고 | 변경 없는 쌍은 보고하지 않음 | `baselineOrNew="기존"`으로 표시. 확인·차단 대상 아님 | D13, S09 |
| FX-20 교시 밖 시각 | cA 화 16:25-17:25 | 화면 대상 칸은 교시 행 시작만(`placeBlock`). 서버는 `HH:MM:SS`면 무엇이든 받음 (`move-actions.ts:139-140`) | — | — | 시각은 도메인 값. 교시 밖 표식 | L02 |
| FX-21 기존 월별 계획 가져오기 | `timetable_plan_slots` 2026-11: P1 cA 월 16:20-17:20(source s-old), P2 cA 월 16:30-17:30(source s-new), P3 cM 수학 | ⑤에는 검사 없음 | — | — | P1·P2를 `class.self`로 표시(합치지 않음). 새 placementId 발급 + `sourceScheduleId`·원본 계획 칸 id 보존. P3은 과목 어댑터 정책대로. 명단은 "현재 수강 차용"으로 표시 | L01, D01 |
| FX-22 확인 키 집합 | ④ 필요한 확인 키 {A,B}. 사용자가 {A,B,C} 또는 {A}를 보냄 | — | 둘 다 거절(정확히 일치해야 함) | — | revision/hash에 묶은 같은 완전 일치 규칙 | P01, D12 |

FX-17·FX-18의 순서 의존은 `rosterOf` Map 삽입 순서에서 생긴다(`class-move.ts:241-250`, `264-289`). 실제 조회 순서는 ⚠️ 런타임 미확인이다.

## 5. 어댑터 권고

### 5-1. 경계 입력을 한 벌로

```ts
type OccupancyRow = {
  placementId: string;           // 초안 안정 ID. 운영 행은 sourceScheduleId
  sourceScheduleId: string | null;
  origin: "draft" | "live-external" | "block" | "legacy-plan";
  subject: string; classId: string | null;
  day: DayKey; start: string; end: string | null;   // 시각 = 도메인 값
  validFrom: string; validTo: string | null;        // 적용일 이후 구간
  teacherIds: string[]; teacherLabels: string[];    // 판정은 id, 라벨은 설명용
  roomId: string | null; roomToken: string;         // FK 우선, 토큰은 폴백
  seat: "LAB" | "JJ" | null; labSeparate: boolean | null; // null = 모름
  blockKind?: string;
};
type AttendanceRow = {
  enrollmentId: string; studentId: string; classId: string;
  from: string; to: string | null; isTransferred: boolean; onHold: boolean;
  attendanceDays: DayKey[] | { unknownRaw: string[] };
  labSeparate: boolean | null;
};
```

- `specialSlotLabel`, `roomToken`, 요일 정규화는 **경계에서 한 번만** 실행한다. 판정 중에 라벨에서 다시 추론하지 않는다.
- 강사 라벨만 있고 id가 없는 행은 강사 축 `partial`로 표시한다. 라벨 매칭 결과는 근거로만 남긴다.
- 비수업 블록은 과목으로 거르지 않는다. 강사 id 기준으로 모든 과목 블록을 넣는다(FX-11b).

### 5-2. 그대로 재사용할 순수 함수

- `timeRangesOverlap`, `dateRangesOverlap`, `enrollmentAttendsOnDay`.
- `isEnrollmentEndedOn`의 종료일 규약. ③의 `shiftDays(end,-1)` 구현과 결과가 같아야 한다.
- `sameRoom`(FK 우선), `placeBlock`, `movedEndTime`(모양·길이 보존).
- `labSplitSlotShows`. 플래그를 읽은 경우에만 쓴다.
- `pairKey`의 순서 무관 키 아이디어, `touched` → `baselineOrNew`.

### 5-3. 권위 판정에 쓰지 않을 것

- `buildClassMoveIndex`·`BusyWindow`: 이름 키, 4명 상한, 한 주 스냅샷이다(FX-12·17·18). 드래그 화면의 빠른 힌트로는 남겨도 되지만, 연습실 검사·추천·반영 판정에는 ID 기반 새 색인을 쓴다.
- `detectScheduleConflicts`: 토큰 방 비교, 자리 행 제외, 날짜 축 없음이 한계다. 기존 시트 경로의 **정책 호환 어댑터**로만 쓰고, 연습실 결과와 나란히 돌려 차이를 기록한다.

### 5-4. 감지와 정책을 분리

검사기는 `code`와 근거만 낸다. 정책 표가 `code × 경로(연습 저장/추천/기존 시트 반영/연습실 반영)`를 `{저장 허용, 추천 가능, 확인 가능, 차단}`으로 바꾼다.

- 기존 ①②④의 현재 정책은 3장 표 그대로 고정 시험한다.
- 연습실 반영 경로의 값은 3장 FX-02처럼 **P0 결정 항목**으로 남긴다. 기존 정책을 몰래 강화하거나 완화하지 않는다(D12).

### 5-5. 축별 완전성

`completenessByAxis`의 원인 코드 후보:

- `student`: 요일 형식 모름, LAB 분리 배정 모름, 자리 고정 미반영.
- `teacher`: id 없음.
- `room`: 라벨 폴백, 방 없음.
- `nonlesson`: 블록 조회 실패.
- `attendance`: 출결 조회 실패.

지금 다섯 경로 모두 이 구분이 없다(2-5).

### 5-6. 패리티 하네스

FX-01~FX-22를 같은 입력으로 ①②③과 새 검사기에 돌린다. 결과 차이는 "의도된 차이(근거 결정 ID)"와 "버그 후보"로 나눠 기록한다. 기존 함수와 파일은 수정하지 않는다. 시험 파일 위치는 P1 폴더 결정 뒤 정한다(제안: `src/features/timetable-lab/constraints/legacy-parity.test.ts`).

## 6. 기존 데이터 보존

| 대상 | 현재 사실 | 연습실 가져오기·반영 시 보존 규칙 |
|---|---|---|
| `class_schedules` 이력 | 운영 이력을 함께 담는다([[#88]]). 이동은 옛 행 마감 + 새 행 삽입 (`move-actions.ts:35-38`, `225-305`). 시트 반영은 `closes`·`inserts` (`master-sheet-store.ts:223-246`) | 같은 행을 제자리에서 고치지 않는다. 미래 시작 행은 건드리지 않거나 명시적으로 거절한다(①·④ 모두 거절) |
| `class_schedules.lab_separate` | 드래그 이동은 별도로 읽어 새 행에 싣는다 (`move-actions.ts:103-112`). 시트 반영 `inserts`에는 이 칸이 없고, 반영 RPC 정의 파일 0087a·0231a·0234a에도 언급이 없다(grep) | 연습실 반영은 이 칸을 명시적으로 운반한다. 시트 반영 RPC가 실제로 옛 값을 옮기는지는 ⚠️ 런타임 미확인 |
| `attendance_records.slot_start` | 출결은 배치 시각에 매달려 있다([[#126]]). ①은 적용일 이후 기록이 있으면 거절, ④는 옮길 수 있는 것만 이관 (`master-sheet-store.ts:250-253`, `343`) | P04 기준을 따른다. 애매한 연결은 구체적인 오류로 처리 |
| `enrollments.attendance_days` | ④ 이동은 옛 값을 보존한다 (`:303-310`, 테스트 `master-sheet-store.test.ts:57`) | 요일 이동이면 대응 명령을 거쳐서만 바꾼다(FX-06). 정규화하지 못한 값은 원문을 보존하고 이슈로 띄운다 |
| `enrollments.lab_separate` | 반 상세 토글로 즉시 적용, 이력은 감사로그 (`0271b:8-12`) | 학생 이동·반 변경 시 값의 의미(새 반에서도 유지할지)를 미리보기에 표시 |
| `seat_period_pins`·`moves` | 값이 `slot_start`라 LAB 교시 시작이 옮겨지면 가리키는 칸이 사라진다 (`0255a:63,69`) | 영향 목록을 미리보기에 표시한다. 읽는 쪽이 사라진 시작을 어떻게 처리하는지는 ⚠️ 런타임 미확인 |
| `teacher_schedule_blocks` | ④는 적용일부터 영어 블록을 **통째로 교체**한다 (`master-sheet-store.ts:286-295`). 되돌리기 `rollbackMasterBlocks` (`:388-418`) | 연습실은 바꾼 블록만 명시 delta로 반영한다. 손대지 않은 블록 삭제 0(P06) |
| 예약·되돌리기 | 스냅샷과 가져오기 로그. 날짜 단위 취소 `cancelMasterDate` (`:420-458`). 이후 예약이 있으면 `pending:`·`later:` error (`plan.ts:208-238`) | 예약 단위 복원. 초안 Undo와 분리(P05) |
| `tenant_settings` 통합 그룹 | 적용일이 오늘일 때만 쓴다 (`master-sheet-store.ts:345-370`) | 연습안의 그룹 구성은 초안 데이터. 운영 반영 시 명시 항목으로 |
| `timetable_plan_slots`(0232a) | 칸만 있고 명단이 없다. 화면은 현재 명단을 `class_id`로 빌린다 (`plan-adapter.ts:5-18`). 시드는 **과목 필터 없이** 그 달에 살아 있는 행을 복사한다 (`actions.ts:176-186`). 같은 앵커 중복은 `valid_from` 최신 하나만 남긴다 (`plan-row.ts:135-151`). 시작이 다른 두 행은 둘 다 남는다. `source_schedule_id`에는 FK가 없다 (`0232a:79-80`). `merge_group`은 그대로 복사한다. 시작을 바꾸면 앵커가 바뀌어 새 id가 된다 (`actions.ts:357-364`). 시드의 지우고-넣기는 원자적이지 않다 (`actions.ts:225-229`). RLS 정책 0개 + service_role 전용 (`0232a:71-73`) | 원본 계획을 지우거나 고치지 않는 **읽기 전용 복사**로 가져온다. 새 placementId를 발급하고 `sourceScheduleId`·원본 칸 id를 기록한다. 같은 반 중복(FX-21)과 과목 혼재를 미리보기에 표시한다. 명단은 계획 데이터가 아니라고 표시한다. 행 존재 여부와 규모는 ⚠️ 런타임 미확인(개인정보 없는 건수 조회 대상) |
| 권한 축 | ⑤는 `timetable` 메뉴, 운영 반영은 `classes` 메뉴 (`access.ts:41`, `move-actions.ts:79`, `import-access.ts:24`) | 초안 CRUD와 실제 반영을 따로 검사한다(D16). 한쪽 권한으로 다른 쪽을 통과시키지 않는다 |

## 7. 런타임 미확인 목록 (P0 건수 조회·실행 시험 대상)

| # | 확인할 것 | 조회·시험 방법(개인정보 없이) |
|---|---|---|
| U1 | `enrollments.attendance_days`에 enum 밖 값(한글 등)이 있는가 | 값 종류별 건수 |
| U2 | `timetable_plan_slots`에 데이터가 있는가 | 월·과목별 행 수, 같은 반·요일에 시작이 다른 칸 수 |
| U3 | `class_schedules.merge_group`이 여전히 0행인가 | not null 건수 |
| U4 | 수학 배치의 방 라벨·FK 공백 비율 (`conflicts.ts:21-22` 주장 재확인) | 과목별 null 비율 |
| U5 | 시트 반영 RPC가 새 행에 `lab_separate`를 옮기는가 | 격리 DB에서 반영 시험 |
| U6 | 사라진 `slot_start`를 가리키는 자리 고정을 읽는 쪽 동작 | 격리 DB에서 단위 시험 |
| U7 | 같은 반 안 동명이인 존재·명단 순서 | 이름 해시 기준 중복 건수 |
| U8 | 영어·수학 비수업 블록을 모두 가진 강사 존재 | `teacher_id` 기준 과목 수 |
| U9 | 검사기 성능 | 소형·통상·확장 합성 규모에서 p50/p95 측정(목표와 분리 기록) |

## 8. 결론

- 검사 경로마다 축(학생·블록·자리), 기간(한 주·적용일·전 구간), 식별(이름·라벨·FK)이 서로 다르다. 같은 상황에 차단, 확인 후 진행, 경고, 무감지가 모두 나온다.
- 연습실은 ID 기반 경계 입력, 적용일 이후 구간, 축별 완전성, 감지/정책 분리를 갖춘 새 검사기를 만든다. 기존 세 함수는 패리티 하네스로 차이를 고정하는 데 쓴다.
- 기존 정책 변경은 하지 않는다. 연습실 반영 경로의 room·teacher 확인 정책(FX-02)과 월별 계획 수학 칸 처리(FX-21)는 결정이 필요한 항목이다.
