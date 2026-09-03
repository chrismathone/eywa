/**
 * 툴바(필터·컨트롤이 늘어선 줄) 공용 치수 — **단일 소스**.
 *
 * 원장 2026-09-01(등록상담 화면을 보며 연속 지시): *"헤더 감싸고 있는 테두리 제거"* ·
 * *"전체적으로 버튼높이 등을 통일"* · *"버튼 라운드 통일"* → *"라운드 덜진쪽으로 통일"*.
 * 등록상담에서 확정한 모양을 다른 탭이 그대로 따라오게 하려고 값만 여기로 뽑았다.
 *
 * 규약 세 줄:
 * 1. **툴바를 감싸는 카드 껍데기를 두지 않는다.** 컨트롤이 저마다 테두리를 갖고 있어 줄은 그대로
 *    읽히고, 아래 목록·칸이 각자 테두리를 가지면 선이 이중으로 겹쳐 보인다.
 *    ⚠️ 그 바가 `sticky`면 배경까지 빼면 안 된다 — 스크롤 내용이 비친다(`bg-background`를 남길 것).
 * 2. **높이·라벨은 [`control-scale.ts`](@/components/ui/control-scale) 한 벌**(`h-(--control-h)` 20px ·
 *    라벨 18px `leading-none`) — 공용 [`Button`](@/components/ui/button) 기본 크기와 같다. 한 줄에
 *    버튼·드롭다운·기간 네비·검색이 나란히 서므로 하나라도 다르면 줄이 울퉁불퉁하다.
 *    ⚠️ 2026-09-03: 종전 "h-8 고정"은 원장의 90% 규칙(라벨이 높이의 90%)으로 **대체**됐다 — 높이가
 *       라벨에서 도출된다. 값을 바꾸려면 globals.css `--control-*` 한 곳.
 *    🔴 세로 패딩(`py-*`)으로 높이를 만들지 말 것 — 글자 크기가 바뀌면 같이 흔들린다.
 * 3. **라운드는 덜 둥근 쪽으로.** 묶음 상자 `rounded-lg`, 그 안의 칩·링크 `rounded-md`.
 *    🔴 툴바에 알약(`rounded-full`) 묶음을 쓰지 않는다.
 *    ⚠️ 디자인 캐논의 "칩 = full"은 **본문 배지**에 대한 규칙이다(`docs/design-conventions.md` 라운드
 *       절) — 컨트롤이 늘어선 툴바는 버튼·입력과 같은 계열로 본다(캐논: 버튼/인풋 = lg).
 *
 * ⚠️ 이 파일에 `"use client"`를 붙이지 말 것 — 서버 컴포넌트가 import하면 런타임에 값이 사라진다([[#81]]).
 */

/**
 * 툴바 드롭다운 트리거 — [`FilterSelect`](@/components/filter-select)·
 * [`SearchableSelect`](@/components/ui/searchable-select)의 `triggerClassName`에 그대로 넘긴다.
 *
 * 🔴 `triggerClassName`은 기본 박스를 **통째로 대체**한다 — 배경·테두리·높이·글자를 여기서 다 정한다.
 *    반쪽만 적으면 어느 쪽이 이길지 CSS 순서가 정해서 눈으로 못 읽는 색 갈림이 된다(그 컴포넌트 주석).
 *    그래서 톤(`border-border bg-card text-foreground`)은 SearchableSelect 기본과 **같은 값**을 다시 적는다.
 */
export const TOOLBAR_SELECT =
  "border-border bg-card text-foreground flex h-(--control-h) items-center rounded-md border px-2.5 text-(length:--control-label) leading-none";

/**
 * 세그먼트(뷰 토글·기간 프리셋 등) **묶음 상자**. 안쪽 칩은 [`TOOLBAR_SEG_ITEM`].
 * 높이를 `h-8`로 고정하고 안쪽 여백(`p-0.5`)만큼 칩이 작아진다.
 */
export const TOOLBAR_SEG_BOX = "border-line inline-flex h-(--control-h) items-center gap-0.5 rounded-lg border px-0.5";

/**
 * 항목 수가 **정해지지 않은** 묶음(예: 학원설정을 따라 늘어나는 과목 칩)용 — 안에서 줄바꿈이 된다.
 * 🔴 `TOOLBAR_SEG_BOX`에 `flex-wrap`·`h-auto`를 덧붙여 쓰지 말 것: 같은 축의 유틸이 겹치면 승자를
 *    문자열 순서가 아니라 **생성된 CSS 순서**가 정해서 눈으로 못 읽는 버그가 된다([[#116]]).
 *    한 줄일 땐 `min-h-8`이 `h-8`과 같은 높이라 다른 묶음과 나란히 선다.
 */
export const TOOLBAR_SEG_BOX_WRAP =
  "border-line inline-flex min-h-(--control-h) flex-wrap items-center gap-0.5 rounded-lg border px-0.5";

/** 세그먼트 묶음 **안쪽** 칩/링크의 공통 부분 — 선택 여부에 따른 톤은 호출부가 잇는다. */
export const TOOLBAR_SEG_ITEM =
  "rounded-md px-2 text-(length:--control-label) leading-none whitespace-nowrap transition";

/**
 * 세그먼트 칩 **톤**.
 *
 * 🔴 **이 규약은 모양(높이·라운드·껍데기)만 정한다 — 색은 화면이 쓰던 것을 그대로 둔다.**
 *    등록상담 커밋(6f52d48f)도 `rounded-full → rounded-md`와 `h-8`만 바꿨지 활성 색은 안 건드렸다.
 *    그래서 톤이 **두 벌**이다: 등록상담이 쓰던 반전(ON) / 나머지 화면이 쓰던 학원색(ON_PRIMARY).
 *    ⚠️ 옮겨 붙일 때 **그 화면이 쓰던 쪽**을 고를 것 — 바꾸면 의미색 캐논(brand=primary="현재 위치")을
 *       말없이 뒤집는 색 변경이 된다.
 * ⚠️ 묶음 상자가 테두리를 가지므로 안쪽 칩에는 `border-*`를 넣지 않는다(원래 칩의 `border-primary`는
 *    상자로 올라간 것이지 사라진 게 아니다).
 */
export const TOOLBAR_SEG_ON = "bg-foreground text-background font-medium";
/** 학원색 반전 — 종전 `border-primary bg-primary text-primary-foreground font-medium`의 테두리 뺀 값. */
export const TOOLBAR_SEG_ON_PRIMARY = "bg-primary text-primary-foreground font-medium";
export const TOOLBAR_SEG_OFF = "text-text-dim hover:text-foreground hover:bg-bg-soft font-medium";

/**
 * 묶음에 안 들어간 **홀로 선 토글 칩**(예: "미수강 제외"·"퇴원 감추기"). 눌러서 상태가 남으므로
 * 칩이지만, 툴바 한 줄에 서므로 높이·라운드는 버튼 계열을 따른다(위 규약 3).
 */
export const TOOLBAR_CHIP =
  "inline-flex h-(--control-h) shrink-0 items-center rounded-lg border px-2 text-(length:--control-label) leading-none whitespace-nowrap transition";

/** 그 홀로 선 칩의 톤 — 켜짐 / 꺼짐. */
export const TOOLBAR_CHIP_ON = "border-primary bg-primary text-primary-foreground font-medium";
export const TOOLBAR_CHIP_OFF = "border-line text-text-dim hover:text-foreground hover:bg-bg-soft font-medium";

/**
 * 툴바 안 검색 입력 박스 — 공용 [`SearchForm`](@/components/search-form)이 쓰는 것과 같은 값.
 * 자기 폼을 따로 든 화면(학생목록처럼 필터 상태를 함께 커밋하는 곳)이 모양만 맞출 때 쓴다.
 */
export const TOOLBAR_SEARCH_BOX =
  "border-border bg-bg-soft text-text-dim flex h-(--control-h) items-center gap-1.5 rounded-lg border px-2 text-(length:--control-label) leading-none";
