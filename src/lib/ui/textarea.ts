/**
 * 자동 확장 textarea 클래스 — **드래그 손잡이로 늘리는 대신 작성량에 따라 높이가 자란다**(원장 요청).
 *
 * Tailwind v4 내장 `field-sizing-content`를 쓴다. 미지원 브라우저에선 이 속성이 무시되어 높이가
 * 고정되므로, **소비처가 `rows`(또는 `min-h-*`)로 기본 줄 수를 반드시 함께 준다** — 안 그러면 한 줄로
 * 쪼그라든다. 늘어나는 높이는 `max-h`에서 멈추고 그 뒤부터 내부 스크롤.
 *
 * ⚠️ 새 textarea는 이 상수를 쓴다(로컬에 같은 문자열을 다시 적지 말 것).
 */
const AUTOSIZE_BASE = "field-sizing-content max-h-[200px]";

/** 기본형 — 손잡이 없음. 폼 입력칸(메모·안내 문구 등)은 전부 이것. */
export const TEXTAREA_AUTOSIZE = `${AUTOSIZE_BASE} resize-none`;

/**
 * 손잡이를 남기는 변형 — 원스크린 표 모드처럼 **좁은 칸에 여러 개가 붙어 있어** 사용자가 직접
 * 높이를 조절하고 싶어하는 자리에만. 새 폼에는 쓰지 말 것.
 */
export const TEXTAREA_AUTOSIZE_RESIZABLE = `${AUTOSIZE_BASE} resize-y`;
