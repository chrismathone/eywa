# 모바일뷰 전수검사 (2026-09-13)

원장 지시: *"수업목록 모바일뷰가 형편없는걸. 확인해보고 수정해야하고"* · *"원생목록도 수업목록과 비슷하네"* ·
*"다른 워크트리 하나 파서 모바일뷰 전수검사하라그래"* · *"일일이 브라우저로 눌러보고 들어가야해"*.

- 방법: chrome-devtools MCP로 **390×844(iPhone 폭·터치 에뮬레이션)** 에서 화면을 하나씩 눌러 들어가 스크린샷 + 수치
  (`document.documentElement.scrollWidth`·`main.scrollWidth`·표 폭·탭 타깃 높이·입력 글자 크기)를 함께 잰다.
  스크린샷은 워크트리 밖 `C:\tmp\mobile-audit-shots\`(`D:\tmp`는 MCP 허용 루트 밖이라 못 쓴다 — 브리프의 경로와 다름).
- 데이터: 테넌트 injaewon **프로덕션 실데이터** — 저장·삭제·발송·드롭은 하지 않았다. 다이얼로그는 열어 보기만.
  ⚠️ 목록 화면의 `RememberPrefs`는 URL 필터가 저장값과 다르면 **계정 보기 설정을 저장**한다(`saveClassListPrefs`가
  `?view=cards` 방문 한 번에 돌았다 — 곧 `?view=table`로 되돌려 원래 값). 이후 검사에선 필터 URL을 손으로 치지 않았다.
- 심각도: **H** = 정보가 화면 밖·조작 불가 / **M** = 읽기·누르기가 불편 / **L** = 미관.

## 요약

| # | 경로 | 폭 | 증상 | 원인 | 심각도 | 고침 |
|---|---|---|---|---|---|---|
| 1 | `/classes` (표 보기) | 390 | 표 896px → 본문(`main`)이 가로로 스크롤. 과목·반 이름·담임까지만 보이고 강의실·요일·인원·상태·메모는 화면 밖 | `src/app/(shell)/classes/page.tsx:422` `max-md:min-w-[56rem]` — 열 머리 팝업(absolute) 때문에 `overflow-x-auto`로 못 싸서 "본문이 가로로 스크롤"을 택했던 자리 | H | ✅ `.stack-rows` |
| 2 | `/students` | 390 | 표 736px → 본문 가로 스크롤. 이름·상태까지만 보이고 과목·담당 강사·연락처는 화면 밖 | `src/app/(shell)/students/page.tsx:369` `max-md:min-w-[46rem]` (같은 이유) | H | ✅ `.stack-rows` |
| 3 | `/classes?view=cards` | 390 | 정상 — 1열 카드(366×171), 넘침 없음. 열 머리 필터 줄 2줄(56px) | — | — | — |
| 4 | `/login` | 390 | 정상 — 넘침 없음, 입력 18px·44px, 로그인 버튼 35px | — | L(버튼 35px<36) | 기록만 |
| 5 | 공통: 컨트롤 높이 | 390 | 툴바 버튼 29px·열 머리 필터 26px·행 링크 27px — 탭 타깃 36px 미만이 **앱 전역 control-scale**(라벨 18 ÷ 0.7)에서 온다 | `src/components/ui/control-scale.ts` — 원장 확정값(2026-09-08) | M | 기록만(전역 결정이라 임의 변경 안 함 — 터치 전용 승압은 원장 결정) |
| 6 | `/classes/[id]` (반 상세) | 390 | 넘침 없음. 머리 동작 버튼 7개(학생 배정·반 수정·오늘 출석 입력·임시 위임·강사 인수인계·종강·반 폐지)가 3줄로 쌓임 | v5 ⑲ "상세 머리에 동작이 셋 이상이면 Primary 하나 + 텍스트 '더보기 ▾'" 규약과 어긋남(데스크톱도 같음) | M | 기록만 — IA 변경(더보기 메뉴)은 원장 결정 후 별건 |
| 7 | `/students/[id]` (원생 상세) | 390 | 넘침 없음. 탭 9개(개요~타임라인)는 `overflow-x-auto` 레일이라 '타임라인'은 가로 스크롤로 닿음(규약대로). 머리 버튼 4개가 2줄 | — | L | 기록만 |
| 8 | `/dashboard` | 390 | 넘침 없음(세로 9,159px, 카드 20장 1열). KPI 2×3·차트·표 전부 폭 안. '상세' 아이콘 링크 41×20 | — | L | 기록만 |
| 9 | 햄버거 메뉴(MobileTopNav) | 390 | 2열 격자 23항목 × 44px, 한 화면(591px)에 들어감 | — | — | — |
| 10 | `/timetable` | 390 | 격자 3,000px은 드래그 스크롤 래퍼 안, 툴바는 `.toolbar-rail`(974px 가로 레일). 규약대로 | — | — | — |
| 11 | `/ecs` (목록) | 390 | 넘침 없음(1단 상하). '순서 이동' 손잡이 18×18 | — | L | 기록만 |
| 12 | `/ecs/[classId]` (주간 시트) | 390 | ① 왼쪽 '담임 월간계획' 패널(300px 고정)이 시트 옆에 서서 **시트 폭 54px** ② 툴바 오른쪽 묶음(출석부·JJ·글씨·저장됨·계획 패널) 470px가 안 감겨 본문 가로 스크롤(492px) | `src/features/class-sheets/components/sheet-client.tsx:913`(row) · `plan-panel.tsx:54`(`w-[300px]`) · `sheet-toolbar.tsx:171`(`ml-auto flex`) — 폭 게이트(`.sheet-too-narrow`)는 `pointer:fine`에서만 서서 터치는 그대로 받는다 | H | ✅ 폰만(`phone:`): 패널을 시트 **위에** 쌓고(`phone:flex-col`, 패널 `phone:max-h-[35vh] phone:w-full`), 격자는 `phone:flex-none` + 안쪽 스크롤러 `h-auto`로 **내용 높이만큼**(처음엔 `min-h-[65vh]`를 줬는데 65vh 상자 안에서 또 세로 스크롤이 생기는 이중 스크롤이었다 — 적대 리뷰), 툴바 묶음 `phone:flex-wrap`. 세로는 본문(main)이, 가로는 격자가 스크롤 |
| 13 | `/ecs/[classId]` 입력칸 | 390 | 시트 입력 135개가 글자 14px(`h-5`) — iOS는 16px 미만 입력에 포커스하면 자동 확대 | 시트 밀도 설계(`today-columns`·글씨 크기 프리셋) | M | 기록만 — '글씨: 크게' 프리셋(zoom)으로 완화 가능, 기본 14px 변경은 시트 열 폭 설계와 얽혀 원장 결정 |
| 14 | `/mcs` · `/mcs/[classId]/month` | 390 | 목록 넘침 없음. 월간 표 1,163px은 드래그 스크롤 래퍼 안(규약대로). '실제로' 버튼 44×22 | — | L | 기록만 |
| 15 | `/attendance` (허브) · `?mode=teacher` (강사 월별) | 390 | 넘침 없음. 월별 격자 1,398px은 드래그 스크롤 래퍼 안. '전체 접기' 16×16 | — | L | 기록만 |
| 16 | `/attendance?mode=teacher` 툴바 | 390 | 툴바 줄이 9줄(과목·강사·반 / 월 / 기간 / 보기·정렬 / 접기·검색 / 결석 통보·급여명세서 / 안내 / 통계 / 휴일)로 ~700px를 먹고 격자가 그 아래 | 툴바가 `.toolbar-rail`이 아니라 감김 | M | 기록만 — 레일 전환은 툴바 IA(원장 09-04 ⑱ 출석부 규약)와 얽혀 별건 |
| 17 | `/attendance/live` (오늘 출결) | 390 | 넘침 없음(786px 안) | — | — | — |
| 18 | `/attendance/seat/lab` (자리 출석부, 하루) | 390 | 머리 동작 줄 [출석부로][월간][랩실·JJ실][‹ 날짜 ›][과거 조회]가 한 줄 599px로 안 감겨 **본문 가로 스크롤(615px)**, 날짜 네비가 화면 밖 | `src/app/(shell)/attendance/seat/[seat]/page.tsx:220` `flex items-center` (월간 면도 같음 `month/page.tsx:98`) | M | ✅ `flex-wrap`(두 줄 64px, 넘침 0). 교시 칩 줄은 이미 `.toolbar-rail`, 이름 칸은 `fluidNameFontSize` 24px — 정상 |
| 19 | `/lesson-reports` (수업보고서) | 390 | 넘침 없음 — 표 2개(560·760px)는 드래그 스크롤 래퍼 안, 면 탭 줄은 가로 레일(577px). 체크박스 14px | — | L | 기록만 |
| 20 | `/class-review` (수업 평가) | 390 | 넘침 없음 — 표 720px은 드래그 스크롤 래퍼 안 | — | — | — |
| 21 | `/exams` (성적관리) | 390 | 넘침 없음. 기간 `date` 입력 2개가 14px(iOS 자동 확대) | 필터 폼 입력 크기 | L | 기록만 |
| 22 | `/consultations` (원생상담 목록) | 390 | ① 행 격자(이름·과목·요약·오른쪽 고정 4열)의 최소 폭 35.25rem이라 오른쪽 열 324px가 행 밖으로 나가 **본문 가로 스크롤(620px)** ② 필터 드롭다운 5개가 건수 옆 74px 열에 한 줄씩 세로로 쌓임(5줄) | `src/app/(shell)/consultations/page.tsx` 행 `grid-cols-(--row-cols)`(L399) · 필터 묶음 `flex-1`(basis 0, L217) | H · M | ✅ 폰만(`phone:` 변형 — 🔴 이 창은 기본 크기 760px이라 `max-md:`면 데스크톱 창까지 접혔다, 적대 리뷰): 행을 [이름 | 과목·상담사] / [카테고리 · 후속 · 녹음·AI · 시각] 두 줄(격자 2열 + 오른쪽 블록 `col-span-2`) · 열 제목 줄 `phone:hidden` · 필터 묶음 `phone:basis-full`(제 줄로 내려 전폭 감김) · `AutoPageSize`가 행 높이를 실제 첫 행에서 재도록(상수 45로 세면 71px 행이 한 쪽을 1.6배 넘겼다). 실측 후 행 71px 2줄 · 넘침 0 |
| 23 | `/consultations/[id]` (상담 상세) | 390 | 넘침 없음 | — | — | — |
| 24 | `/enrollment` (콜&상담 칸반) | 390 | 4칸 보드 1,040px는 `overflow-x-auto` 가로 스크롤(규약 "다열 보드 폰은 가로 스크롤") | — | — | — |
| 25 | `/enrollment?view=table` (목록뷰) | 390 | `.consult-sheet` 카드 스택(행 487px) — 기존 규약대로 | — | — | — |
| 26 | `/newcomers` (신규생 관리) | 390 | 표 960px는 드래그 스크롤 래퍼 안이지만 **등록일·첫 수업 열의 날짜 글자가 옆 칸 위로 겹침**(`26.09.10`+`26.09.14` — 등록일 7% = 59px 가용 < 날짜 65px). 표가 최소 폭일 때(폰·좁은 창) 항상 | `src/app/(shell)/newcomers/_components/newcomer-table.tsx:54-55` 열 % | M | ✅ 등록일 7→9% · 첫 수업 11→12%(항목 열이 각 0.4%p 좁아짐). 상단 현황 줄은 `.toolbar-rail` 가로 레일(정상) |
| 27 | `/retention` (이탈 방어) | 390 | 넘침 없음. 면 탭 줄 400px 가로 레일 | — | — | — |
| 28 | `/withdrawals` (퇴원관리) | 390 | 넘침 없음. 행 45px 1열 | — | — | — |
| 29 | `/staff` (직원관리) | 390 | 표 2,051px(볼 열 선택형)은 드래그 스크롤 래퍼 안 — 규약대로 | — | — | — |
| 30 | `/billing` (수납) | 390 | 표 1,384px 드래그 스크롤 래퍼 안 · 면 탭 줄 629px 가로 레일 · KPI 2열 · 배너 정상 | — | — | — |
| 31 | `/billing?tab=` 교재·지출·수강료 계산기·회차 확정·시수 검증·환불 요청서 | 390 | 넘침 없음 — 표(800·1,000·860·672·732px)는 전부 드래그 스크롤 래퍼 안. 회차 확정 입력(계획·단가) 14px | — | L | 기록만 |
| 32 | `/staff/[id]` (직원 상세) | 390 | 넘침 없음. 이력서 표는 `.resume-sheet` 카드(기존 규약). 계약 `date` 입력 14px | — | L | 기록만 |
| 33 | `/shuttle` · `/shuttle/today` · `/shuttle/live` · `/shuttle/track` | 390 | 넘침 없음(오늘은 일요일이라 등하원 명단 0명 — 명단 있는 날은 미검사) | — | — | — |
| 34 | `/inventory` (재고관리) | 390 | `.stack-table` 카드 스택(기존 규약). 자산 126대가 세로 74,301px — 폰에선 매우 긴 한 페이지 | 카드 스택 설계 | L | 기록만 |
| 35 | `/meetings` · `/meetings/[id]` | 390 | 넘침 없음. 행 44px, 상세 머리 Primary+더보기 규약대로 | — | — | — |
| 36 | `/approvals` · `/documents` | 390 | 넘침 없음(문서 표 849px는 스크롤 래퍼 안) | — | — | — |
| 37 | `/owner` + 11면 | 390 | 넘침 없음. 표(역할·권한 598 · 감사로그 973 · 연동 710px)는 스크롤 래퍼 안. 설정 폼 입력 다수가 14px(감사로그 검색·연동 시트 ID·file) | 폼 입력 크기 | L | 기록만 |
| 38 | `/help` · `/help/icons` | 390 | 넘침 없음 | — | — | — |
| 39 | `/menu` | 390 | 폰에선 `/dashboard`로 감(메뉴 판은 데스크톱 층) — 햄버거 메뉴가 그 자리 | — | — | — |
| 40 | `/students/new` · `/classes/new` | 390 | 넘침 없음. 입력 전부 16px, 하단 고정 저장 바가 화면 안(y 790~844) | — | — | — |
| 41 | `/timetable?view=teacher·integrated` | 390 | 격자(3,506·2,249~3,569px)는 드래그 스크롤 래퍼 안, 툴바 레일 — 규약대로 | — | — | — |
| 42 | `/ecs/[classId]/month` (달력·MP) | 390 | 815px 표는 스크롤 래퍼 안 | — | — | — |
| 43 | `/students/[id]?tab=` 수업·성적·진도·출결·상담·메모·수납·타임라인 | 390 | 8면 전부 넘침 없음. 표(848·720·607·415px)는 스크롤 래퍼 안. 성적 탭 입력(date·select·시험명) 14px | — | L | 기록만 |
| 44 | 알림 벨 메뉴 · 사용자 메뉴 | 390 | 팝업 366px 화면 안 | — | — | — |
| 45 | 비로그인: `/seat/lab`·`/seat/jj`(PIN) · `/intake/ZZTESTOWNER01` · `/inventory/asset/DT-001` · `/r/…`(만료·중단) · `/kiosk` | 390 | 전부 넘침 없음. PIN 입력 24px·56px, 입장 48px. QR 접수 폼 입력 25개 전부 16px, 세로 3,815px | — | — | — |
| 46 | 원생목록·수업목록 | **360** | 두 줄 카드 유지 · 상태 알약 같은 줄 · 넘침 0 | — | — | — |

## 데스크톱 회귀 확인(1280×800, 마우스)

- 원생목록: 표 셀 `table-cell`·열 머리 가운데·`th` 라벨 표시·사이드바 렌더 — 변경 전과 같음(스크린샷 `students-1280-after.jpeg`, 온보딩 안내가 위에 떠 있음).
- ECS 주간 시트: 행 방향 `row`, 계획 패널 300px 옆, 툴바 오른쪽 묶음 `nowrap` 한 줄(478px), 패널 max-height 없음.
- 원생상담: 행 44px·4열 격자, 제목 줄 표시, 필터 묶음 `flex-basis 0%`(건수 옆 한 줄).
- 나머지(`max-md:`·`.stack-rows` 768px 미만 한정)는 정의상 768px 이상에 닿지 않는다.

## 미검사·한계

- **강사뷰**(원스크린 `/onescreen` · 출결 모드 `/attendance/quick` · MCS/ECS를 강사로) — 관리자 계정은 `/onescreen`이 운영실로, `/attendance/quick`은 404(담당 반 없음). '다른 강사 뷰' 진입로는 **사이드바에만** 있어 폰(햄버거·사용자 메뉴)엔 없다 → 강사 계정 로그인이 필요해 이 세션에선 못 봤다. (강사뷰 미니셸은 09-04 ㉔에서 PeriodNav·드롭다운으로 정리된 상태.)
- **`/r/[token]` 살아 있는 보고서 카드** — 방문만으로 `share_link_views`(학부모 열람 기록)가 쌓여(`x-eywa-internal` 헤더 없음) 실데이터를 건드리므로 만료·중단 화면만 봤다.
- **셔틀 오늘 등하원 명단 있는 날**, **랩실 실제 출결 찍기**, **다이얼로그 제출**은 프로덕션 실데이터라 열지 않았다(반 상세 '학생 배정'은 폰에서 버튼 클릭이 다이얼로그를 띄우지 않았다 — 창 트리거라 폰 경로가 다른 듯, 미확인).
- **iOS 실기기 자동 확대**(입력 16px 미만)는 에뮬레이션으로 재현이 안 되어 글자 크기 수치로만 기록했다(L 항목들).
- 검사 중 dev 서버가 메모리 임계로 스스로 재시작한 뒤 `(seat)`·`(intake)`·`(asset)`·`(share)` 라우트 그룹이 404를 냈다 — `.next/dev`를 지우고 다시 띄우니 정상(코드 문제 아님, dev 캐시).
- dev 로그의 기존 경고(이번 변경과 무관): ECS SSR `No QueryClient set`(CommandPalette useQuery, 1회) · 콜&상담 칸반 `ConsultationCard`의 Base UI `DropdownMenuTrigger nativeButton` 경고.

## 게이트

- eslint(변경 TSX 10개) 0 · vitest: control-scale·design 가드·toolbar-canon·class-sheets·newcomers·consultations·seat = 84파일 969건 중 968 통과, 1건(`dead-color-class` 파일 스캔 가드)은 묶음 실행에서 타임아웃 헛실패 → 단독 재실행 통과(기억 규약 "가드 헛실패는 단독 재실행으로 판별") · 서빙 CSS에 `.stack-rows` 22규칙 확인.
- 전체 typecheck(`tsc --noEmit`, 힙 8GB): 오류 0 · 종료 코드 0 · OOM 문구 없음.
- 적대적 리뷰 2회(1차 `.stack-rows` 2렌즈 · 2차 전체 2렌즈) + 고친 부분 재리뷰 1회 — 지적 반영: primary `flex:1 1 0%` · 강의실/요일 `data-empty` · `main:not(.embed-main)` 스코프 · `th[data-cell=label]` · **`phone:` variant(창 안 `max-md:` 오발동, H)** · `max-md:min-w-*` 복원 · AutoPageSize 실측 행 높이 · ECS 이중 스크롤 제거 · 주석 숫자.
- 창 조건 검증(760px 뷰포트에 `embed-main` 마커를 붙여 흉내): 원생상담 행 44px·4열·제목 줄 표시·필터 basis 0% / 원생목록 표 736px(`min-width:736px`)·td `table-cell`·main 가로 스크롤 765px — 마커 없이는 같은 폭에서 폰 배치. 즉 창은 종전, 폰만 접힌다.
- ⚠️ `globals.css`를 만졌으니 **푸시 전 `pnpm build`**(CSS 문법은 typecheck·lint·vitest가 안 본다 — 기억 규약). dev 파이프라인은 컴파일·서빙까지 확인했다(`.stack-rows` 22규칙 · `phone:` 17규칙).

## 고침 1·2 — `.stack-rows`: 열 머리는 필터 칩 줄, 행은 두 줄 카드 (폰 <768px)

두 표는 **열 머리가 곧 필터**(`HeaderFilter`, 팝업이 트리거 아래 absolute)라 다른 표처럼 `DragScrollArea`/`overflow-x-auto`로 쌀 수
없고(팝업이 잘린다), 기존 `.stack-table`(재고관리)은 `thead`를 통째로 숨겨 폰에서 필터가 사라진다. 그래서 같은 어법의 변형을
`globals.css`에 신설했다:

- `.stack-rows`(`@media screen and (max-width: 767.98px)`, unlayered): `table/thead/tbody`를 block, `colgroup` 숨김, `tr`을 `flex-wrap`.
  - 열 머리: `th`가 block이 되어 필터 트리거들이 한 줄(넘치면 두 줄)로 흐른다. 열 이름 글자만 있는 머리(`data-cell="label"`)는 감춘다.
  - 행: `data-cell="lead"`(앞 알약) · `primary`(이름, 남는 폭) · `status`(오른쪽 끝) = 첫 줄 / 나머지 칸 = 둘째 줄(원래 순서) / `wide` = 셋째 줄.
    `tr::after`(flex-basis 100%, order 2)가 줄바꿈 역할. 빈 칸(`data-empty="true"`)은 감춘다.
  - 경계 767.98px = 표의 옛 `max-md:min-w-*`가 걸리던 폭. 768~1023(태블릿 세로)은 표가 그대로 들어간다(원생 5열 736px ≤ 본문 744px).
- 페이지: `stack-rows` 스코프 + `data-cell`/`data-empty` 표식만 더했다. `max-md:min-w-*`는 **남긴다** — 창(iframe)을 768 아래로 스냅하면 `.stack-rows`가 안 걸리고(창 제외) 이 값이 종전대로 표 + 가로 스크롤을 지킨다(적대 리뷰: 지웠더니 창 안에서 열이 압축됐다). 데스크톱(≥768)은 한 글자도 안 바뀐다.
- 🔴 규칙은 **최상위 프레임에서만**(`main:not(.embed-main)`) — 창 안은 v5 ④ "열 유지" + `WindowMinSizeNotice` "가로 스크롤로" 안내가 결정. 같은 축을 화면 파일에서 유틸로 쓰는 `phone:` 커스텀 variant(`screen` ∧ <768 ∧ `.embed-main` 밖)를 globals.css에 신설 — 원생상담·ECS가 쓴다(원생상담 창 기본 760px이라 `max-md:`면 데스크톱 창이 접혔다).
- 공용 부품 변경: `src/components/header-filter.tsx`는 **주석만**(동작 불변). `HeaderFilter` 소비처 = classes/page.tsx · students/page.tsx · classes/_components/header-day-filter.tsx(3곳). `src/components/auto-page-size.tsx`는 행 높이를 `rowPx` 상수 대신 **실제 첫 행에서**(`max(rowPx, 실측)`) 재도록 — 소비처는 원생상담 하나, 데스크톱 실측 = 45 = 상수라 종전과 같다.
- ⚠️ 이 문서의 `파일:줄`은 **패치 전(HEAD) 줄 번호**다 — 작업트리에선 주석이 붙어 줄이 밀렸다.

## 검사 진행 로그

(아래는 화면별 상세 — 요약표에 없는 정상 항목도 "본 화면"으로 남긴다.)

- `/login` 390: OK.
- `/classes` 390: H(#1) → 고침.
- `/classes?view=cards` 390: OK.
- `/students` 390: H(#2) → 고침.
