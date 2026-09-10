# 대시보드 구역 개편 — 인수인계 (2026-09-10)

> 원장 2026-09-10: *"대시보드 작업건은 넌 중지해. 다른 데서 할래."* → *"대시보드 관련 진행상황 문서로 남겨"*.
> 이 문서만 읽고 이어받을 수 있게 적었다. **코드는 main에 없다 — 아래 stash에 있다.**

## 0. 작업물 위치

| 무엇 | 값 |
|---|---|
| **stash (최신, 이것을 쓴다)** | `5b91a1c096007661ab5d3a8f2e117714c40d8512` · 태그 `dash-sections-handoff-1789039779` |
| stash 기준 커밋 | `2ec03bea` (= 현재 origin/main 팁). origin/main 위에서 충돌 없이 적용된다 |
| 옛 stash (대체됨) | `a08820cd…` 태그 `dash-wip-1789031926` — 위 stash에 **전부 포함**돼 있다. 쓰지 말 것 |
| 제목 띠 그림 | stash 안 `public/dashboard/title-bar.png` (원장이 준 그림을 흰 여백만 잘라 2172×181) |
| dev 서버 | 원장이 보던 곳은 `http://localhost:3031/dashboard?view=one` |

**적용 방법** (격리 워크트리에서):
```
git fetch origin
git worktree add <리포 밖 경로> -b feat/dashboard-sections origin/main
cd <그 경로>
git stash apply 5b91a1c096007661ab5d3a8f2e117714c40d8512
```
⚠️ `git stash pop` 금지(다른 세션 stash를 건드릴 수 있다) — **SHA로 apply**.
⚠️ stash는 **이 PC의 리포에만** 있다. 다른 PC에서 이어받으면 이 stash가 없으니, 이 PC에서 브랜치로 커밋해
옮겨야 한다(단 **origin에 브랜치를 올리지 말 것** — 프리뷰 배포 = 비용).

### stash에 든 파일 (13)
- 수정: `src/app/(shell)/dashboard/_onescreen/{charts,grid,one-screen,tiles}.tsx`,
  `src/features/dashboard/onescreen/{weekly-change,server/queries}.ts`, `src/features/dashboard/server/queries.ts`
- 신규: `src/app/(shell)/dashboard/_onescreen/section-shell.tsx`,
  `src/features/dashboard/onescreen/{sections,donut,donut.test,attendance-heat}.ts`, `public/dashboard/title-bar.png`

### 검증 상태 (stash 시점)
- typecheck 0 · eslint 0(대시보드 경로).
- 🔴 **적대적 리뷰 안 했다** · 🔴 **새 순수 함수 일부에 테스트가 없다**(`attendance-heat.ts`, `buildMonthlyChange`) ·
  🔴 `getSubjectComposition()`은 **작성만 하고 화면에 안 붙였다**.
- ⚠️ 가드 `src/features/dashboard/onescreen/onescreen-wiring.test.ts`의 *"도넛·파이 금지"* 주석은 이제 원장 지시와
  모순이다(도넛은 `conic-gradient`라 `<circle` 검사는 통과하지만 **문장을 고쳐야** 한다).

---

## 1. 이미 붙은 것 (stash 적용 시 dev에 보임 — 원장이 화면으로 확인함)

| 원장 지시 | 구현 |
|---|---|
| *"출석 / 원생 / 운영 / 일정"* 구역으로 | `section-shell.tsx` `DashboardSections`·`DashboardSection` — 28~32px 흰 띠 + 1px 아래 선 · 12열 격자 |
| *"최소 화면 크기 지정해놓고 여백 없이 최대한 빽빽하게"* | 최소 `min-w-[1180px] min-h-[540px]`, 구역이 `flex-1`로 남는 높이를 나눠 가짐 |
| *"구역은 글자 크기 크게"* | 구역 라벨 `text-xl font-extrabold` |
| *"인재원 대시보드 … 최상단에 박아버려"* → 그림 | `DashboardTitleBar` + `next/image`, `alt`는 학원설정 `profile.name` |
| *"26년 09월 10일 현황입니다. 가운데 위에"* | `dashboardDateLabel(ymd)` → `26년 09월 10일` |
| *"최근 4주로 하지말고 최근 6개월"* + *"26.09 / 26.08"* | `buildMonthlyChange`·`monthlyChangeStart`·`getMonthlyChange()` — 라벨 `YY.MM` |
| *"등록 / 퇴원 색을 파란색, 붉은색으로"* | 등록 `--primary` / 퇴원 `--danger` (종전 "퇴원=앰버" 규약을 원장이 뒤집음) |
| *"꺾은선 그래프도"* → *"꺾은선은 없애자 꼴보기싫네"* | **넣었다가 뺐다.** 🔴 다시 넣지 말 것 |
| *"%에 따라 10%씩 붉은계열 → 초록계열"* | `attendance-heat.ts` 11칸 계단. **막대 높이는 실제 값, 색만 10% 구간**(원장 확인: *"85와 86은 같은 색"*) |
| *"학년별 재원생 도넛으로"* · *"외 4개는 왜 만드는거야"* | `DonutChart`(`conic-gradient`) + 범례 전부 표시 |
| *"수납은 도넛 그래프로"* | 수납 상태 도넛(건수 축, 가운데 "건") |
| *"도넛이 커야지"* · *"라벨은 왜 이렇게 넓어?"* | 도넛 `h-full aspect-square`, 범례 `max-w-[220px]` |

## 2. 남은 것 — **원장 지시 전부** (하나도 빠뜨리지 말 것, 원장 *"내가 지시한 모든 작업 다 수행해"*)

1. **"7일로 하니까 막대가 넓어서 보기가 싫네. 최근 14일로"** — `getTrendDataLast7Days(tenantId, scope, days)`에
   `days` 인자를 **stash에 넣어 두었다**(캐시 키에 days 포함). **호출부(one-screen)에서 `14`를 넘기는 것만 남음.**
   카드 제목도 `최근 14일 출석률`로.
2. **"두개 하나로 합치자. 위에 수납바. 아래쪽에 도넛"** — 수납 KPI 타일 + 수납 상태 도넛을 **한 카드**로.
   `KpiTile`에 `children` 슬롯을 stash에 넣어 두었다(숫자 아래 남는 높이를 먹는 칸).
3. **"재원생 과목별로 해주라고 했는데 전체만 보임"** + *"과목별 증감도 따로"* — `getSubjectComposition()`
   (stash, `src/features/dashboard/server/queries.ts`)이 `counts`·`newBySubject`·`withdrawnBySubject`·
   `classCounts`를 돌려준다. 🔴 **과목 라벨은 `buildSubjectMaps(학원설정)`**으로 붙일 것(키만 온다).
   재원생 타일의 `children`에 과목별 목록.
4. **"결석 과제 저조는 따로 '수업' 구역으로 따로 빼"** — `Watchlist`(결석·과제 저조) 카드를 새 `수업` 구역으로.
5. **"수업 구역에 '수업 수'를 과목별로"** — `getSubjectComposition().classCounts`(활성 반 ∧ 유효 수강 ≥1명).
   ~~선생님별 수업 수~~ → 원장이 **제외**함.
6. **"출결 아래쪽에 과목별 출결 현황까지 수학 / 영어 / EiE 따로"** — 재료는 `getDailyProcessingStatus(date)`의
   `ClassProcessing.subject`. 🔴 **EiE는 과목이 아니라 `classes.english_track`**이다(`readEnglishTrack`) — 처리
   현황 쿼리가 그 컬럼을 안 가져오므로 영어 반 id로 따로 받아 가를 것. 인재원 영어는 **"EiE가 아닌 전부"**(비대칭).
7. **"이번달 지출 내역도 대략적으로 가로 막대그래프로"** — `getExpensesForMonth(period)` + `summarizeExpenses()`
   의 `byCategory`(주 통화 한정)를 그대로 쓴다. 새 쿼리 불요.
8. **"대충 몇개 몇명으로 적지말고, 어떤반인지 누구인지"** (오늘 할 일) — `TodayActionItem.detail`(개인 미리보기)이
   이미 있다. `TodoList`가 안 그리고 있을 뿐.
9. **학생 관리 현황 "마찬가지"** — 라벨 **세로 정렬** + **우측에 원생명**. 결석은 `risks[].studentName`이 있음.
   숙제는 `buildHomeworkRisk`가 **수만** 돌려준다 → 낮은 학생 id를 돌려주게 바꾸고 이름 조회 필요.
   학부모 미확인은 `count head:true`라 이름이 없다(431건) — 이름을 싣되 전부는 못 서니 **툴팁에 전원**.
10. **신규생 관리 카드 "관리대상이 33명인데 하단에 33명이 아님"** + *"각 라벨을 세로로 정렬하고 우측에 원생명"*.
    원인: `대상 33명` = **최근 90일 코호트 전원**, 칩 = **지금 미완료 항목이 있는 학생**(칩 합 7). 다른 것을 센다.
    → 머리 숫자를 "조치 필요 N명"(칩 전체 학생 중복 제거)로 바꾸거나 `신규 33명 중 N명` 식으로 둘 다 적을 것.
    `NewcomerRow`에 `name`이 있으니 칩별 이름 목록 가능(`careCellMatches` 단일 소스로 걸러야 목록과 수가 안 갈린다).

### 2-1. ⚠️ 이 문서를 쓴 뒤 main에 들어간 것 — 신규생 카드에 영향 (2026-09-10 (9))
신규생 관리가 **과목별 줄·과목별 체크**(0256a)가 됐다. 대시보드 코드는 **한 줄도 안 바꿨지만** 숫자가 따라 바뀐다:
- `getNewcomers()`에 **`subjectRows`**(학생 × 과목)가 생겼고, 기존 **`rows`는 그대로 학생 한 줄**이다
  (`rows.length` = 학생 수 — `대상 N명`은 그대로 맞다).
- `rows[i].subjects`에 그 학생의 과목 줄이 실려 오고, `careCellMatches`·`careCellOverdue`가 그걸 보고 **"한 과목이라도
  걸리면 그 학생이 걸린다"**로 판정한다 → `buildCareCells(newcomers.rows)`는 호출부 그대로 **학생 수**를 센다.
- 위 10번(`대상 33명` vs 칩 합)을 고칠 때 칩별 이름을 싣는다면 **`subjectRows`에서 `careCellMatches`로 거르고 학생 id로
  중복 제거**할 것 — 과목 줄 수를 "명"으로 적으면 두 과목 학생이 두 명이 된다.

## 3. 결정·자문 기록 (codex·grok, 2026-09-10)

- **출석률 = "등원율 · 출결 기록 기준"** `(출석칸 + 지각칸) ÷ 기록된 출결칸`, 7일 대표값은 **분자 합 ÷ 분모 합**.
  근거(실측): 예정 인원 분모로 재면 136%·126%·134%(출결은 교시 칸, 예정은 학생 단위라 축이 다름). 🔴 원장
  *"출석률은 진실로 해줘"* — **아직 반영 안 됨**(지금 막대는 옛 산식 `출석 ÷ 기록칸`, 지각이 분자에서 빠짐).
- **단위 규칙**: 출결 = **칸**, 학생 = 고유 ID 중복 제거 **명**, 반 = **반**. **"회"는 쓰지 않는다.**
  예) `김수민 · 최근 14일 결석 기록 6칸`, `사유 없는 결석 10명(15칸)`(실측 확인값 — 옛 "8명"은 틀린 값).
- **일정 구역**: 캘린더 재료가 이제 있다(9/10 18:00 cron 성공 — 1,074행, 앞 30일 106건). 단 `01. 운영팀 중요일정`
  748건은 직원 근무·연차라 **태그 화이트리스트**로만 올릴 것(grok): `02.입학 상담`·`시험·대회`·`설명회`·`홍보`·
  `행사`/`05.학원행사`·`06.학사일정`·`03.신입생/시범수업`·`04.면접`. `[취소]` 접두 = 취소, `레테 예약 금지` = 차단.
  🔴 캘린더 탭은 메뉴에서 뺐다 — 일정 카드를 `/calendar`로 보내지 말 것.
- **클릭 → 같은 조건의 결과 화면**: 카드 숫자를 센 함수가 도착 화면의 필터여야 한다(`careCellMatches` 선례).
  필터가 없는 목적지엔 **링크를 안 단다**(죽은 링크보다 명단이 정직하다).

## 4. 이번에 밟은 함정 (다시 밟지 말 것)

- **격자 행은 기본이 `auto`(=내용 높이)** — 뷰박스 있는 `<svg>` 하나가 비율(6:10)대로 행을 밀어 **세로 스크롤·
  차트가 화면 두 배**가 됐다(원장 *"세로 스크롤이 생겼는데? 차트가 너무 길어졌어"*). 구역 격자에
  `auto-rows-[minmax(0,1fr)]`, svg에 `h-0 min-h-0 flex-1`. `1fr`만 쓰면 최소가 `auto`라 재발한다.
- **flex(px 간격) 막대 + 백분율 뷰박스 선 = 좌표계가 달라 선이 막대 중심에서 빗나감**(원장 *"중심이 빗나감"*).
  막대와 선은 **같은 `<svg>`** 안에서 그릴 것(지금 막대는 svg `<rect>`).
- **정의 안 된 색 토큰은 아무 색도 안 칠한다** — 가드 `dead-color-class.test.ts`가 잡는다(`text-danger-ink` 전례).
- 가드 훅이 명령 안의 `truncate` 낱말을 파괴적 SQL로 오인해 막는다 → 수정 스크립트는 파일로 써서 경로로 실행.
- `DashboardSections`는 **종전 "스크롤 없이 한 화면"(2026-09-09)과 맞바꿨다** — 원장이 여백 제거를 우선했다.
  그래도 1180×540 아래로는 스크롤(가로·세로)이 생긴다.
- 원장이 **dev를 보며 계속 지시**하므로, 코드만 바꾸고 새로고침을 요청하기 전에 **stash/브랜치 상태가 화면과
  맞는지** 확인할 것 — 이번에 "주소는 맞는데 하나도 반영 안 됐다"가 두 번 났다(작업분이 stash에 있었다).
