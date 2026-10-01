# 학부모 등하원 — 처음부터 지금까지 정리 (2026-09-30)

로컬 테스트 복사본(`local/parent-accounts`)에서 만든 **학부모 계정 · 등하원 변경** 기능 전체를 한 번에 정리한다.
본서버(BIGSHOL/eywa)로 옮길 때 이 문서와 [`db-for-main/`](../db-for-main/README.md)을 같이 본다.

- 앞 단계 상세: [9/28 노선 모달](parent-ride-route-modal-2026-09-28.md) · [9/29 DB 저장·이력](parent-ride-db-apply-2026-09-29.md)
- ⚠️ 이 폴더는 git이 아니라서 "초기버전"은 **본서버 main + 로컬 브랜치 복사본(9/28 14시)**으로 잡았다. 그 뒤로 바뀐 파일은
  파일 수정 시각으로 추렸다(§4).

---

## 1. 단계별 흐름

| 날짜 | 한 일 | DB |
|---|---|---|
| 9/28 이전 | 학부모 계정 · 학부모 포털(`/parent` — 실시간 차량·등하원·수업 시간표) · 관리자 '학부모 계정' 화면 | `parent_accounts` · `parent_account_students` |
| 9/28 | 학부모 [등원/하원 수정하기] → 호차 전체 노선 모달(화면 상태만, DB 저장 없음) | — |
| 9/29 | 모달 저장을 **DB에 바로 적용**(`shuttle_ride_exceptions`) · 이력 장부 · 고정(요일) 시간 변경 · 타지 않기 · 결석 · 10분 마감 · 관리자 '학부모 등하원' 변경 내역 · 이름/초성 검색 | 이력 장부 · 고정 변경 함수 |
| 9/30 | 아래 §2 | 확인 표식 |

## 2. 9/30에 바뀐 것

| # | 요청 | 바뀐 것 | 어디 |
|---|---|---|---|
| 1 | "저장됐다는데 화면이 안 바뀐다" | **원인**: 오늘 이미 탄 기록이 있으면 화면은 그 방향의 나머지 구간을 뺀다(`oneLegPerRide`) → 저장은 되는데 안 보였다. **해결**: 탄 구간은 수정 모드에서 흐리게 잠그고 "이미 탔어요 · 수정할 수 없어요". 서버도 같은 기록으로 수정·되돌리기·타지 않기·결석을 거절(오늘만) | `legRode` · `rodeMessage` |
| 2 | 차가 지나갔어도 안 탔으면 다른 회차로 | 그대로 됨('미탑승'은 탄 것이 아님, 마감은 **고른** 회차에만) | — |
| 3 | 지난 요일도 고정시간 변경 | 이번 주 지난 요일 칩에도 [고정시간 변경]이 선다(다음 그 요일부터 적용). 9/29 "지난 날짜 칩엔 없다"를 뒤집음 | `parent/rides/page.tsx` |
| 4 | 회차 더블클릭 → 한 번 클릭 | 한 번 누르면 크게 보기 + 키보드 Enter/Space | `vehicle-route-dialog.tsx` |
| 5 | 등원·하원 같은 회차 금지 · 등원이 하원보다 늦으면 안 됨 | 짝 규칙 `ridePairConflict` — 반대 방향 회차는 통째로 회색, 시각이 어긋나는 정류장은 못 고름. 하루 변경·되돌리기·고정 변경 모두 서버가 다시 확인. 9/29 "등원/하원 나누지 말고 자유롭게"를 좁힌 것 | `parent-rides.ts` · 두 모달 · `parent-ride-actions.ts` |
| 6 | 김민준 수요일 등원 고정 → 14:40 | ❌ **안 됨** — DB 쓰기가 권한 확인에 막혀 멈췄다(§5) | — |
| 7 | 운행 종료된 노선 흐리게 + 문구 | 평소 보기(수정 모드 아님)에서 셔틀 선생님이 **운행 종료**를 찍은 구간의 노선을 흐리게 + 가운데 "등원/하원 완료했습니다"(크게 · 70% 불투명). 관리자 화면은 흐리지 않음. 문구는 **그 아이가 실제로 탔을 때만**(아래 §3-⑧에서 고친 것) | `parent-ride-card.tsx` |
| 8 | 출발 10분 전까지는 출발·탑승 기록 금지 | 셔틀 '오늘 등하원'의 **탑승 기록**과 **출발** 버튼을 서버가 거절(오늘 · 등하원 둘 다). 되돌리기(기록 지우기·종료 되돌리기)는 막지 않음 | `actions.ts` `runNotOpenMessage` |
| 9 | 관리자 변경 내역이 너무 길다 | 최신 2건 + [펼쳐보기 · N건 더] / [접기], 제목에 총 건수 | `collapsible-list.tsx` |
| 10 | 확인 누르면 화면에서 안 보이게(DB는 남게) | 줄마다 [확인] — 장부는 그대로 두고 확인 표식만 새 표에 쌓아 화면에서 뺀다. 학원 공용 · 권한은 등하원 기록 축 · 감사로그 `shuttle_history_ack` | `ack-history-button.tsx` · `ackShuttleHistory` · `queries.ts` · **0293a** |

## 3. 문제 · 병목이 될 수 있는 곳

우선순위 순. ①②⑥⑧은 **고쳤다**(아래 ✅). ③④⑤⑦은 그대로다.

1. ✅ **(고침) 학부모 저장 한 번에 DB 왕복이 12~14번 줄지어 있었다**(`changeParentRideStop`). 이제 **두 단계**로 함께 돈다:
   ① 자리 확인 · 탄 기록 · 두 방향 상태(등원·하원을 한 번에) → ② 마감 · 반대 방향 자리. 반대 방향 상태를 따로 읽던 것과
   결석 하원 되살리기가 다시 읽던 것도 ①에서 읽은 걸 그대로 쓴다. 되돌리기·타지 않기·결석(두 방향 동시)·고정 시간 변경도
   같은 방식(고정 변경은 지금 고정 회차를 따로 묻던 조회를 마감 판정의 노선 조회에 합쳤다).
   대략 **차례 대기 12~14번 → 5~7번**(로그인 확인·쓰기·감사로그 포함).
2. ✅ **(고침) 셔틀 선생님이 탑승을 찍을 때마다 조회가 하나 늘었었다**(10분 규칙) — 이제 원래 하던 조회(회차·정류장 이름)와
   **같이** 돌아서 기다림이 늘지 않는다. [출발]도 회차 · 10분 규칙 · 이미 찍힌 운행 세 조회를 함께 돌린다(원래 차례로 두 번이었다).
3. **짝 규칙은 학부모에게만 걸린다** — 직원의 '일회성 변경'·노선 편성은 여전히 같은 회차에 등원·하원을 둘 수 있다.
   그렇게 만들어진 자리가 있으면 학부모는 [평소대로 되돌리기]가 막힌다(되돌아갈 자리가 규칙 위반이라서).
   실제로 로컬 김민준 수요일은 등원·하원 고정이 같은 2회차였던 적이 있다 — 본서버 데이터도 한 번 훑어볼 것.
4. **10분 규칙과 실제 운행이 어긋날 때** — 차가 예정보다 10분 넘게 일찍 떠나면 그 사이엔 [출발]·탑승을 못 찍는다.
   회차에 학원 출발 시각이 없으면 첫 정류장 시각을 쓰고, 시각이 하나도 없으면 막지 않는다.
5. **확인은 되돌릴 수 없다** — 화면엔 '확인 취소'도 '확인한 내역 보기'도 없다. 잘못 누르면 DB(`shuttle_history_acks`)에서
   그 줄을 지워야 다시 보인다. 필요하면 "확인한 것도 보기" 토글을 붙이면 된다.
6. ✅ **(고침) 파일이 커졌었다** — 나눈 결과(줄 수):

   | 전 | 후 |
   |---|---|
   | `parent-ride-actions.ts` 644 | `parent-ride-actions.ts` 293(하루 변경 · 되돌리기 · 타지 않기 · 결석) + **새** `parent-regular-ride-actions.ts` 98(고정 시간 변경) + **새** `parent-ride-guards.ts` 187(확인 규칙 전부) + **새** `parent-ride-state.ts` 129(게이트 · 상태 읽기 · 취소 · 화면 갱신) |
   | `actions.ts` 1,040 | 974 — 이번에 붙인 것(10분 규칙 · 확인 액션)을 **새** `trip-open-guard.ts` · **새** `history-ack-actions.ts`로 뺐다. 남은 974줄은 원래 있던 셔틀 편성·기록 코드라 이번 범위 밖 |
   | `queries.ts` 644 | 537 + **새** `change-history-queries.ts` 132(변경 내역 두 장부 + 확인 필터) |
   | `vehicle-route-dialog.tsx` 431 | 305 + **새** `vehicle-route-parts.tsx` 133(회차 머리 · 크게 보기 · 배지) |

   ⚠️ 규칙 파일들(`parent-ride-state` · `parent-ride-guards` · `trip-open-guard`)은 `"use server"`가 아닌 **일반 서버 모듈**이다 —
   `"use server"` 파일은 async 함수만 내보낼 수 있고([[#119]]), 거기 두면 확인 함수가 브라우저에서 부를 수 있는 액션이 된다.
7. **전체 타입체크는 여전히 못 돌렸다** — 이 PC 메모리가 모자라 `tsc` 전체가 죽는다. 대신 **바뀐 파일과 그 파일들이 가져오는 것만**
   묶어 돌린 타입체크는 **에러 0**(§6). 본서버 올리기 전 넉넉한 PC에서 `pnpm typecheck` 한 번 권장.
8. ✅ **(고침) "완료했습니다" 문구가 안 탄 아이에게도 떴다** — 운행 종료만 보고 붙여서, 미탑승·타지 않기인 날도
   "등원 완료했습니다"가 윗줄 "타지 않았어요"와 같이 섰다. 이제 **실제로 탔을 때만** 붙는다.

## 4. 바뀐 파일 (본서버로 같이 가야 하는 코드)

**새 파일**
- `src/features/shuttle/server/` — `parent-ride-actions.ts`(하루 변경 · 되돌리기 · 타지 않기 · 결석) · `parent-regular-ride-actions.ts`(고정 시간 변경) · `parent-ride-guards.ts`(탄 기록 · 자리 · 마감 · 짝 규칙 · 사유 확인) · `parent-ride-state.ts`(게이트 · 두 방향 상태 · 취소 · 화면 갱신) · `trip-open-guard.ts`(직원 출발·탑승 10분 규칙) · `history-ack-actions.ts`(변경 내역 확인) · `change-history-queries.ts`(변경 내역 조회 + 확인 필터)
- `src/features/shuttle/components/` — `vehicle-route-dialog.tsx` · `vehicle-route-parts.tsx` · `regular-ride-dialog.tsx` · `skip-ride-button.tsx` · `absent-button.tsx` · `reason-dialog.tsx` · `kst-clock.tsx` · `collapsible-list.tsx` · `ack-history-button.tsx`
- `src/features/shuttle/name-search.ts` (+ `.test.ts`)
- `src/app/(shell)/shuttle/parent-rides/_components/parent-rides-board.tsx`

**수정한 파일**
- `src/features/shuttle/parent-rides.ts` (+ `.test.ts`) — 구간 만들기 · 마감 판정 · `legRode` · `ridePairConflict`
- `src/features/shuttle/server/parent-ride-data.ts` · `server/queries.ts` · `server/actions.ts` · `server/parent-actions.ts`
- `src/features/shuttle/components/parent-ride-card.tsx`
- `src/app/(parent)/parent/rides/page.tsx` · `src/app/(shell)/shuttle/parent-rides/page.tsx`
- `src/features/audit/server/log.ts` · `src/features/audit/describe.ts` — `shuttle_history_ack` 한 줄씩

**학부모 계정 쪽(9/28 이전 — 본서버에 없으면 함께)**
- `src/app/(parent)/**` · `src/app/home/route.ts` · `src/app/(shell)/shuttle/parents/page.tsx`
- `src/features/shuttle/server/parent-viewer.ts` · `parent-access.ts` · `parents.ts` · `src/features/shuttle/parent-access.ts`
- `src/features/shuttle/components/parent-account-*.tsx`

**올리지 않는 것**: `local-setup/`(개인 테스트 전용) · `db-for-main/`(옮길 때 쓰는 복사본 — 번호 붙여 `supabase/migrations/`로 넣은 뒤 지워도 된다)

## 5. 로컬에만 남은 상태 (본서버와 무관, 알고만 있을 것)

- 로컬 DB에 **0293a를 적용**했다(확인 기능 시험용).
- 확인 시험으로 **확인 표식 1건**(로컬 관리자 · 9/30 14:41 김민준 등원 변경)이 들어가 있다 → 관리자 화면에서 그 줄이 안 보이는 게 정상.
- **김민준 수요일 등원 14:40 변경은 안 했다.** 오늘 등원·하원 둘 다 탑승 기록(시험 데이터)이 있어 학부모 화면에서도 오늘은
  못 바꾼다(§2-1 잠금). 오늘 운행이 끝난 뒤 [고정시간 변경] → 수요일 → 등원에서 14:40을 고르면 된다.
- 오늘 하원 탑승 기록(18:10 출발 회차를 17시대에 찍은 것)은 10분 규칙 **전에** 찍힌 시험 데이터라 그대로 남아 있다.

## 6. 검증

- eslint: 바뀐 파일 전부 통과(원래 있던 경고 1건 — 학부모 화면 '등하원 수정' 링크의 `aria-pressed` — 만 남음)
- vitest: 셔틀 + 감사로그 15파일 · 390개 통과(짝 규칙 4개 새로)
- 타입체크: 바뀐 파일 + 그 파일들이 가져오는 것만 묶어 `tsc --noEmit` → **에러 0** (전체는 메모리 부족 §3-⑦)
- 화면: 학부모(`parent1@local.test`) · 관리자(`admin@local.test`)로 실제 화면 확인 — 탄 구간 잠금 · 완료 문구 · 펼쳐보기/접기 · 확인 버튼(적용 전 안내 → 적용 후 줄 사라짐, 장부 줄은 DB에 그대로)
- 나눈 뒤 다시 확인(①②⑥ 이후): 학부모 수정 모드 → [등원 수정하기] → 회차 한 번 클릭으로 크게 보기, 페이지 오류 0. 저장은 누르지 않았다(로컬 데이터를 바꾸지 않으려고) — 저장 경로는 타입체크 · 테스트로만 확인

## 7. 본서버 반영 — DB 커밋 (2026-09-30)

- 저장소 `chrismathone/eywa`를 받아(`C:\Users\admin\Desktop\eywa-main-commit`) 브랜치 **`윤여원/학부모-등하원-시스템`**에
  DB 마이그레이션 4개(+ 저장소 마이그레이션 README 표 네 줄)를 커밋하고 **푸시했다**(커밋 `d114e73`). (브랜치 이름엔 띄어쓰기를 못 써서 `-`로 이었다.)
- 그 저장소 마지막 번호는 `0311a`였는데 작업 중 main에 `0312a_protect_super_admin_accounts_hardening`이 생겨 **`0313a`~`0316a`**로 매겼다 — 번호 대응은 [`db-for-main/README.md`](../db-for-main/README.md).
- 앱 코드(§4)는 이 커밋에 **없다** — DB 먼저 적용하고 코드는 따로 올린다([[#95]]).
