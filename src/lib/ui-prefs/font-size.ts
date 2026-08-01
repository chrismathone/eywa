/**
 * 화면 '글씨 크기'(작음/보통/큼) 공용 규약 — 원스크린(수업보고서 강사뷰)에서 시작해 ECS·시간표로 넓혔다.
 *
 * ⚠️ **값·라벨·배율은 화면마다 같아야 한다**(원장이 세 화면을 오가며 쓴다 — 한 곳만 '크게'가 다른 배율이면
 *    같은 이름의 다른 기능이 된다). 그래서 상수는 여기 한 곳에 둔다.
 * ⚠️ **저장 네임스페이스는 화면마다 다르다**(`ui_prefs.onescreen` / `.ecs` / `.timetable`) — 표뷰는 작게,
 *    계획서는 크게 쓰고 싶을 수 있고, 한 화면 저장이 다른 화면을 덮으면 안 된다. 그래서 read는 ns를 받는다.
 * ⚠️ 구현이 `font-size`가 아니라 **zoom**인 이유: 세 화면 모두 칸마다 px 글자·고정 열 폭이 박힌 조밀한
 *    표라 글자만 키우면 칸·체크박스·알약과 어긋나 레이아웃이 무너진다. zoom은 같은 비율로 확대한다.
 * ⚠️ 기본 sm은 배율 **1**이라 손대지 않은 사용자의 화면은 완전히 그대로다(스타일 자체를 안 붙인다).
 * ⚠️ 알려진 한계: 포털로 body에 붙는 팝오버·DragOverlay는 확대 영역 밖이라 1배로 남는다(위치는 정확).
 */
export const UI_FONT_SIZES = ["sm", "md", "lg"] as const;
export type UiFontSize = (typeof UI_FONT_SIZES)[number];

/** 지금 화면이 '작음'(원장 지시) — 미설정 기본값. */
export const DEFAULT_UI_FONT_SIZE: UiFontSize = "sm";

export const UI_FONT_SIZE_LABEL: Record<UiFontSize, string> = {
  sm: "작음",
  md: "보통",
  lg: "큼",
};

export const UI_FONT_SIZE_ZOOM: Record<UiFontSize, number> = {
  sm: 1,
  md: 1.15,
  lg: 1.3,
};

/** 모르는 값·부재는 기본값 — 저장값이 깨져도 화면이 비지 않게. */
export function parseUiFontSize(raw: unknown): UiFontSize {
  return (UI_FONT_SIZES as readonly unknown[]).includes(raw)
    ? (raw as UiFontSize)
    : DEFAULT_UI_FONT_SIZE;
}

/**
 * `users.ui_prefs` jsonb → 그 화면의 글씨 크기.
 * @param ns 화면 네임스페이스("onescreen" | "ecs" | "timetable"…). 다른 화면 값을 훔쳐 읽지 않는다.
 */
export function readUiFontSize(uiPrefs: unknown, ns: string): UiFontSize {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) return DEFAULT_UI_FONT_SIZE;
  const scope = (uiPrefs as Record<string, unknown>)[ns];
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return DEFAULT_UI_FONT_SIZE;
  return parseUiFontSize((scope as Record<string, unknown>).fontSize);
}
