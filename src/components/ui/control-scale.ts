/**
 * 컨트롤(버튼·칩·탭·입력·기간 네비) 치수 — **단일 소스**(원장 2026-09-03 대규모 디자인 수정).
 *
 * 원장: *"모든 버튼 라벨 안의 텍스트는 위아래 여백이 5%씩 합 10%를 가지게 · 텍스트를 최대한 버튼과 라벨 안에
 * 최대 크기로"* + *"다 제각각인 버튼, 라벨 등을 스타일 통일 — 지금 수정도 그렇고 앞으로 생성 시에도"*.
 *
 * 규칙 세 줄:
 * 1. **높이는 라벨에서 도출**한다(높이 = 라벨 + 4px, 위아래 2px — 원장 *"상하 여백 1.5배"*). 높이를 먼저 정하고
 *    글자를 끼워 맞추지 않는다. 값은 globals.css `--control-*` 한 곳(기본 라벨 **18px**(확정) → 높이 22px · sm 16→20 · lg 22→26).
 * 2. **한 줄**(`whitespace-nowrap`) · 줄바꿈·폰트 축소 금지. 안 들어가면 문구를 줄이거나 버튼을 넓힌다.
 * 3. 세로 패딩(`py-*`)으로 높이를 만들지 않는다 — 라벨은 `leading-none`이고 남는 2px이 여백이다.
 *    ⚠️ **`<input>`은 제 상자 안에서 글자를 자른다** — 검색 입력은 `h-full leading-normal`로 상자 높이를 다 쓰게 할 것
 *    (`leading-none` 18px 줄에 18px 한글은 위아래가 잘린다 — 원장 캡처 2026-09-03).
 *
 * 🔴 화면 파일에 `h-8`·`text-xs`·`text-[Npx]`로 컨트롤 치수를 손으로 적지 말 것 — 여기 상수를 쓴다
 *    (가드 `control-scale.test.ts`). 09-01 "툴바 h-8 고정" 캐논은 이 규칙이 **대체**했다.
 * 🔴 이 파일에 `"use client"`도 `import "server-only"`도 붙이지 말 것 — 서버/클라 양쪽이 쓴다([[#61]]·[[#81]]).
 */

/** 기본 컨트롤 높이(22px) — 툴바 칩·세그먼트·드롭다운·검색·기간 네비·기본 버튼. */
export const CONTROL_H = "h-(--control-h)";
/** 기본 컨트롤 라벨(18px, 줄간격 1) — 위아래 2px만 남는다. */
export const CONTROL_LABEL = "text-(length:--control-label) leading-none";
/** 작은 컨트롤(표 안·보조 동작) 높이(20px)·라벨(16px). */
export const CONTROL_H_SM = "h-(--control-h-sm)";
export const CONTROL_LABEL_SM = "text-(length:--control-label-sm) leading-none";
/** 큰 컨트롤 — 창당 하나뿐인 Primary. 높이(26px)·라벨(22px). */
export const CONTROL_H_LG = "h-(--control-h-lg)";
export const CONTROL_LABEL_LG = "text-(length:--control-label-lg) leading-none";

/** 정사각 아이콘 버튼(아이콘만 있는 것은 1차 화면 금지 — 옆에 읽히는 텍스트가 있을 때만). */
export const CONTROL_SQUARE = "size-(--control-h)";
export const CONTROL_SQUARE_SM = "size-(--control-h-sm)";
export const CONTROL_SQUARE_LG = "size-(--control-h-lg)";

/** 라벨 옆 아이콘은 글자와 같은 크기(±10%) — 아이콘 때문에 폰트를 줄이지 않는다. */
export const CONTROL_ICON = "[&_svg:not([class*='size-'])]:size-[1em]";
