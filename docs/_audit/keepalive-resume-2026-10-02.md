# 이전 화면 유지 — 2026-10-02 재개 기록

- 원본 인계: [session-handoff-2026-10-01.md](../session-handoff-2026-10-01.md) 2-1.
- 위치: `F:\eywa-worktrees\single-view-keepalive`, 브랜치 `feat/single-view-keepalive`.
- 시작 태그: `wip/2026-10-01/single-view-keepalive` (`00444b6f9`). 통합한 main: `dfdc48c15`.
- 실제 의존성 설치 완료. `.env.local`은 로컬 파일이며 커밋하지 않는다. SQL 변경 없음.

## 검토 및 수리

이번 세션에서 직접 회귀·메시지 출처·화면 복원·포커스 이동을 검토하고, 수리한 부분을 다시 검토했다. 별도 에이전트 리뷰는 수행하지 않았다.

1. 최신 main의 같은 자리 파란 최대화/복원 버튼을 보존했다. 유지 화면을 일반 창 iframe으로 오인해 버튼을 숨기지 않는다.
2. 머리글 없는 유지 화면에도 `PageMaximizeFallbackBar`를 넣었다. 화면 높이를 flex로 나눠 복원 줄이 본문을 밀어 넘치지 않게 했다.
3. iframe의 최대화 메시지에는 부모 쪽 클릭 출처가 없다. 이 경우 부모의 다른 버튼으로 포커스를 옮기지 않게 하고 회귀 테스트를 추가했다.
4. `shell.md`와 배선 가드의 병합 충돌에서 기존 keepalive 결정과 최신 main의 버튼 동작을 모두 보존했다.

## 검증

- 대상 Vitest: workspace, page-maximize, license, server-action export, shell 자동 호출 가드, PageHeader — 45개 파일 / 527개 테스트 통과.
- 포커스 수리 후 page-maximize + keepalive-frame 재검증 — 4개 파일 / 45개 테스트 통과(신규 1개 포함).
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec tsc --noEmit` 통과. 마지막 수리 후 재실행도 통과.
- main 대비 변경 TS/TSX lint 통과. 마지막 두 파일 수리 후 lint 재실행 통과.
- 개발 서버 `/login` HTTP 200 확인. 인증된 실데이터 화면의 전환·스크롤 유지·최대화 동작은 사용자 육안 확인 대기.

## 로컬 실행 및 남은 단계

실행 주소: `http://127.0.0.1:3400`. 실행 로그는 작업 폴더의 `.dev-3400.log`, `.dev-3400-error.log`.

PowerShell 재시작 명령(위 작업 폴더에서):

```powershell
$env:NEXT_PUBLIC_DEV_WINDOW_MODE_OVERRIDE = 'keepalive'
pnpm exec next dev --port 3400 --hostname 127.0.0.1
```

사용자 화면 확인 전에는 푸시하지 않는다. 원격 WIP 태그는 유지한다. 푸시 시 최신 main을 다시 통합하고, 실제로 수정한 병합 부분을 검증한다.
