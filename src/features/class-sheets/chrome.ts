/**
 * ECS 상단 바의 **공용 표기** — 주간 시트와 월간 뷰가 같은 모양을 쓴다
 * (원장 2026-09-01: *"상단 헤더가 전체적으로 영어 ecs의 경우 월간과 주간 차이가 너무 심함.
 * 일관성있게 디자인 통일할 필요성이 있음."*).
 *
 * 그전까지 두 화면은 같은 일을 하면서도 다르게 생겼었다 — 주간은 카드 안에 `목록 · 노란 반 선택 ·
 * 반 정보 보기 · 주 네비 · [월간]`, 월간은 카드 없이 `평범한 반 선택 · 달 네비 · [주간|달력|진도표]`.
 * 반을 고르는 자리도, 다른 보기로 가는 문도 화면마다 달라서 "같은 반을 보는 세 가지 면"으로 안 읽혔다.
 *
 * ⚠️ 이 파일에 `"use client"`를 붙이지 말 것 — 서버 컴포넌트가 import하면 런타임에 값이 사라진다([[#81]]).
 */
import { TOOLBAR_CHIP, TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM } from "@/components/toolbar-controls";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";
import type { EcsMonthView } from "./view-prefs";

/**
 * 상단 바 한 벌. 두 화면이 같은 여백·같은 줄바꿈 규칙을 쓴다.
 *
 * 🔴 **카드 껍데기를 두지 않는다**(앱 전역 툴바 규약 — [`toolbar-controls.ts`](@/components/toolbar-controls)).
 *    원장 2026-09-01: *"지금 강사 시트 뿐만 아니라 aywa 웹앱의 모든 헤더 스타일을 일관성있게."*
 *    종전엔 `bg-card shadow-card rounded-2xl px-4 py-2.5`라 ECS만 카드 안에 툴바가 든 모양이었다.
 * 🔴 **`.toolbar-rail`을 붙이지 말 것** — 이 줄엔 반 선택 드롭다운(`SheetClassPicker` → `SearchableSelect`)이
 *    있고 그건 **Portal이 아니라 인라인 absolute**다. 레일은 모바일에서 `overflow-x:auto`라 목록이
 *    통째로 잘린다(globals.css `.toolbar-rail` 주석의 경고 그대로). 좁은 화면에선 종전처럼 감긴다.
 */
export const SHEET_BAR =
  "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-1 py-1 compact-chrome:gap-x-2 compact-chrome:px-0.5";

/**
 * 홀로 선 칩 한 벌(목록·반 정보 보기·요일·표시 토글…) — 앱 전역 [`TOOLBAR_CHIP`] 모양.
 *
 * 🔴 모양(높이 h-8 · `rounded-lg`)은 규약이 정하고 **색만 이 화면 것**이다.
 * ⚠️ 테두리는 **잉크 고정**(원장 2026-08-10 *"모든 박스에 진한 검은색 테두리"*) — 헤어라인(9%)이면
 *    흰 배경에서 "눌 수 있는 칩인지 글자인지" 구분이 안 된다(07-31 가독성 지적의 연장).
 * ⚠️ `cursor-pointer` 명시 — Tailwind v4 preflight엔 v3의 `button{cursor:pointer}`가 없어서
 *    안 적으면 클릭 가능한 버튼이 화살표로 보인다(이 앱 globals.css에도 cursor 규칙 0건).
 */
export const sheetPill = (on: boolean) =>
  `${TOOLBAR_CHIP} cursor-pointer font-bold ${
    on ? "border-primary bg-primary text-primary-foreground" : "border-line-strong text-foreground hover:bg-bg-soft"
  }`;

/**
 * 알약 글자 자리(sheet-chrome.tsx `PillGlyph` — '목록'·'반 정보 보기') — 좁은 폭(<md)은 14px 아이콘만, 넓으면 글자만.
 * 실물과 스켈레톤(sheet-chrome-skeleton.tsx)이 같은 문자열을 쓴다. 아이콘 자리 `h-[18px]`의 까닭은 PillGlyph 주석.
 */
export const SHEET_PILL_GLYPH_ICON = "flex h-[18px] items-center md:hidden";
export const SHEET_PILL_GLYPH_LABEL = "hidden md:inline";

/**
 * 이 화면의 **세그먼트 묶음**(JJ 표시/숨김 토글 — 글씨 크기는 18단계부터 `글씨: 값` 드롭다운) — 앱 전역 [`TOOLBAR_SEG_BOX`]에 잉크 테두리만 얹는다.
 * ⚠️ `border-line`(규약 기본)과 `border-line-strong`이 겹치면 승자를 CSS 순서가 정한다([[#116]]) →
 *    규약 상수에서 색만 빼고 다시 적는 대신, 여기서 **뒤에 오는 클래스로 덮지 않고** 색을 분리해 둔다.
 */
export const SHEET_SEG_BOX = TOOLBAR_SEG_BOX.replace("border-line ", "border-line-strong ");
export const sheetSegItem = (on: boolean) =>
  // 🔴 톤을 `TOOLBAR_SEG_ON_PRIMARY`로 잇지 말 것 — 그 상수엔 `font-medium`이 들어 있어 이 화면의
  //    `font-bold`와 **같은 축에서 겹친다**. 겹치면 승자를 문자열 순서가 아니라 생성된 CSS 순서가
  //    정해서 눈으로 못 읽는 버그가 된다([[#116]]). 색만 같은 값으로 다시 적는다.
  `${TOOLBAR_SEG_ITEM} cursor-pointer font-bold ${
    on ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-bg-soft"
  }`;

/**
 * 한 반을 보는 **세 가지 면** — 주간 시트 / 월간 달력 / 월간 진도표.
 *
 * 🔴 전엔 이 축이 화면마다 반쪽이었다(주간엔 `[월간]` 버튼 하나, 월간엔 3분할 세그먼트) — 주간에서
 *    진도표로 가려면 월간을 거쳐 한 번 더 눌러야 했다. 두 화면 모두 **같은 세 칸**을 그린다.
 * ⚠️ '주간'은 이 화면의 보기가 아니라 **별도 라우트**다(무거운 출결·로스터를 든 화면이라 일부러 갈라
 *    놨다 — month/page.tsx 주석). 그래서 고르면 보기가 바뀌는 게 아니라 이동한다.
 * ⚠️ `cal`·`rail`은 [`EcsMonthView`](./view-prefs.ts)와 **같은 키**여야 한다 — 아래 `Record`가
 *    그 축이 갈리면 타입에서 걸리게 잡아 준다(라벨을 빼먹으면 컴파일 실패).
 */
export type SheetFace = "week" | EcsMonthView;

export const SHEET_FACE_LABEL: Record<SheetFace, string> = {
  week: "주간",
  cal: "달력",
  rail: "진도표",
  // 🔴 EiE에선 이 면이 곧 **그 반의 달력**이다(원장 2026-09-09 *"EiE는 MP -> 달력으로. 기존 달력뷰는
  //    인재원영어에서만"*) — 두 면이 한 화면에 함께 서지 않으므로 이름이 겹쳐도 헷갈리지 않는다.
  mp: "달력",
};

export const SHEET_FACES: readonly SheetFace[] = ["week", "cal", "rail"];

/**
 * 이 반이 실제로 열 수 있는 면 — **계획(MP)은 EiE 반에만 붙는다**
 * (원장 2026-09-01: *"일단은 EiE 수업에만 적용될거고, 추후에 인재원 영어에 적용할지는 당장 결정 안 할 예정임."*).
 *
 * 🔴 판정은 호출부가 넘기는 `english_track` 한 줄이고(`readEnglishTrack(...) === "eie"`), **반 이름으로
 *    추측하지 않는다** — 이름을 고치면 분류가 조용히 뒤집힌다.
 * 🔴 여기서의 판정은 필터 칩과 달리 **정확히 일치**하는 반만 연다(미분류 반은 인재원 영어와 같은 취급).
 * 🔴 화면에서 칸을 감추는 것은 게이트가 아니다(#77) — 서버 조회·저장·인쇄가 각자 같은 판정을 한 번 더 한다.
 */
export function sheetFacesFor(isEie: boolean): readonly SheetFace[] {
  // 🔴 EiE는 **주간 + 달력(=월간 계획서)** 둘뿐이다(원장 2026-09-09: *"EiE는 MP -> 달력으로. 기존 달력뷰는
  //    인재원영어에서만"* + *"EiE는 진도표도 숨겨"*). EiE의 달력은 학부모에게 나가는 월간 계획서 그 자체라,
  //    같은 달을 세 가지로 보여 주던 옛 구성은 고를 이유 없는 갈래만 늘렸다.
  // 🔴 인재원 영어는 **종전 그대로** 주간·달력·진도표 — MP는 EiE 전용이라는 2026-09-01 결정은 불변이다.
  return isEie ? ["week", "mp"] : SHEET_FACES;
}

/**
 * 칸마다 **무엇을 여는지** 한 줄로 — 라벨 세 글자만으로는 진도표가 뭔지 눌러 봐야 안다
 * (종전 `[월간]` 버튼이 달고 있던 툴팁을 세 칸으로 나눈 것).
 */
export const SHEET_FACE_TITLE: Record<SheetFace, string> = {
  week: "그 주의 출결·태도·수업계획을 함께 쓰는 화면",
  cal: "한 달을 달력으로 — 날짜 칸을 누르면 그 날 계획을 그 자리에서 엽니다",
  rail: "한 달을 진도표로 — 영역별로 무엇을 언제 나갔는지 가로로 훑습니다",
  mp: "한 달을 달력으로 — 학부모에게 나가는 월간 계획서이자, 미리 쓴 계획과 실제 진도를 대조하는 자리입니다",
};

/**
 * 화면 언어에 맞춘 면 라벨·설명(2026-09-03 원어민 전용뷰).
 *
 * ⚠️ 위 두 `Record`는 **남겨 둔다** — `SheetFace` 타입에 면을 더하면 라벨을 빠뜨릴 수 없게 잡아 주는
 *    컴파일 가드이자 사전이 비었을 때의 바닥이다. 여기 두 함수는 그 위에 언어만 얹는다.
 * 🔴 사전 키(`face.week`…)는 `SheetFace` 값과 **같은 이름**을 쓴다 — 갈리면 새 면이 조용히 한글로 남는다
 *    (`SHEET_DICT`에 키가 없으면 타입에서 걸린다).
 */
export function sheetFaceLabel(face: SheetFace, lang: SheetLang): string {
  return sheetT(lang, `face.${face}`);
}

export function sheetFaceTitle(face: SheetFace, lang: SheetLang): string {
  return sheetT(lang, `face.${face}.title`);
}
