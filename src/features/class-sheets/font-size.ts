/**
 * ECS '글씨 크기'(작음/보통/큼) — 수업보고서 강사뷰(원스크린)와 **같은 규약**으로 계정에 저장한다
 * (원장 지시 2026-07-31: "수업보고서 강사뷰처럼 글씨 작게·보통·크게. 지금을 작게로 보고").
 *
 * ⚠️ 원스크린 모듈을 재사용하지 않고 따로 둔 이유 = **저장 네임스페이스가 다르다**(`ui_prefs.ecs`).
 *    화면마다 다른 크기를 쓰고 싶을 수 있고(계획서는 크게, 표뷰는 작게), 한 화면 저장이 다른 화면을
 *    덮으면 안 된다. 값·라벨·배율은 원스크린과 동일하게 맞춘다(두 화면이 다른 어휘를 쓰면 혼란).
 *
 * ⚠️ 구현은 font-size가 아니라 **zoom**이다 — ECS 시트도 칸마다 px 글자가 박힌 조밀한 표라
 *    글자만 키우면 열 폭(colgroup 고정 px)·체크박스·알약과 어긋난다. zoom은 같은 비율로 확대한다.
 * ⚠️ 기본값 sm은 배율 1이라 **손대지 않은 사용자의 화면은 완전히 그대로**다(스타일 자체를 안 붙인다).
 */
export const ECS_FONT_SIZES = ["sm", "md", "lg"] as const;
export type EcsFontSize = (typeof ECS_FONT_SIZES)[number];

/** 지금 화면이 '작음'(원장 지시) — 미설정 기본값. */
export const DEFAULT_ECS_FONT_SIZE: EcsFontSize = "sm";

export const ECS_FONT_SIZE_LABEL: Record<EcsFontSize, string> = {
  sm: "작음",
  md: "보통",
  lg: "큼",
};

export const ECS_FONT_SIZE_ZOOM: Record<EcsFontSize, number> = {
  sm: 1,
  md: 1.15,
  lg: 1.3,
};

/** 모르는 값·부재는 기본값 — 저장값이 깨져도 화면이 비지 않게. */
export function parseEcsFontSize(raw: unknown): EcsFontSize {
  return (ECS_FONT_SIZES as readonly unknown[]).includes(raw)
    ? (raw as EcsFontSize)
    : DEFAULT_ECS_FONT_SIZE;
}

/**
 * `users.ui_prefs` jsonb → ECS 글씨 크기.
 * ⚠️ ui_prefs는 **화면별 네임스페이스**(timetable·onescreen·ecs…)라 반드시 `ecs` 키 안에서 읽는다.
 */
export function readEcsFontSize(uiPrefs: unknown): EcsFontSize {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) return DEFAULT_ECS_FONT_SIZE;
  const ns = (uiPrefs as Record<string, unknown>).ecs;
  if (!ns || typeof ns !== "object" || Array.isArray(ns)) return DEFAULT_ECS_FONT_SIZE;
  return parseEcsFontSize((ns as Record<string, unknown>).fontSize);
}
