# 시간표 편집기 — 로그인 없이 띄우는 시험용 화면

편집기 본체는 앱 소스 [`src/features/timetable-lab/editor`](../../src/features/timetable-lab/editor)에 있고, 운영 앱에서는 시간표의 `시간표 편집기` 버튼(`/timetable/editor`)으로 연다. 이 폴더는 그 편집기를 **가져다 띄우기만** 하는 React/Vite 화면이다 — 로그인·DB 없이 합성 예제로 브라우저 시험(Playwright)을 돌리려고 둔다. 편집기를 고치면 이 화면에도 바로 반영된다.

강사뷰는 강사별 월~토 주간 격자이며, 통합뷰는 반별 교시표와 학생 명단이다. 수업·반·회의·강사·학생 추가, 이동·복제·길이 조절·잠금, 학생 배정, 색상 변경, 추천, 불러오기를 하나의 이력으로 되돌린다. 무엇을 할 수 있는지는 [앱 통합 결과](../../docs/timetable-lab/app-integration-results.md)의 표를 본다. 이전 DOM/Univer 셀 비교 실험은 `/?compare=1`에 보존했다(`src/comparison-app.tsx`·`dom-grid.tsx`·`univer-*.ts` — 이 폴더에만 있다).

저장하지 않은 연습안은 새로고침하면 사라지므로 이탈 시 브라우저 확인을 띄운다. 연습본 저장·불러오기와 기존 시간표 읽기는 로그인이 필요해 이 화면에서는 401이 난다(아래 4320 서버에 로그인하면 된다).

## 실행

이 폴더에서 다음 명령을 실행한다. 상위 앱의 패키지 설치와 분리되며 node_modules 정션을 사용하지 않는다.

```powershell
pnpm install --frozen-lockfile
pnpm run dev
```

주소: `http://127.0.0.1:4317` — 기본은 불러오기 시작 화면. `/?sample=1`은 합성 예제, `/?compare=1`은 이전 엔진 비교, `/?compare=1&native=1`은 Ctrl+Home 보정만 끈 비교용 주소다.

실제 시간표 불러오기는 **같은 워크트리의 저장소 루트**에서 별도 터미널로 `pnpm exec next dev --hostname 127.0.0.1 --port 4320`을 실행한다. 루트 의존성과 기존 앱의 서버 환경 설정이 필요하며, 비밀 값은 Vite에 전달하지 않는다. `http://127.0.0.1:4320/login`에서 평소 계정으로 로그인한 다음 4317의 불러오기 버튼을 사용한다. 두 주소 모두 `127.0.0.1`을 사용해야 인증 쿠키가 공유된다. Vite는 읽기 API `/api/timetable/lab/source`만 4320으로 프록시한다.

계정은 시간표·반 관리 모두 지점 전체 권한이 있어야 한다. API는 세션의 지점을 사용하고 RLS를 유지한다. 가져온 데이터는 이 브라우저의 메모리에만 남으며 DB·운영 시트에 쓰지 않는다.

이번 실행 환경은 Windows, Node 22.17.1, pnpm 12.8.1, Edge 154.0.4258.48이다. 핵심 빌드/시험은 이 환경에서 실행했다. 선택적 점검 도구 agent-browser 0.38.2의 manifest는 Node 24 이상을 요구하므로 새 환경에서는 Node 24 이상을 사용한다. 이 환경에서는 해당 도구의 Windows 네이티브 실행을 확인했다.

## 검증

```powershell
pnpm test
pnpm run test:browser
pnpm run build
```

브라우저 시험은 로컬 Microsoft Edge를 사용한다. 4317 포트에서 이미 실행 중인 서버가 있으면 재사용하므로 이 실험 서버인지 확인한다. `.artifacts/browser-results.json`에 기계 판독 결과를 남긴다. 생성물과 브라우저 흔적은 git에서 제외한다.

`engine-gaps.spec.ts`에는 보정 전 Ctrl+Home 실패를 유지하는 `test.fail` 1건이 있다. Playwright의 전체 성공 개수는 이 예상된 실패도 포함한다. 편집기 35건(`customize` 13 · `editing` 6 · `library` 4 · `native` 8 · `views` 4), 이전 비교 정상 동작 16건, 원본 엔진 실패 재현 1건을 구분한다(2026-10-03 기준 전체 52건). [현재 화면 검증 기록](../../docs/timetable-lab/view-parity-results.md)에 실제 실행 결과와 한계를 적었다.

## 구현 경계

아래 파일 가운데 **이 폴더에 있는 것은 `univer-*.ts`·`univer-grid.tsx`·`dom-grid.tsx`·`clipboard.ts`·`comparison-app.tsx`(예전 셀 격자 비교)뿐**이다. 나머지(`store.ts`·`constraints.ts`·`schedule-canvas.tsx` 등 편집기 본체)는 `src/features/timetable-lab/editor`에 있고, 단위 테스트도 그쪽에서 돈다(저장소 루트의 `npx vitest run src/features/timetable-lab`). 이 폴더의 `pnpm test`는 비교 실험의 계약 테스트(`contracts.test.ts`)만 돌린다.

- `store.ts`: 연습안 상태와 명령 이력 한 벌. 서식·셀 편집·학생 배정·추천 적용을 같은 순서로 되돌린다.
- `univer-history.ts`: workbook 이력을 앱 이력으로 교체한다. 확정 전 셀 내부 텍스트 입력 버퍼만 별도 native 이력을 유지한다.
- `univer-grid.tsx`: 후보 엔진의 표시 어댑터. 고정 표 범위 밖 붙여넣기는 원본을 지우기 전에 차단한다.
- `dom-grid.tsx`, `clipboard.ts`: 신뢰된 브라우저 clipboard 이벤트, TSV, 범위 원자성, 값만 붙여넣기 일부를 비교한다. HTML 실행이나 외부 ID 자동 연결은 하지 않는다.
- `constraints.ts`: 불러온 주의 영어 배치와 타 과목 점유를 검사한다. 같은 요일 16~22시에서 10분 단위로 대안을 찾고 최종 상태를 재검사한다. 출결·합반 등 전체 운영 규칙은 아직 연결하지 않았으므로 운영 반영 검사기로 재사용하지 않는다.
- `schedule-canvas.tsx`, `block-commands.ts`, `block-clipboard.ts`: 수업 블록 이동·복사·복수 선택·삭제·키보드 커서. 잘라내기는 붙여넣기 성공 시 이동하며, 다른 자료를 불러오거나 원본 revision이 바뀌면 취소한다.
- `student-command.ts`: 선택한 교시의 학생 배정을 다른 교시로 옮긴다. 다른 요일·반·타 과목 배정은 지우지 않는다. 반 전체 이동·분리등원 재배정은 후속이다.
- `src/features/timetable-lab/server`(저장소 루트): 수업 날짜별 수강·비수업 일정의 읽기 전용 스냅샷. 기존 슬롯 조회를 공유하고 학교·상담·수업보고서 등을 읽어 전송하지 않는다.
- 수식은 입력식과 마지막 확정값을 분리한다. 자동 계산/복사로 시간표 의미가 바뀌지 않는다. 수식 결과 확정, 수식 값만 붙여넣기는 미완료다.
- 전체 단축키, 실제 Windows 한글 IME, Google Sheets/Excel 왕복, iframe/창 격리, 날짜 구간·분리등원·LAB 규칙은 후속 시험이다.

전체 단축키·운영 반영은 미완료다. 연습본 저장은 앱의 API(`/api/timetable/lab/drafts`)로 한다. 사용자 요청에 따라 기존 시간표 읽기와 수업 블록 화면을 먼저 연결했으며, 기존 [P0 통과 조건](../../docs/timetable-lab/P0-results.md)을 완료 처리한 것은 아니다.
