/**
 * 셔틀 화면의 **컨트롤 크기 축 — 여기 한 곳에서만 정한다.**
 *
 * 원장 제보(2026-08-20): *"셔틀 탭을 어제 만들었는데 내부 정렬 및 버튼들 레이아웃 수준이 다른 탭들에
 * 비해 떨어져."* 실측해 보니 "정렬이 떨어진다"의 실체는 **같은 성격의 컨트롤이 제각각 다른 높이·
 * 글자크기**라 한 줄에 서면 밑선이 안 맞는 것이었다 — 폰 높이 5종(`h-11`×16·`h-8`×11·`h-10`×7·
 * `h-9`×5·`h-12`×1) · 데스크톱 글자 5종(12.5·11.5·13·12·11px) · 공용 `<Button>` 14곳 ↔ 손으로 그린
 * `<button>` 18곳. 게다가 폰에서 `h-8`(32px)·`h-9`(36px)·`h-10`(40px)이 23곳 있어 **셔틀 결정의
 * "탭 타겟 44px·입력 16px"**(CLAUDE.md, 원장 2026-08-19 *"셔틀 선생님은 모바일을 대부분 이용"*)를
 * 스스로 어기고 있었다.
 *
 * 🔴 **크기를 화면 파일마다 복붙하지 말 것.** 같은 뜻의 맵이 최대 6벌로 갈렸던 팔레트 v4 정리와
 *    같은 이유다 — 한 곳을 고치면 나머지가 조용히 뒤처진다. 새 컨트롤은 여기 상수를 쓴다.
 *
 * ## 축은 하나, 역할은 넷
 * 폰 = **44px**(터치) · 입력 글자 = **16px**(iOS는 16px 미만 입력에 포커스하면 화면을 자동 확대하고
 * 되돌리지 않는다) · 데스크톱 = **한 벌**. 역할별로 어느 상수를 쓰는지만 고르면 된다.
 *
 * ⚠️ 데스크톱 한 벌의 뜻(디자인 v5 17단계 2026-09-04로 갱신): **앱 공용 control-scale**(`--control-h` 26px ·
 *    `--control-label` 18px — [`components/ui/control-scale.ts`](@/components/ui/control-scale))로 되돌아간다. 옛 값
 *    (`sm:h-8`·`sm:text-xs` = 32px·14px)은 셔틀만 다른 세 번째 크기였다. 입력 안 글자는 16px(`sm:text-sm`, 검색 입력
 *    규약), 줄 글자는 16px, 격자 안 밀도 요소(배정 칩)만 14px 예외(`SHUTTLE_DENSE_TEXT`).
 * 📱 **폰은 그대로 44px·16px** — 공용 부품(PeriodNav·HrefSelect·Button)까지 폰에서 44px이 되도록 툴바 래퍼
 *    `SHUTTLE_TOOLBAR`가 `--control-h`/`--control-label`을 좁은 폭에서 덮어쓴다(부품을 고치지 않고 변수만).
 *
 * ⚠️ 분기 기준은 `sm:`(640px)로 통일한다 — 셔틀이 이미 쓰던 경계다. 등록된 창(`ROUTE_WINDOW_SIZE.shuttle` 1180×760)은
 *    늘 `sm` 위지만, 폰과 좁게 스냅한 창은 터치 크기로 열린다(좁으면 크게).
 */

/**
 * 동작 버튼 — 공용 `<Button>`에 얹는다: `<Button variant="outline" className={SHUTTLE_ACTION}>`.
 * 폰 44px, 데스크톱은 Button 기본(control-scale `--control-h`)으로 되돌아간다.
 *
 * 🔑 `size="sm"`(h-7)·`size="lg"`를 셔틀에서 쓰지 않는 이유가 이거다 — 같은 줄에 `size="sm"`과
 *    기본 크기가 섞여 있던 자리(정류장 관리 다이얼로그의 '노선 N곳 / 수정 / 정리')가 실제로
 *    밑선이 어긋나 보이던 곳이다.
 */
export const SHUTTLE_ACTION = "h-11 sm:h-(--control-h)";

/** 아이콘만 있는 정사각 버튼(드래그 손잡이·삭제). 옆의 입력·칩과 같은 줄에 서므로 높이가 같아야 한다. */
export const SHUTTLE_ICON_BTN = "flex size-11 shrink-0 items-center justify-center sm:size-(--control-h)";

/**
 * 상태가 남는 칩·토글(필터·시즌·등하원 버튼). 라운드 캐논상 **알약**이다
 * (눌러서 상태가 남으면 칩=`full`, 동작만 하면 버튼=`lg`).
 */
export const SHUTTLE_CHIP =
  // ⚠️ `cursor-pointer`가 붙어 있는 이유: Tailwind v4가 preflight의 `button{cursor:pointer}`를
  //    **삭제**해(v3→v4 breaking change) 수제 버튼은 명시하지 않으면 화살표 커서로 남는다
  //    (공용 Button이 같은 이유로 명시한다 — button.tsx 머리 주석, 원장 지적 2026-07-29).
  "rounded-pill inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 px-3.5 text-sm font-bold whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50 sm:h-(--control-h) sm:px-3 sm:text-(length:--control-label)";

/** 켜진 칩. 🔑 `bg-primary`는 "지금 여기"(brand=자리 표시)이지 상태 색이 아니다(의미색 캐논). */
export const SHUTTLE_CHIP_ON = "bg-primary text-primary-foreground";

/** 꺼진 칩. */
export const SHUTTLE_CHIP_OFF = "border-line text-text-dim hover:bg-muted border";

/** 아직 없는 것을 더하는 칩(점선) — '+ 학생'처럼 "여기 넣을 수 있다"를 뜻한다. */
export const SHUTTLE_CHIP_ADD = "border-line text-text-dim hover:bg-muted border border-dashed";

/**
 * 입력칸 — 폰 16px(iOS 자동확대 방지) / 데스크톱도 16px(검색 입력 안 글자 규약, 원장 2026-09-04) + control-scale 높이.
 * 테두리·포커스색까지 포함한다(같은 입력이 화면마다 다른 포커스 색을 갖던 자리를 없앤다).
 */
export const SHUTTLE_INPUT =
  "border-line focus:border-primary h-11 rounded-lg border px-2.5 text-base outline-none sm:h-(--control-h) sm:text-sm";

/**
 * 줄 전체가 눌리는 것(회차 링크·검색 결과 줄·접기 머리) — 내용에 따라 세로가 늘되 **44px 아래로
 * 내려가지 않는다**. 높이를 고정하면 두 줄짜리 내용이 넘친다.
 */
export const SHUTTLE_ROW = "min-h-11 sm:min-h-(--control-h)";

/** 줄 안의 글자 — 폰·데스크톱 모두 16px(옛 데스크톱 14는 가독성 P0 아래). */
export const SHUTTLE_ROW_TEXT = "text-sm";

/**
 * 🔑 **의도된 예외 하나** — 격자 안 밀도 요소(배정 칩)의 데스크톱 글자.
 * 한 정류장에 배정이 수십 개라 12.5px로 키우면 편성 화면이 세로로 두 배가 된다(라운드 캐논도
 * "표·그리드 내부 밀도 요소"를 불변 영역으로 둔다). 폰은 예외 없이 44px·13px다.
 */
export const SHUTTLE_DENSE_TEXT = "text-sm sm:text-xs";

/**
 * 셔틀 툴바 줄 — 공용 `toolbar-rail`(좁으면 가로 레일) + 📱 **폰에서 공용 부품까지 44px**: `PeriodNav`·`HrefSelect`·
 * `<Button>`은 전부 `--control-h`/`--control-label`을 읽으므로 이 래퍼가 좁은 폭에서 변수만 덮어쓰면 부품을 고치지
 * 않고도 셔틀 44px 캐논이 지켜진다(디자인 v5 17단계 2026-09-04). 데스크톱은 앱 공용 값 그대로.
 * `SHUTTLE_PHONE_CONTROLS`는 그 변수 덮어쓰기만 — 툴바 밖(머리 `PageHeader actions`)에 같은 규칙을 걸 때 쓴다.
 */
export const SHUTTLE_PHONE_CONTROLS = "max-sm:[--control-h:2.75rem] max-sm:[--control-label:1rem]";
export const SHUTTLE_TOOLBAR = `toolbar-rail flex flex-wrap items-center gap-2 ${SHUTTLE_PHONE_CONTROLS}`;

/**
 * ## 글자 계단 — 컨트롤 밖의 텍스트도 한 벌로
 *
 * 컨트롤을 맞춰도 그 사이 텍스트가 10.5·11·12·12.5px로 갈려 있으면 여전히 "덜 다듬어진" 화면으로
 * 읽힌다(셔틀 실측이 그랬다). 그래서 셔틀 화면이 쓰는 크기를 **여덟 개로 잠갔다**:
 *
 *   (2026-09-03 앱 전역 코드모드로 `text-[Npx]`는 화면 파일에서 사라졌고 토큰만 남았다 — 이 표는 역사다.)
 *   지금(디자인 v5 17단계): 컨트롤 = 폰 16 / 데스크톱 `--control-label` 18 · 줄 글자 16 · 보조 14(바닥) · 격자 밀도 칩만 데스크톱 14.
 *
 * 🔑 이 목록을 **상수로 만들지 않은 이유**: 값을 상수로 빼도 화면 파일이 raw `text-xs`를 새로
 *    적는 것을 막지 못한다(실제 회귀는 그렇게 난다). 대신 [`control-size.test.ts`](./control-size.test.ts)가
 *    셔틀 화면 전 파일을 훑어 목록 밖 크기·44px 미만 탭 타겟을 **실패시킨다** — 죽은 색 클래스 가드와 같은 결.
 *    새 크기가 정말 필요하면 그 테스트의 목록에 **이유와 함께** 추가할 것.
 */
