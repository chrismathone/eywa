# 학부모 등하원 — 실제 저장 · 이력 장부 · 고정시간 변경 (2026-09-29)

[2026-09-28 모달 작업](parent-ride-route-modal-2026-09-28.md)의 다음 단계. 그때 "화면 상태만" 바꾸던 저장을 **DB에 바로 적용**하고,
누가·언제·어떻게 바꿨는지 **이력 장부**에 남긴다. 로컬 테스트 저장소(`local/parent-accounts` 브랜치) 전용 작업이다.

## 1. 사용자 요청 → 반영

| 요청(2026-09-29) | 반영 |
|---|---|
| "학부모가 내용을 바꾸면 디비도 바뀌게" | 학부모 변경이 `shuttle_ride_exceptions`(0229a, 직원 '오늘만 승하차'와 같은 표)에 바로 저장 → 셔틀 선생님 화면·관제·인쇄에 그대로 보인다 |
| "누가 언제 어떻게 수정했는지 기록" | **0291a** 이력 장부 `shuttle_ride_exception_history` — 트리거가 생성·변경·취소마다 한 줄(전/후 자리 글자 스냅샷 · 행위자) |
| "관리자나 셔틀 선생님만" 내역 보기 | 장부는 직원 화면(`/shuttle/parent-rides`)에서만 읽는다(세션 + RLS). 학부모 로더는 장부를 읽지 않는다 |
| "고정시간 변경하기 … 요일마다 … 이유를 받도록" | **0292a** `change_shuttle_regular_ride` — 고른 요일 하나의 정기 배정(`shuttle_riders`)을 옮기고 `shuttle_rider_history`에 사유와 함께 기록 |
| "각 회차 시작 10분 전에는 수정 못 하게" | `runEditClosed` — **고른 회차 출발 10분 전**부터 그 회차로 바꾸기 막음(화면 안내 + 서버 판정 같은 함수). 고정시간 변경도 2026-09-30부터 `regularRunClosed` — 고른 요일이 오늘이면 출발 10분 전이 지난 회차는 못 고르고, 오늘 모든 회차의 마지막 시각이 지나면 다시 열림 |
| "등원시간 하원시간 나누지 말고 자유롭게" | 회차의 등/하원 방향을 가리지 않고 고를 수 있다(저장 방향 = 학부모가 고친 구간) |
| "사유를 짧게라도 받게" | '등원만/하원만 타지 않기'·'결석'에 사유 필수(100자) — `ReasonDialog` |
| [결석] | 그날 등원·하원 둘 다 '타지 않기'. 등원을 다시 고르면 결석으로 잠긴 하원도 살아난다 |
| 관리자 목록 검색 | 학부모 등하원(관리자 뷰)에 [전체]/[호차별]/[N호차] + 이름 검색(초성 "ㄱㅁㅈ" 지원) |

## 2. DB (마이그레이션 2개)

- **0291a_shuttle_ride_exception_history.sql**
  - `shuttle_ride_exceptions`에 `actor_kind`(staff|parent|system) · `actor_name` · `parent_account_id`
  - 장부 표 + 추가만 허용 트리거(수정·삭제는 service_role도 거절) + 자리 글자 함수 `shuttle_ride_exception_label`
  - 취소는 여전히 **행 삭제** — 대신 `cancel_shuttle_ride_exception()` 함수로만 지워 행위자를 트리거에 넘긴다.
    함수를 안 거친 삭제(cascade 등)는 '자동 정리'로 남는다
  - 장부엔 FK 없음(cascade 중 트리거가 쓰므로)
- **0292a_shuttle_regular_ride_change.sql**
  - `change_shuttle_regular_ride()` 한 트랜잭션: 그 요일 빼기(그 요일만 있던 줄은 삭제) → 새 칸에 요일 더하기(없으면 새 줄) → 이력
  - ⚠️ 날짜 하루짜리 변경이 걸린 날은 그 변경이 여전히 이긴다
- ⚠️ **번호 충돌**: 본서버(BIGSHOL/eywa) main에는 이미 `0291a_grade_goals_exam_axis`, `0292a_page_usage_daily`가 있다.
  본서버로 옮길 땐 빈 번호로 바꿔야 한다(현재 본서버 마지막 = 0301a).

## 3. 코드

| 파일 | 내용 |
|---|---|
| `src/features/shuttle/server/parent-ride-actions.ts` | **새 파일** — `changeParentRideStop` · `resetParentRide` · `skipParentRide` · `absentParentRide` · `changeRegularRide`. 모든 값 서버 재확인(연결된 아이 · 오늘~62일 뒤 평일 · 우리 학원 정류장 칸 · 10분 마감) |
| `src/features/shuttle/parent-rides.ts` | `RideChange`·`RegularChange`·`RegularStop` 타입, `EDIT_CUTOFF_MINUTES`·`runStartTime`·`runEditClosed`, 문구 `SKIPPED_HEADLINE`, 예정 없는 '미탑승' 줄 숨김 |
| `src/features/shuttle/server/parent-ride-data.ts` | 그날만 변경을 **어느 날짜든** 읽음, `regular`(그 요일 고정 자리) 반환, 🔴 학부모에게 넘기기 전 `staffMemo` 제거 |
| `src/features/shuttle/server/queries.ts` | 직원 전용 `getRideChangesOn(ymd)` · `getRegularChanges()`(최근 60일) |
| `src/features/shuttle/server/actions.ts` | 직원 변경도 행위자 기록, 취소는 `cancel_shuttle_ride_exception` RPC |
| `src/features/shuttle/components/` | 새 파일: `regular-ride-dialog` · `skip-ride-button` · `absent-button` · `reason-dialog` · `kst-clock`. 수정: `vehicle-route-dialog`(실제 저장) · `parent-ride-card` |
| `src/app/(parent)/parent/rides/page.tsx` | 현재 시각(KST) · [고정시간 변경] · [결석] 연결 |
| `src/app/(shell)/shuttle/parent-rides/` | 변경 내역 표시 + `_components/parent-rides-board.tsx`(묶음 보기 · 이름 검색) |
| `src/features/shuttle/name-search.ts` | **새 파일** — 이름 일부 · 초성 검색 |
| `local-setup/setup.ps1` | dump 복원 뒤 0291a·0292a 적용 + PostgREST 스키마 캐시 새로고침(9/28 문서의 "아직 반영 안 함" 해결) |

## 4. 개인정보 · 권한

- 학부모 세션은 RLS로 못 쓴다 → service_role로 쓰되 아이·날짜·자리·마감을 **서버에서 다시 확인**([[#77]])
- 직원 메모·변경 내역은 학부모 화면 재료에 **들어가지 않는다**(클라이언트 컴포넌트로 넘어가면 브라우저로 전송되므로 로더에서 제거)
- 감사로그: 학부모는 직원 표에 없어 `logActionAs`로 기록

## 5. 검증

- `vitest run src/features/shuttle` 통과(10파일 · 198개, 2026-09-29)
- 🔴 로컬 DB에 0291a·0292a를 적용해야 동작한다(`setup.ps1`이 적용, 이미 설치된 PC는 두 파일을 psql로 직접 실행)

## 6. 같은 방향 구간이 두 개로 보이는 버그 (9/29·9/30 두 번)

**원인은 하나다** — 화면(`buildRideLegs`)은 **회차마다** 구간을 만들고, 오늘 한 아이·한 방향에 회차가 둘 걸리면 두 줄이 선다.
고정시간(정기 배정)을 **오늘 요일**에 옮기면 새 고정이 오늘 명단에도 바로 먹어서 "옛 회차의 오늘 기록" + "새 회차의 예정"이 동시에 생긴다.

| 날 | 옛 회차의 오늘 기록 | 막은 방법 |
|---|---|---|
| 9/29 | `미탑승`(missed) | 예정 없는 기록 줄은 **탔을 때만** 남김 |
| 9/30 | `탔음`(boarded) — 필터를 통과 | ① 화면: **한 방향엔 한 번** — 탄 구간이 있으면 같은 방향의 나머지 줄은 뺀다(`oneLegPerRide`) ② 원천 차단: 고른 요일이 오늘이고 **지금 고정 회차가 이미 출발했으면** 운행이 끝날 때까지 고정시간 변경 불가(화면 + 서버 `regularClosedMessage`) |

- ⚠️ ①은 **학부모 화면**만 고친다. 이미 저장된 오늘 데이터(예: 9/30 김민준 수요일 등원 = 2회차)는 셔틀 선생님 오늘 명단에 그대로 남는다 — 오늘 운행이 끝나면 자연히 무해해진다.
- ⚠️ 등원을 **하원 회차**(18:20)에도 고를 수 있게 한 결정(방향 자유)이 있어, 등원 구간이 저녁 시각으로 보일 수 있다.

## 7. 🔴 남은 것

- 학원 승인 절차 없이 **바로 적용**된다(사용자 지시) — 본서버 반영 전 운영 정책 확인 필요
- 마이그레이션 번호를 본서버 기준으로 바꾸기
- 모달 저장 뒤 카드 갱신은 `revalidatePath`에 의존 — 실화면 재확인 권장
