/**
 * MCS '글씨 크기' — 공용 규약([`lib/ui-prefs/font-size`](src/lib/ui-prefs/font-size.ts))의 MCS 바인딩.
 *
 * 값·라벨·배율은 공용(원스크린·ECS·시간표와 같은 어휘·같은 배율 — 원장이 화면을 오가며 쓴다),
 * **저장 네임스페이스만 `ui_prefs.mcs`**로 고정한다(한 화면 저장이 다른 화면 크기를 덮으면 안 된다).
 *
 * ⚠️ 기본 '작음'은 배율 1이다 — 원장 2026-09-01 *"현재 글씨보단 키워서 작음으로 세팅"*은
 *    **배율이 아니라 표의 밑글씨를 키워** 맞췄다(진도표 칸 11.5→13px 등). 배율로 키우면 저장 안 한
 *    사용자와 한 사용자의 기본이 갈린다.
 */
import { readUiFontSize } from "@/lib/ui-prefs/font-size";

export {
  UI_FONT_SIZES as MCS_FONT_SIZES,
  UI_FONT_SIZE_LABEL as MCS_FONT_SIZE_LABEL,
  UI_FONT_SIZE_ZOOM as MCS_FONT_SIZE_ZOOM,
  DEFAULT_UI_FONT_SIZE as DEFAULT_MCS_FONT_SIZE,
  parseUiFontSize as parseMcsFontSize,
  type UiFontSize as McsFontSize,
} from "@/lib/ui-prefs/font-size";

/** `users.ui_prefs` → MCS 글씨 크기(`mcs` 네임스페이스만 읽는다). */
export function readMcsFontSize(uiPrefs: unknown) {
  return readUiFontSize(uiPrefs, "mcs");
}
