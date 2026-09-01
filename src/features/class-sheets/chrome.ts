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
import type { EcsMonthView } from "./view-prefs";

/** 상단 바 한 벌(카드). 두 화면이 같은 여백·같은 그림자·같은 줄바꿈 규칙을 쓴다. */
export const SHEET_BAR =
  "bg-card shadow-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-2.5";

/**
 * 알약 한 벌(목록·반 정보 보기·요일·표시 토글…).
 * ⚠️ `cursor-pointer` 명시 — Tailwind v4 preflight엔 v3의 `button{cursor:pointer}`가 없어서
 *    안 적으면 클릭 가능한 버튼이 화살표로 보인다(이 앱 globals.css에도 cursor 규칙 0건).
 * ⚠️ 테두리는 **잉크 고정**(원장 2026-08-10 *"모든 박스에 진한 검은색 테두리"*) — 헤어라인(9%)이면
 *    흰 카드 위에서 "눌 수 있는 알약인지 글자인지" 구분이 안 된다(07-31 가독성 지적의 연장).
 */
export const sheetPill = (on: boolean) =>
  `shrink-0 cursor-pointer rounded-full border px-2.5 py-0.5 text-[12px] font-bold transition ${
    on
      ? "border-primary bg-primary text-primary-foreground"
      : "border-line-strong text-foreground hover:bg-bg-soft"
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
  mp: "계획(MP)",
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
  return isEie ? [...SHEET_FACES, "mp"] : SHEET_FACES;
}

/**
 * 칸마다 **무엇을 여는지** 한 줄로 — 라벨 세 글자만으로는 진도표가 뭔지 눌러 봐야 안다
 * (종전 `[월간]` 버튼이 달고 있던 툴팁을 세 칸으로 나눈 것).
 */
export const SHEET_FACE_TITLE: Record<SheetFace, string> = {
  week: "그 주의 출결·태도·수업계획을 함께 쓰는 화면",
  cal: "한 달을 달력으로 — 날짜 칸을 누르면 그 날 계획을 그 자리에서 엽니다",
  rail: "한 달을 진도표로 — 영역별로 무엇을 언제 나갔는지 가로로 훑습니다",
  mp: "학부모에게 나가는 월간 계획서 — 미리 쓴 계획과 실제 진도를 나란히 대조하고 인쇄합니다",
};
