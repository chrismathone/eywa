# scripts/_oneoff — 일회성 스크립트 보관 규칙 (2026-11-10 · 수정 계획 P4 F6)

운영 DB를 한 번 고치거나 한 번 재 보는 스크립트를 두는 곳이다. 시험용 `server-only` 대역은 `tests/support/`로 옮겼다.
🔴 **앱·시험이 아직 이 폴더를 부르는 곳이 있다** — 운영 cron `src/app/api/cron/demo-refresh/route.ts` → `backfill-demo-history.mjs` ·
시험 `attendance/auto-units-backfill.test.ts`·`auto-units-parity.test.ts` → `math-auto-units-rules.mjs`. 이런 파일은 지우지 말 것(옮길 땐 부르는 쪽과 함께).

## 새 스크립트를 둘 때 — 파일 맨 위 주석에 다섯 줄

1. **목적** — 무엇을 왜(원장 지시·제보·리뷰 항목).
2. **실행법** — 명령 한 줄, 필요한 env(`DATABASE_URL` 등), 드라이런 기본값.
3. **적용 여부** — 운영에 돌렸으면 날짜·결과(건수). 아직이면 "미적용".
4. **다시 돌려도 안전한가** — 멱등이면 그렇다고, 아니면 왜 안 되는지.
5. **되돌리기** — 되돌리는 SQL·스크립트·백업 위치(없으면 "되돌릴 수 없음").

## 정리할 때

- **날짜만 보고 지우지 않는다.** 지우기 전에 `git grep`으로 이 파일을 부르는 곳(다른 스크립트·문서·`package.json`·tsconfig)을 확인한다.
- **남긴다**: 되돌리기 SQL·백업을 담은 것 · 지금도 부르는 도구(예: `ai-credit-mvp/`·`report-rating-v6/`의 tsconfig) · 결정 문서가 근거로 가리키는 것.
- **지워도 된다**: 적용이 끝났고(주석 3번), 되돌리기가 필요 없고(5번), 아무도 부르지 않는 것. 지운 뒤에도 git 이력에 남는다.
- 분기마다 한 번 위 기준으로 훑는다. 지운 목록은 `docs/changelog.md`에 한 줄.
