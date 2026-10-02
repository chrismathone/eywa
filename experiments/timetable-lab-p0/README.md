# 시간표 연습실 P0 비교 실험

운영 앱과 분리된 React/Vite 화면이다. 영어 수업 3개와 가상 학생 3명만 사용한다. 서버, 인증, DB, 구글 시트, 영속 저장은 연결하지 않았다. 새로고침하면 초기 자료로 돌아간다.

같은 연습안으로 자체 DOM 격자와 Univer 후보를 비교한다. 강사 배치 편집 → 통합표 표시 → 학생 배정 → 공통 Undo/Redo와 충돌 대안을 시험한다. 현재 첫 3개 수업은 고정 행에 연결되어 있다. 최종 강사별 시간표 화면이나 자유 수업 블록 이동의 구현 완료를 뜻하지 않는다.

## 실행

이 폴더에서 다음 명령을 실행한다. 상위 앱의 패키지 설치와 분리되며 node_modules 정션을 사용하지 않는다.

```powershell
pnpm install --frozen-lockfile
pnpm run dev
```

주소: `http://127.0.0.1:4317` — 기본은 자체 격자, 상단 Univer 탭에서 엔진 후보를 연다. `/?native=1`은 Ctrl+Home 보정만 끈 비교용 주소다.

이번 실행 환경은 Windows, Node 22.17.1, pnpm 12.8.1, Edge 154.0.4258.48이다. 핵심 빌드/시험은 이 환경에서 실행했다. 선택적 점검 도구 agent-browser 0.38.2의 manifest는 Node 24 이상을 요구하므로 새 환경에서는 Node 24 이상을 사용한다. 이 환경에서는 해당 도구의 Windows 네이티브 실행을 확인했다.

## 검증

```powershell
pnpm test
pnpm run test:browser
pnpm run build
```

브라우저 시험은 로컬 Microsoft Edge를 사용한다. 4317 포트에서 이미 실행 중인 서버가 있으면 재사용하므로 이 실험 서버인지 확인한다. `.artifacts/browser-results.json`에 기계 판독 결과를 남긴다. 생성물과 브라우저 흔적은 git에서 제외한다.

`engine-gaps.spec.ts`에는 보정 전 Ctrl+Home 실패를 유지하는 `test.fail` 1건이 있다. Playwright의 전체 성공 개수는 이 예상된 실패도 포함한다. **정상 동작 16건 통과 + 원본 엔진 실패 1건 재현**으로 구분해 보고한다.

## 구현 경계

- `store.ts`: 연습안 상태와 명령 이력 한 벌. 서식·셀 편집·학생 배정·추천 적용을 같은 순서로 되돌린다.
- `univer-history.ts`: workbook 이력을 앱 이력으로 교체한다. 확정 전 셀 내부 텍스트 입력 버퍼만 별도 native 이력을 유지한다.
- `univer-grid.tsx`: 후보 엔진의 표시 어댑터. 고정 표 범위 밖 붙여넣기는 원본을 지우기 전에 차단한다.
- `dom-grid.tsx`, `clipboard.ts`: 신뢰된 브라우저 clipboard 이벤트, TSV, 범위 원자성, 값만 붙여넣기 일부를 비교한다. HTML 실행이나 외부 ID 자동 연결은 하지 않는다.
- `constraints.ts`: 합성 자료 전용 검사/추천이다. 같은 요일 16~22시에서 10분 단위로 찾고 최종 상태를 재검사한다. 운영 검사기로 재사용하지 않는다.
- 수식은 입력식과 마지막 확정값을 분리한다. 자동 계산/복사로 시간표 의미가 바뀌지 않는다. 수식 결과 확정, 수식 값만 붙여넣기는 미완료다.
- 전체 단축키, 실제 Windows 한글 IME, Google Sheets/Excel 왕복, iframe/창 격리, 날짜 구간·분리등원·LAB 규칙은 후속 시험이다.

엔진 선정과 P1 진입은 아직 보류다. [실험 결과와 남은 통과 조건](../../docs/timetable-lab/P0-results.md)을 따른다.
