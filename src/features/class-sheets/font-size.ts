/**
 * ECS '글씨 크기' — 공용 규약([`lib/ui-prefs/font-size`](src/lib/ui-prefs/font-size.ts))의 ECS 바인딩.
 *
 * 값·라벨·배율은 공용(원스크린·ECS·시간표가 같은 어휘·같은 배율 — 원장이 세 화면을 오가며 쓴다),
 * **저장 네임스페이스만 `ui_prefs.ecs`**로 고정한다(한 화면 저장이 다른 화면 크기를 덮으면 안 된다).
 * 시간표로 넓히면서 상수를 공용 모듈로 옮겼고, 이 파일은 기존 import 경로를 지키는 얇은 바인딩이다.
 */
import { readUiFontSize } from "@/lib/ui-prefs/font-size";

export {
  UI_FONT_SIZES as ECS_FONT_SIZES,
  UI_FONT_SIZE_LABEL as ECS_FONT_SIZE_LABEL,
  UI_FONT_SIZE_ZOOM as ECS_FONT_SIZE_ZOOM,
  DEFAULT_UI_FONT_SIZE as DEFAULT_ECS_FONT_SIZE,
  parseUiFontSize as parseEcsFontSize,
  type UiFontSize as EcsFontSize,
} from "@/lib/ui-prefs/font-size";

/**
 * 글씨 크기 칩의 **사전 키** — 주간 시트 툴바와 오늘 면 요약이 같은 표를 본다(2026-09-04).
 * 🔴 두 벌로 두지 말 것: 한쪽만 고치면 같은 칩이 화면마다 다른 영문으로 뜬다.
 * ⚠️ 라벨 상수(`ECS_FONT_SIZE_LABEL`)는 **한국어 화면(원스크린·시간표)이 그대로 쓰므로** 손대지 않는다.
 */
export const FONT_SIZE_KEY = {
  sm: "toolbar.font.sm",
  md: "toolbar.font.md",
  lg: "toolbar.font.lg",
} as const;

/** `users.ui_prefs` → ECS 글씨 크기(`ecs` 네임스페이스만 읽는다). */
export function readEcsFontSize(uiPrefs: unknown) {
  return readUiFontSize(uiPrefs, "ecs");
}
