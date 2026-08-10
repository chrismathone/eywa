/**
 * 영어 수업 시트(ECS)의 **모든 입력 박스**가 쓰는 단 하나의 치수·테두리.
 *
 * 원장 2026-08-10: *"더 컴팩트하고 더 글씨 진하게. 드랍다운 네모박스를 학생이름 크기에 맞게.
 * 모든 박스에 진한 검은색 테두리."*
 *
 * - **테두리 = `border-foreground`(잉크)** — line-strong(18%)도 흰 카드 위에선 흐려 "칸이 어디까지인지"가
 *   안 보였다(07-31 지적의 연장). 시트는 종이 표라 칸 경계가 또렷해야 읽힌다.
 * - **높이 h-6(24px)** — 학생 이름 한 줄(13px 굵게 ≈ 19px)에 맞춘 크기. 드롭다운이 쓰던 h-8(32px)은
 *   이름보다 한참 커서 한 행이 두 위계로 읽혔다.
 * - **글자 13px 굵게** — 이름과 같은 크기·굵기(옛 드롭다운은 12px 보통이라 값만 흐리게 가라앉았다).
 *
 * ⚠️ **시트 안 모든 박스가 이 상수를 함께 쓴다**(계획 셀·좌측 계획 패널·출결/태도 드롭다운·유닛·특이사항).
 *    한 곳만 따로 정하면 같은 줄에서 칸 높이가 어긋난다(원장 2026-07-23 "네모박스 크기가 너무 다름").
 * ⚠️ 이 파일은 **일반 모듈**이다 — `"use client"`를 붙이지 말 것([[#81]]: 클라 모듈의 상수를 서버가
 *    import하면 런타임 undefined가 된다).
 * ⚠️ 색·굵기를 **덧붙여 덮지 말 것**. 같은 속성을 두 번 적으면 이기는 쪽을 문자열 순서가 아니라 Tailwind가
 *    CSS를 찍은 순서가 정한다(searchable-select 선례). 그래서 뼈대(FRAME)와 색/글자를 나눠 둔다.
 */

/** 테두리·라운드만 — 글자 굵기를 스스로 정하는 칸(유닛)이 쓴다. */
export const SHEET_BOX_FRAME = "border-foreground rounded-md border";

/** 뼈대 + 시트 공통 글자(이름과 같은 13px 굵게). */
export const SHEET_BOX = `${SHEET_BOX_FRAME} text-[13px] font-semibold`;

/** 한 줄 입력칸·드롭다운 트리거 — 이름 한 줄과 같은 높이. */
export const SHEET_INPUT = `${SHEET_BOX} text-foreground focus:border-primary h-6 w-full bg-transparent px-1.5 outline-none disabled:opacity-60`;

/** 여러 줄 입력(메모) — 높이만 다르다. */
export const SHEET_TEXTAREA = `${SHEET_BOX} text-foreground focus:border-primary w-full resize-y bg-transparent px-1.5 py-1 outline-none`;

/**
 * 읽기 전용 칸 — 같은 박스에 회색 바탕이라 "여기는 못 고친다"가 모양으로 보인다.
 * (알약으로 두면 편집 가능한 줄과 높이가 달라 열이 들쭉날쭉해진다.)
 */
export const SHEET_BOX_READONLY = `${SHEET_BOX} bg-bg-soft text-text-dim inline-flex h-6 w-full items-center truncate px-1.5`;

/** 유닛 칸 — 굵기는 컴포넌트가 정한다(기본 1은 흐리게, 고치면 굵게). */
export const SHEET_BOX_UNITS = `${SHEET_BOX_FRAME} focus:border-primary h-6 w-full bg-transparent px-0.5 text-[13px]`;
