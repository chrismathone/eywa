# 대시보드 편집기 — 2026-10-02 재개 기록

- 원본 인계: [session-handoff-2026-10-01.md](../session-handoff-2026-10-01.md) 2-2.
- 위치: `F:\eywa-worktrees\dashboard-builder`, 브랜치 `feat/dashboard-builder`.
- 시작 태그: `wip/2026-10-01/dashboard-builder` (`d00d3f5c1`). 통합한 main: `dfdc48c15`.
- 역할별 시안은 이 편집기에 포함되어 있으므로 별도 시안 작업은 재개하지 않았다.
- 실제 의존성 설치 완료. `.env.local`은 로컬 파일이며 커밋하지 않는다.

## 검토 및 수리

이번 세션에서 직접 권한 우회·역할 전환 상태 경쟁·집계 중복·입력 취소·이벤트 정리를 검토하고, 수리한 부분을 재검토했다. 별도 에이전트 리뷰는 수행하지 않았다.

1. 드래그의 실제 화면 좌표를 capture 단계에서 읽는다. DOM에서 떨어진 터치 대상에도 추적기를 달고, 처음 누른 손가락만 추적한다. 종료·언마운트 때 이벤트와 대기 타이머를 정리한다.
2. 역할별 캔버스를 다시 마운트하고 commit 콜백에 역할을 고정했다. 늦은 이벤트와 이전 역할의 복원 토스트가 현재 역할의 편집·선택을 덮지 않는다.
3. 크기 조절은 시작한 pointerId만 처리한다. pointercancel/Escape는 취소하고, 다른 포인터의 종료는 무시한다.
4. 마지막 실제 카드를 보호하면서 구역 제목은 제거할 수 있다. 추가 상한을 UI에서도 지키며 키보드 처리와 드롭 대상 코드를 분리했다.
5. 여러 담당 과목의 학생 수를 과목별 단순 합 대신 배타적인 과목 조합으로 계산했다. 요약 카드에도 '학원 전체' 범위를 밝힌다.
6. 서버 저장의 원장/총괄 제한과 tenant별 저장·캐시 무효화를 검증했다. 직접 REST PATCH 우회는 새 DB 트리거로 차단하도록 준비했다.
7. 개발 전용 하네스는 합성 데이터만 사용하며 폼 submit을 차단한다. preview 차트 변경도 서버 저장을 호출하지 않는다. 프로덕션에서 하네스는 notFound 처리한다.

## 검증

- 대상 Vitest: dashboard layout/overview, editor hooks/geometry, owner schema/diff/resolve/preset/save, toolbar 및 server-action export 가드 — 37개 파일 / 383개 테스트 통과.
- 마지막 분리 수리 후 editor + narrow + navigation-save — 6개 파일 / 29개 테스트 재통과.
- 8GB `tsc --noEmit` 통과, 코드 분리 후 재검증도 통과.
- main 대비 변경 TS/TSX lint 통과. 최종 편집기/하네스 lint 오류·경고 없음.
- 실제 Chromium 샘플 검사: 마우스 순서 변경, undo, 크기 조절, 삭제/복원, 갤러리 추가, 390px 모바일 목록/가로 넘침 없음, 터치 길게 눌러 이동, 새로고침. pageerror 없음.
- 샘플에서 저장 버튼을 키보드로 실행했을 때 POST 요청 0개 확인. 1024px 화면에서는 기존 React Query 개발 도구 버튼이 저장 버튼 위에 겹쳐 마우스 검사만 키보드로 전환했다.
- 실제 로그인 계정의 저장·재조회는 자동으로 실행하지 않았다. DB 트리거는 SQL 검토만 했으며 운영 DB에서 실행·검증하지 않았다.

## 로컬 실행 및 운영 반영 순서

- 실제 설정: `http://127.0.0.1:3500/owner?tab=dashboard` (원장/총괄 로그인 필요).
- 로그인 없는 샘플: `http://127.0.0.1:3500/dev/dashboard-harness` (변경 저장 안 됨).
- 로그: `.dev-3500.log`, `.dev-3500-error.log`.
- 재시작: 이 작업 폴더에서 `pnpm exec next dev --port 3500 --hostname 127.0.0.1`.

사용자 화면 확인 뒤 운영 공개 전에 `supabase/migrations/0327a_dashboard_settings_guard.sql`을 수동 적용하고 권한별 DB 쓰기를 검증해야 한다. 기존 0281a 가드는 유지하며, 새 트리거는 dashboard 값이 바뀌는 UPDATE에만 추가로 작동한다. 행·컬럼 추가는 없다.

현재 푸시하지 않았다. 최신 main 재통합 → 변경분 검증 → main 반영 순서를 유지하고, 원격 WIP 태그는 실제 반영 후 정리한다.
