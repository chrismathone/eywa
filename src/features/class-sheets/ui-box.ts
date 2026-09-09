/**
 * 영어 수업 시트(ECS)의 **모든 입력 박스**가 쓰는 단 하나의 치수·테두리.
 *
 * 원장 2026-08-10: *"더 컴팩트하고 더 글씨 진하게. 드랍다운 네모박스를 학생이름 크기에 맞게.
 * 모든 박스에 진한 검은색 테두리."*
 *
 * - **테두리 = `border-line-strong`(18%)** — 칸 경계는 보이되 잉크는 아니다.
 *   ⚠️ 2026-08-10에 원장이 *"모든 박스에 진한 검은색 테두리"* 라고 한 **'박스'는 이 입력칸이 아니라
 *   수업(교시) 카드**였다(*"사진 하나가 수업카드 1개"* — 같은 날 정정). 잉크 테두리는 카드 외곽선
 *   ([period-block.tsx](./components/period-block.tsx))에 있다. **여기 칸마다 잉크를 다시 두르지 말 것** —
 *   15행 × 5열이 전부 검은 격자가 되면 정작 카드 경계가 안 읽힌다.
 * - **높이 h-5(20px)** — 원장 2026-08-10 2차: *"드랍다운 박스를 더 줄여봐. 이름 사이즈가 행너비와
 *   같으면 좋겠는데"* → 박스 높이를 **이름 글자 한 줄(13px ≈ 19px)** 까지 내려 행 높이가 곧 이름 크기가
 *   되게 했다(h-8 32px → h-6 24px → h-5 20px). 행 세로 여백도 1px(`py-px`)뿐이다.
 * - **글자 13px 굵게** — 행 안의 **모든** 글자가 같은 크기(이름·드롭다운·유닛·특이사항·퇴원일).
 *   섞이면 같은 줄이 두 위계로 읽힌다(원장 "이 행은 모든 글자 크기 통일").
 *   유일한 예외 = **영어이름**(2026-08-17): 괄호 병기를 접고 이름 아래 둘째 줄 11px dim으로 내렸다
 *   (원장 "영어이름 깔끔하게" — 보조 표기라 첫 줄과 위계를 일부러 가른다, roster-slot-cells).
 * - **라운드 `rounded-sm`** — 20px 박스에 6px 라운드는 알약처럼 보인다(밀도 높은 표의 캐논이 sm).
 *
 * ⚠️ **시트 안 모든 박스가 이 상수를 함께 쓴다**(계획 셀·좌측 계획 패널·출결/태도 드롭다운·유닛·특이사항).
 *    한 곳만 따로 정하면 같은 줄에서 칸 높이가 어긋난다(원장 2026-07-23 "네모박스 크기가 너무 다름").
 * ⚠️ 이 파일은 **일반 모듈**이다 — `"use client"`를 붙이지 말 것([[#81]]: 클라 모듈의 상수를 서버가
 *    import하면 런타임 undefined가 된다).
 * ⚠️ 색·굵기를 **덧붙여 덮지 말 것**. 같은 속성을 두 번 적으면 이기는 쪽을 문자열 순서가 아니라 Tailwind가
 *    CSS를 찍은 순서가 정한다(searchable-select 선례). 그래서 뼈대(FRAME)와 색/글자를 나눠 둔다.
 */

/**
 * 시트 행의 글자 — 이 크기 **하나만** 쓴다(이름·드롭다운·유닛·특이사항·영어이름·퇴원일 전부).
 *
 * 🔴 2026-09-08 `text-sm`(16px) → `text-xs`(**14px**). 타입 스케일 v5가 시트 본문을 14→16px로 올리면서
 *    오늘 면의 칸 예산이 무너졌다(출결 52px에 필요 68 · 태도 76px에 필요 94). **폭만으로는 못 푼다** —
 *    42px을 더하면 교시 3열이 한 화면에 안 들어간다(3×448+24 = 1368 > 가용 1330, 2026-08-17 결정).
 *    그래서 본문만 앱 기본선인 14px로 되돌린다(원장 2026-09-08, *"글자 크기가 너무 다양해지면 별로"*에
 *    대해 **새 크기를 만들지 않는 안**으로 확정). 14px = `--text-xs`로 이미 앱 전역이 쓰는 토큰이다.
 * ⚠️ 이 값을 올릴 땐 [today-columns](./lib/today-columns.ts)의 칸 예산을 **함께** 볼 것 — 그 둘이 갈린 것이
 *    이번 사고다. 올리면 `todayNoteWidth ≥ 100` 가드에서 걸린다.
 */
export const SHEET_TEXT = "text-xs";

/** 테두리·라운드·높이만 — 글자 굵기를 스스로 정하는 칸(유닛)이 쓴다. */
export const SHEET_BOX_FRAME = "border-line-strong rounded-sm border h-5";

/** 뼈대 + 시트 공통 글자. */
export const SHEET_BOX = `${SHEET_BOX_FRAME} ${SHEET_TEXT} font-semibold`;

/**
 * 한 줄 입력칸·드롭다운 트리거 — 이름 한 줄과 같은 높이(20px).
 * 🔴 **바탕은 흰색(`bg-card`)** — 원장 2026-09-03: *"텍스트 입력가능한 곳은 흰색 배경으로."*
 *    그전엔 `bg-transparent`라 뒤 카드·행 틴트가 그대로 비쳐, 한 줄 안에서 "칠 수 있는 칸"과
 *    "그냥 글자"가 모양으로 안 갈렸다(읽기 전용 `SHEET_BOX_READONLY`가 회색인 것과 짝이다).
 *    ⚠️ 되돌리지 말 것. 행 상태 틴트는 칸 **밖**(td)에 그대로 남는다.
 */
export const SHEET_INPUT = `${SHEET_BOX} text-foreground focus:border-primary bg-card w-full px-1 outline-none disabled:opacity-60`;

/** 여러 줄 입력(메모) — 높이만 다르다(h-5를 덮으므로 FRAME을 안 쓴다). 바탕은 위와 같은 흰색. */
export const SHEET_TEXTAREA = `border-line-strong text-foreground focus:border-primary ${SHEET_TEXT} bg-card w-full resize-y rounded-sm border px-1 py-1 font-semibold outline-none`;

/**
 * 읽기 전용 칸 — 같은 박스에 회색 바탕이라 "여기는 못 고친다"가 모양으로 보인다.
 * (알약으로 두면 편집 가능한 줄과 높이가 달라 열이 들쭉날쭉해진다.)
 */
export const SHEET_BOX_READONLY = `${SHEET_BOX} bg-bg-soft text-text-dim inline-flex w-full items-center truncate px-1`;

/** 유닛 칸 — 굵기는 컴포넌트가 정한다(기본 1은 흐리게, 고치면 굵게). 바탕은 위와 같은 흰색. */
export const SHEET_BOX_UNITS = `${SHEET_BOX_FRAME} focus:border-primary ${SHEET_TEXT} bg-card w-full px-0.5`;
