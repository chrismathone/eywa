# 학부모 등하원 '수정하기' — 호차 전체 노선 모달 (2026-09-28)

학부모 화면 `/parent/rides`(등하원 시간 변경·확인)의 **[등하원 수정] → [등원/하원 수정하기]** 버튼에 붙인 모달 작업 정리.
로컬 테스트 저장소(`local/parent-accounts` 브랜치) 전용 작업이다.

## 1. 동작 요약

| 단계 | 화면 | 동작 |
|---|---|---|
| 1 | 카드 | [등하원 수정]을 켜면(`?edit=1`) 구간마다 [등원 수정하기]/[하원 수정하기] |
| 2 | 모달 · 회차 목록 | 누른 구간의 **호차 전체 노선**. 회차는 `1회차 · 14:30 출발`처럼 **학원 출발 시각**을 붙이고 그 순서로 정렬(등원/하원 글자 없음) |
| 3 | 모달 · 호차 전환 | 제목(`1호차 전체 노선`) 옆 `[1호차][2호차]…` 버튼으로 **다른 호차의 전체 노선** 보기. 열 때마다 지금 타는 호차부터 |
| 4 | 모달 · 크게 보기 | 회차를 **두 번 누르면(더블클릭/더블탭)** 그 회차만 크게. 정류장(학원 출발·도착 제외)을 누를 수 있다 |
| 5 | 정류장 선택 | 고른 칸에 `타는 곳 변경`(하원은 `내리는 곳 변경`) 배지. 같은 칸을 다시 누르면 취소 |
| 6 | [저장하기] | `지금 타는 곳`이 고른 칸으로 옮겨진다(다른 회차·다른 호차를 고르면 `지금 타는 회차`도 이동). "저장했어요 (시험 기능 — 학원에는 아직 전달되지 않아요)" 표시. [전체 회차 보기]로 목록 복귀 |

- 표시: 지금 타는 회차 = 테두리 + `· 지금 타는 회차`, 우리 아이 칸 = `지금 타는 곳 / 지금 내리는 곳`
- 설명 줄: 오늘이면 `오늘 · 2026년 9월 28일 (월)`, 다른 요일 칩이면 `매주 화요일 정기 일정`

## 2. 🔴 아직 안 한 것 (다음 단계)

> ✅ 2026-09-29 — 실제 DB 저장 · 이력 장부 · 고정시간 변경 · 결석/타지 않기가 붙었다 → [parent-ride-db-apply-2026-09-29.md](parent-ride-db-apply-2026-09-29.md)

- **저장은 화면 상태만** 바꾼다 — DB에 쓰지 않는다(사용자 지시 "진짜 디비까진 바꾸지말고 기능만"). 새로고침하면 원래대로.
  실제 반영 시 결정할 것: **오늘만 변경**(`shuttle_ride_exceptions`)인지 **정기 배정 변경**(`shuttle_riders`)인지, 학원 승인 절차가 필요한지.
- 저장해도 **모달 뒤 카드**의 `여기서 타요`는 바뀌지 않는다(카드는 서버 컴포넌트 — 실제 저장이 붙으면 재조회로 해결).
- [결석], [등원만 타지 않기]는 여전히 버튼 자리만.
- 학원 출발 시각이 비어 있는 회차(로컬 DB 1호차 3회차)는 출발 시각 없이 맨 뒤에 둔다(지어내지 않음).

## 3. 개인정보 · 조회 범위

- 모달 재료(`VehicleFleet`)는 **정류장 이름·시각뿐** — 다른 아이 배정·기사 연락처는 **읽지도 않는다**.
- 학부모에게 **학원의 모든 호차 노선**(정류장 이름·시각)이 보이게 됐다(사용자 요청). 보관(`archived`) 차량은 제외.
- 호차 노선은 `?edit=1`일 때만 조회 → 평소 화면 쿼리 수는 그대로. 모든 조회에 `tenant_id` 필터(admin 클라이언트).

## 4. 바뀐 파일

| 파일 | 내용 |
|---|---|
| `src/features/shuttle/components/vehicle-route-dialog.tsx` | **새 파일** — 모달(회차 목록 · 호차 전환 · 크게 보기 · 선택 · 저장). 클라이언트 상태만 |
| `src/features/shuttle/parent-rides.ts` | `RideLeg`에 `vehicleId`·`runId`, `VehicleRoute`(`departTime` 포함)·`VehicleFleet` 타입, 순수 함수 `buildVehicleRoutes` |
| `src/features/shuttle/server/parent-ride-data.ts` | `loadRideLegsFor(…, withVehicleRoutes)` → `fleet` 반환(`loadFleet`: 차량·회차·노선 칸·정류장 이름) |
| `src/features/shuttle/components/parent-ride-card.tsx` | `editing`일 때 버튼 자리를 `VehicleRouteDialog`로, `fleet`·`dayLabel` prop |
| `src/app/(parent)/parent/rides/page.tsx` | 수정 모드에서 `fleet` 조회·전달, 설명 줄 공유 |
| `src/features/shuttle/parent-rides.test.ts` | `buildVehicleRoutes` 테스트(차량별 묶음 · 출발 시각 순 · 시각 없는 회차 뒤로) |

## 5. 검증

- `vitest run src/features/shuttle` 통과(188), `eslint` 새 경고 없음, `tsc` — shuttle·학부모 파일 에러 0
  (⚠️ `pnpm typecheck` 전체는 이번 작업과 무관한 `documents/category-manager.test.tsx`, `demo-roster/*` 기존 에러로 실패한다)
- `parent1@local.test`로 Playwright 실화면 확인: 모달 열기 → 2호차 전환 → 1회차 더블클릭 → 침산초 후문 선택 → 저장 → 목록에서 `지금 타는 곳` 이동 확인

## 6. 로컬 환경 메모 (이번에 겪은 것)

- **복원 직후 학부모 로그인이 `/login`으로 튕김** — PostgREST가 dump 복원 **전에** 떠서 스키마 캐시가 비어 있었다
  (`PGRST205 Could not find the table 'public.tenants'`). 해결:
  ```bash
  echo "NOTIFY pgrst, 'reload schema';" | docker exec -i supabase_db_eywa-main psql -U postgres -d postgres
  ```
  → `local-setup/setup.ps1` 4/5 단계 끝에 이 한 줄을 넣으면 재발하지 않는다(**아직 반영 안 함**).
- `local-setup/scripts/*.mjs`는 경로가 `D:/eywa`와 다른 PC의 임시 폴더로 **고정**돼 있다 — 다른 경로에 받았으면 경로를 바꿔 실행.
- Docker Desktop을 막 켠 직후엔 `docker version`이 500을 낸다 — 잠시 뒤 정상.
- 앱 실행: `pnpm exec next dev -p 3001` → http://localhost:3001 (첫 컴파일 1분+)
