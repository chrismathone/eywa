/**
 * 원스크린 '글씨 크기'(작음/보통/큼) — 강사 **계정**에 저장하는 개인 설정(users.ui_prefs.onescreen).
 *
 * 원장 지시(2026-07-30): 상단 바에서 강사가 직접 고르게 하고 **지금 크기를 '작음'**으로 둔다.
 * → 기본값이 `sm`이고 배율 1.0이라, 아무도 손대지 않으면 화면은 **지금과 완전히 동일**하다.
 *
 * ⚠️ 기기가 아니라 **계정**에 저장한다(시간표 색 강도와 같은 규약, 원장 2026-07-23) — 학원 PC를 옮겨
 *    앉아도 같은 크기여야 한다. 그래서 localStorage가 아니라 서버가 내려주고, 첫 렌더부터 확정값이라
 *    하이드레이션 불일치(#75)도 없다.
 *
 * ⚠️ 구현은 `font-size`가 아니라 **`zoom`**이다. 표뷰는 칸마다 `text-[11px]`·`text-[12px]`가 박힌
 *    조밀한 스프레드시트라 글자만 키우면 칸·체크박스·알약과 어긋나 레이아웃이 무너진다. zoom은 글자와
 *    칸을 **같은 비율로** 키워 표를 그대로 확대한다(포털로 빠지는 팝오버는 영향 없음).
 */

export const ONESCREEN_FONT_SIZES = ["sm", "md", "lg"] as const;
export type OnescreenFontSize = (typeof ONESCREEN_FONT_SIZES)[number];

/** 지금 화면이 '작음'(원장 지시) — 미설정 기본값. */
export const DEFAULT_ONESCREEN_FONT_SIZE: OnescreenFontSize = "sm";

export const ONESCREEN_FONT_SIZE_LABEL: Record<OnescreenFontSize, string> = {
  sm: "작음",
  md: "보통",
  lg: "큼",
};

/** 확대 배율. sm=1이라 기본 사용자는 스타일이 아예 안 붙는다(기존 렌더 무변경). */
export const ONESCREEN_FONT_SIZE_ZOOM: Record<OnescreenFontSize, number> = {
  sm: 1,
  md: 1.15,
  lg: 1.3,
};

/** 모르는 값·부재는 기본값 — 저장값이 깨져도 화면이 비지 않게(parseView와 같은 규약). */
export function parseOnescreenFontSize(raw: unknown): OnescreenFontSize {
  return (ONESCREEN_FONT_SIZES as readonly unknown[]).includes(raw)
    ? (raw as OnescreenFontSize)
    : DEFAULT_ONESCREEN_FONT_SIZE;
}

/**
 * `users.ui_prefs` jsonb → 원스크린 글씨 크기.
 * ⚠️ ui_prefs는 **화면별 네임스페이스**(timetable·onescreen…)라 반드시 `onescreen` 키 안에서 읽는다.
 */
export function readOnescreenFontSize(uiPrefs: unknown): OnescreenFontSize {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) return DEFAULT_ONESCREEN_FONT_SIZE;
  const ns = (uiPrefs as Record<string, unknown>).onescreen;
  if (!ns || typeof ns !== "object" || Array.isArray(ns)) return DEFAULT_ONESCREEN_FONT_SIZE;
  return parseOnescreenFontSize((ns as Record<string, unknown>).fontSize);
}
