# 디자인 lint — `@shadcn/lint`

`pnpm lint`가 Tailwind 클래스의 **색과 오타**를 함께 본다(2026-10-05 도입). 이 문서는 켜진 규칙, 경고를
만났을 때 할 일, **지금 남은 경고 107건의 수정 지시**를 담는다.

## 켜진 것

| 규칙 | 수준 | 잡는 것 |
|---|---|---|
| `shadcn/no-raw-colors` | warn | Tailwind 원색 팔레트(`text-amber-700`) · 선언되지 않은 색 토큰(`bg-surface-soft`) · SVG 속성에 박은 색(`stroke="#edf0f4"`) |
| `shadcn/no-unknown-classes` | warn | Tailwind가 CSS를 만들지 않는 클래스 — 오타, 없는 토큰, 주인 없는 이름 |

- 설정은 [`eslint.config.mjs`](../eslint.config.mjs) 한 곳이고 대상은 `src/**/*.{ts,tsx}`다.
- 판정 재료는 `components.json`이 가리키는 `src/app/globals.css`다. 색은 `@theme`의 `--color-*`를 읽고,
  클래스는 설치된 Tailwind에 직접 묻는다(그래서 `globals.css`에 선택자로 정의된 클래스는 통과한다).
- 버전은 `0.2.0`으로 **고정**했다. 첫 배포가 2026-09-14인 0.x라, 올릴 때는 경고 수가 어떻게 바뀌는지 먼저 본다.
- 🔴 **패키지가 없는 `node_modules`에서는 이 규칙만 건너뛴다.** lint 첫 줄에
  `[eslint] @shadcn/lint가 설치돼 있지 않아…`가 뜨고 나머지 규칙은 그대로 돈다(안 쓰는 `eslint-disable` 주석
  경고만 함께 꺼진다). 그 상태의 "경고 없음"은 통과가 아니다 — main을 받은 뒤 `pnpm install`을 하고
  (`node_modules`를 정션으로 빌려 쓰는 워크트리는 정션이 가리키는 쪽에서) 편집기의 ESLint 서버를 다시 띄운다.
  CI에서는 건너뛰지 않고 실패한다.
- ⚠️ `eslint --cache`를 쓰지 않는다. `globals.css`를 고쳐도 안 바뀐 파일의 옛 결과가 남는다. 편집기 표시가
  안 바뀌면 ESLint 서버를 다시 띄운다.

### 일부러 뺀 곳

| 대상 | 뺀 규칙 | 까닭 |
|---|---|---|
| `src/app/(marketing)/**` · `src/app/(academy)/**` · `src/features/timetable-lab/editor/**` · `src/app/(shell)/dashboard/_instruments/**` | `no-unknown-classes` | 자체 CSS 파일로 그리는 화면이라 테마 밖 클래스가 정상이다(켜면 710건) |
| `src/app/(shell)/timetable/editor/_components/editor-skeleton.tsx` | `no-unknown-classes` | 편집기가 뜨기 전 자리 표시 — 편집기 CSS를 그대로 불러 같은 클래스(`.lab-topbar` 등)로 그려야 도착 때 줄 높이가 같다(2026-11-05) |
| `src/features/onescreen/components/report-trend-graph.tsx` | `no-raw-colors` | 학부모 보고서 그래프 — ClassNote 워커 캡처에는 앱 스타일시트가 없어 색을 일부러 hex로 적는다(파일 머리말) |
| 표식 클래스 `cf-turnstile` · `report-capture` · `tt-editing` · `ecs-slot-edge` | `no-unknown-classes`의 `allow` | 스타일 없이 이름으로만 찾는다 — 찾는 쪽은 설정의 줄마다 적혀 있다 |

## 경고를 만나면

1. **새 경고를 만들지 않는다.** 내가 고친 파일에 `shadcn/` 경고가 새로 생겼으면 그 변경에서 고친다.
   파일 하나만 볼 때는 `pnpm exec eslint "<파일>"`(전체 lint는 3~5분).
2. **색은 가까운 값이 아니라 뜻으로 고른다.** 경고가 권하는 "Nearest theme tokens"는 색 거리 기준이라
   글자색 `text-blue-500`에 틴트 `text-blue-soft`를 권하는 식으로 어긋난다. 상태·강조는
   [의미색 캐논](design-conventions.md)의 tone을, 면·선·글자는 같은 문서의 컬러 토큰 표를 따른다.
3. **표식 클래스가 걸리면** 그 이름을 찾는 쪽(스크립트·워커·선택자)이 실제로 있는지 먼저 확인한다. 있으면
   `eslint.config.mjs`의 `allow`에 한 줄 더하고 그 줄에 누가 찾는지 적는다. 없으면 지운다.
4. **예외는 그 줄에 까닭과 함께** 적는다 —
   `// eslint-disable-next-line shadcn/no-raw-colors -- <까닭>`. 폴더·파일째 끄는 것은 위 표에 줄을 더할 때만.

## 남은 경고 107건 — 수정 지시

줄 번호는 2026-10-05 기준이다. 밀렸으면 클래스 이름으로 찾는다. 위에서부터 순서대로 처리한다.

### ① 색이 안 나오는 클래스 15곳 — 버그, 먼저 고친다

아래 토큰은 `globals.css`에 **선언된 적이 없다**(`git log -S"--color-surface:" -- src/app/globals.css` 등으로
확인). 쓰인 날부터 CSS가 만들어지지 않았다. lint 경고는 14건이고, 문자열로 돌려주는 1곳은 lint가 못 본다.

| 클래스 | 자리 | 고칠 방향 |
|---|---|---|
| `text-text` | `src/app/(shell)/attendance/live/_components/desk-view.tsx:210` · `src/features/onescreen/components/english-jj-exam-picker.tsx:59`·`86` · `src/features/onescreen/components/sent-report-notice.tsx:12` · `src/features/attendance/live/seating-tone.ts:59`(lint 밖) | 기본 글자색을 뜻했으면 `text-foreground` |
| `bg-surface-soft` | `src/app/(shell)/staff/_components/staff-form.tsx:185`·`416`·`436`·`461`·`496`·`520` | 테두리 두른 흰 패널(지금 모습)이 v4 캐논과 맞다 — 클래스를 지운다. 채움이 꼭 필요하면 `bg-bg-soft` |
| `bg-surface` | `src/app/(shell)/timetable/english-sheet/attendance-migration.tsx:32`(표 머리) · `src/features/attendance/live/components/strip-slot.tsx:121` | 표 머리띠면 `bg-bg-soft`, 카드 표면이면 `bg-card` |
| `bg-success-soft` `text-success` | `src/app/(shell)/owner/_components/popups-manager.tsx:79` | 바로 아래 줄의 `bg-amber-soft text-amber`와 짝인 `bg-green-soft text-green` |

🔴 **지금 화면이 사용자가 보던 모습이다.** 색이 한 번도 칠해진 적이 없으므로 토큰을 살리면 화면이 바뀐다.
고치기 전후를 화면으로 확인하고, 색 없는 지금이 맞다면 **죽은 클래스를 지우는 것이 수정**이다.

**①을 끝낸 뒤 가드 구멍도 메운다.** [`dead-color-class.test.ts`](../src/lib/design/dead-color-class.test.ts)의
`NON_COLOR`(34행)는 `t`·`b`·`l`·`r`·`x`·`y`·`s`·`e` **한 글자로 시작하는 이름을 통째로 건너뛴다**. 그래서
`text`·`surface`·`success`가 몇 달간 통과했다. 한 글자 대안에 경계(`(-|$)`)를 붙이면 위 15곳이 잡히지만
**색이 아닌 12곳도 함께 걸린다**(2026-10-05 재현) — 같이 처리해야 CI가 통과한다.

- `border-spacing-0` 9곳: 실제 Tailwind 유틸이다. `NON_COLOR`에 `spacing`을 더한다.
- `border-radius` 2곳: `src/features/video-submit/server/oauth/done-page.ts:56`·`59`의 인라인 CSS다. `radius`를 더한다.
- `bg-bg` 1곳: `src/app/(shell)/shuttle/live/_components/live-vehicle-card.tsx:45`의 JSX 주석 속 낱말이다. 여러 줄
  주석의 이어지는 줄이라 가드의 주석 건너뛰기에 안 걸린다 — 그 주석의 표기를 바꾼다.

### ② 앱 화면의 원색 팔레트 23건 / 13파일

`src/app/(shell)/` 아래 — `newcomers/loading.tsx`(5) · `newcomers/error.tsx`(4) ·
`attendance/_components/matrix-row.tsx`(2) · `ecs/goals/_components/goals-table.tsx`(2) ·
`timetable/_components/room-panel-tables.tsx`(2) · `attendance/_components/attendance-cell.tsx` ·
`billing/_components/class-salary-row.tsx` · `billing/_components/teacher-settlement-face.tsx` ·
`classes/_components/schedule-grid.tsx` · `me/_components/report-name-card.tsx` ·
`owner/_components/session-calendar.tsx` · `timetable/_components/room-map-view.tsx` ·
`timetable/_components/room-week-panel.tsx`

- 주의 문구의 `text-amber-700`('미분류'·'산정 불가' 등)은 `text-amber`.
- `slate`·`gray` 계열은 쓰임으로 가른다 — 구분선은 `border-line`, 글자는 `text-foreground`, 표 머리띠·비활성
  채움은 `bg-bg-soft`, hover·선택 채움은 `bg-muted`. 그냥 면이면 색을 빼고 흰 면 + 테두리로 둔다(`--bg-soft`는
  면이 아니라 기능색이다).
- `newcomers/loading.tsx`는 색만 바꾸지 말고 [스켈레톤 캐논](design-conventions.md)에 맞춘다.
- 출석부 격자(`matrix-row`·`attendance-cell`)는 격자 전용 `--att-*` 팔레트가 있다. 뜻이 맞는 값이 있는지 먼저 본다.

### ③ 차트의 SVG 속성 색 4건 / 1파일

`src/app/(shell)/dashboard/_overview/charts.tsx`의 값을 `var(--color-…)`로 바꾼다.

- 163행 도넛의 빈 트랙(`stroke="#edf0f4"`) → `--color-bg-soft`(비활성 트랙).
- 278·441행 격자선(`stroke="#e2e7ed"`) → `--color-line` 계열.
- 304행 점의 `fill="white"` → `--color-card`.

### ④ 주인 없는 표식 3건

~~`payslip-doc` · `not-num`~~ 2026-11-10 효과 없는 클래스라 지움 · `toaster`(`src/components/ui/sonner.tsx:10`)는 허용 목록에(eslint.config.mjs).
저장소 안에 이 이름을 찾는 CSS·스크립트가 없다. 쓰임이 없으면 지우고, 저장소 밖에서 찾는 이름이면 `allow`에 까닭과 함께 넣는다.

### ⑤ 오탐 4건 — 줄 단위 예외

- 반 이름을 담는 prop을 클래스로 읽었다: `src/app/(share)/v/[token]/page.tsx:124`(`className`에 반 이름, 기본값 `"수업"`),
  `src/app/(shell)/students/[id]/_components/move-enrollment-button.test.tsx:24`(`currentClassName="출발 반"`, 2건).
  prop 이름이 `className`인 앞의 것은 이름을 바꾸는 편이 낫고(`classLabel` 등), 아니면 줄 단위 예외.
- 테스트 더미 클래스: `src/components/embed-link.test.tsx:50`(`chip`).

### ⑥ 보류 53건 — 결정 전에는 손대지 않는다

- **인쇄 서식 30건 / 8파일**(`src/app/(print)/**`의 `gray`·`slate`·`amber` 등). 종이는 화면 팔레트와 별개라
  이 규칙에서 뺄지 아직 정하지 않았다.
- **랜딩 목업 SVG 23건**(`src/app/(marketing)/_scroll/dashboard-mock.tsx`). 자체 팔레트로 그린 그림이다.

## 한계

- **클래스 자리가 아닌 문자열은 안 본다.** 함수가 돌려주는 문자열(①의 `seating-tone.ts`)이나, 맵에 넣어 두고
  키로 꺼내 쓰는 색이 그렇다 — `src/app/(shell)/owner/_components/session-calendar.tsx`는 원색을 쓴 13줄 중 1줄만
  경고가 난다. 전부 보려면 `no-raw-colors`의 `scanAllStrings` 옵션이 필요하다(아직 안 켰다).
- **반 이름 prop 오탐**은 이 도메인에서 계속 생긴다. 이름이 `className`으로 끝나는 prop에 문자열을 직접 적으면 걸린다.
- lint 통과는 "선언된 토큰을 썼다"는 뜻이지 "뜻에 맞는 색을 골랐다"는 뜻이 아니다.

## 다음 단계

- 한 규칙의 경고가 0이 되면 그 규칙을 `error`로 올린다. 그때부터 CI가 막는다.
- 아직 켜지 않은 규칙(도입 전 `src`를 훑은 추정치):

| 규칙 | 추정 대상 | 안 켠 까닭 |
|---|---|---|
| `no-arbitrary-values` | 약 1,220곳 / 478파일 | 절반 이상이 너비·높이이고 `text-[Npx]`는 인쇄 서식에 몰려 있다. 켠다면 `allow: ["layout"]` + 인쇄 폴더 제외 |
| `no-inline-styles` | 약 485곳 / 166파일 | 인쇄 서식과 시간표 카드의 동적 값이 대부분 |
| `no-restyle` | — | `@/components/ui` 24파일만 컴포넌트로 본다. `atoms`·툴바 등은 `componentImports`와 계약(contract)을 먼저 정해야 한다 |
