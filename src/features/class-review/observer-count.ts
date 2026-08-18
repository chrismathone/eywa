// 수업 평가의 **평가자 인원** — 원장 지시 2026-08-18: "평가자의 인원도 선택 설정 하게 해줘".
// 종전엔 3명 고정(코드 상수 OPEN_MODE_OBSERVER_LIMIT)이라 지정 슬롯도 선착순 마감도 항상 3이었다.
//
// ⚠️ 서버(생성·채점 게이트·집계)와 클라(새 평가 폼)가 함께 쓰는 상수라 **일반 모듈**로 둔다
//    ("use client" 모듈의 상수를 서버가 import하면 런타임 undefined — gotcha #81). list-filter.ts와 같은 규약.
//
// ⚠️ 인원은 **문서에 동결**한다(`header.observerLimit`). 나중에 기본값을 바꿔도 이미 만든 평가의
//    "선착순 N명"이 조용히 달라지면 안 된다 — 마감된 줄 알았던 자리가 다시 열리거나, 이미 채점한
//    사람이 정원 밖으로 밀려난다. 값이 없는 **구버전 문서는 3으로 읽는다**(그때의 실제 동작).

export const DEFAULT_OBSERVER_LIMIT = 3;
export const MIN_OBSERVER_LIMIT = 1;
/**
 * 상한 6 — 문항 매트릭스가 `문항 + 평가자 N + 본인 + 평균` 열이라, 6을 넘으면 상세 표가 가로로
 * 감당이 안 된다(30문항 × 9열). 더 필요해지면 표 레이아웃을 먼저 손볼 것.
 */
export const MAX_OBSERVER_LIMIT = 6;

/**
 * 저장값·폼값·구버전 문서를 하나로 정규화 — 숫자가 아니거나 범위를 벗어나면 기본값/경계로.
 *
 * 🔴 **빈 값을 먼저 걷어내야 한다** — `Number("")`는 NaN이 아니라 **0**이라, 그냥 숫자로 바꾸면
 *    `observerLimit`이 없는 **구버전 문서 전부가 0 → 하한 1명으로** 읽힌다(정원 3이 조용히 1이 되어
 *    선착순 평가의 2·3번째 평가자가 잠긴다). parseDoc이 모든 읽기에서 이 함수를 타므로 파급이 크다.
 */
export function normalizeObserverLimit(value: unknown): number {
  if (value === null || value === undefined) return DEFAULT_OBSERVER_LIMIT;
  const raw = typeof value === "number" ? value : String(value).trim();
  if (raw === "") return DEFAULT_OBSERVER_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_OBSERVER_LIMIT;
  const i = Math.trunc(n);
  if (i < MIN_OBSERVER_LIMIT) return MIN_OBSERVER_LIMIT;
  if (i > MAX_OBSERVER_LIMIT) return MAX_OBSERVER_LIMIT;
  return i;
}

/** 선택 가능한 인원 목록 — 폼 드롭다운과 검증이 같은 배열을 본다. */
export const OBSERVER_LIMIT_OPTIONS: number[] = Array.from(
  { length: MAX_OBSERVER_LIMIT - MIN_OBSERVER_LIMIT + 1 },
  (_, i) => MIN_OBSERVER_LIMIT + i,
);

/** 슬롯 표시 이름 — '평가자 A/B/C…'. 익명화 표기(상세 화면)와 폼 placeholder가 같은 규칙을 쓴다. */
export function observerSlotLabel(index: number): string {
  return `평가자 ${String.fromCharCode(65 + index)}`;
}
