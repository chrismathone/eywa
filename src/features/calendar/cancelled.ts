/**
 * **취소된 일정 판정 — 단일 소스**(순수 함수, Vitest).
 *
 * 학원 캘린더(구글에서 가져온 것 포함)는 일정을 지우지 않고 제목에 '취소'를 붙여 남긴다(`[취소] 레벨테스트 …`,
 * `레테 취소`). 운영실은 원장 2026-09-30 *"취소건에 대해서는 목록에는 띄워놓고 취소바를 그어서 표시하자. 일정도
 * 마찬가지"* 이후 이 일정을 **목록에는 취소선으로 남기고, 건수·연결·자동 동작에서는 뺀다**.
 * 🔑 공백을 지우고 본다(`취 소`처럼 띄어 쓴 제목도 같은 뜻).
 */
export function isCancelledEventTitle(title: string): boolean {
  return title.replace(/\s+/g, "").includes("취소");
}

/**
 * 취소된 일정 제목의 표시 클래스 — 캘린더 탭(월·하루·연간·목록·분석)이 같은 한 벌을 쓴다. 칩 색은
 * `eventDisplayColor`가 무채색(`neutral`)으로 바꾸고, 여기는 **줄만 긋는다**(글자색은 앱 전역 한 값).
 */
export const CANCELLED_TITLE_CLASS = "line-through decoration-2";

/** 제목 표시 클래스 — 취소면 취소선, 아니면 빈 문자열. */
export const cancelledTitleClass = (title: string) => (isCancelledEventTitle(title) ? CANCELLED_TITLE_CLASS : "");

/**
 * 일정 목록의 건수 — **숫자는 살아 있는 것만**, 취소는 따로(화면은 "3건 · 취소 1"). 목록엔 취소도 줄을 그어 남으므로
 * 줄 수와 건수가 다를 수 있다 — 그 차이를 "취소 N"이 설명한다(원장 2026-09-30).
 */
export function countEvents(list: readonly { title: string }[]): { active: number; cancelled: number } {
  const cancelled = list.filter((e) => isCancelledEventTitle(e.title)).length;
  return { active: list.length - cancelled, cancelled };
}

/** 건수 뒤에 붙이는 " · 취소 N"(없으면 빈 문자열). */
export const cancelledSuffix = (cancelled: number) => (cancelled > 0 ? ` · 취소 ${cancelled}` : "");
