/**
 * 등록상담 조회 기간 프리셋.
 *
 * 🔴 '전체'는 없다(원장 2026-08-04). 옛 콜앤상담 이관으로 3년치 2,197행이 되어, 전건을 여는 순간
 * 칸반이 카드 2,197장 · payload ~1.1MB가 된다. **구간 길이는 최대 1년**으로 못박는다.
 * (특정 달을 고르는 건 이 상한과 무관하다 — 2023년 5월 한 달은 1개월 창이다.)
 *
 * ⚠️ 일반 모듈이어야 한다 — 서버 쿼리와 클라 필터 UI가 같이 쓴다. `import "server-only"`를 붙이면
 * 클라 번들에서 런타임 undefined가 되고 타입체크는 통과한다(gotcha #61·#81).
 */
export const RANGE_PRESETS = ["3m", "6m", "1y"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const DEFAULT_RANGE: RangePreset = "3m";

export const RANGE_LABEL: Record<RangePreset, string> = {
  "3m": "최근 3개월",
  "6m": "최근 6개월",
  "1y": "최근 1년",
};

export const RANGE_MONTHS: Record<RangePreset, number> = { "3m": 3, "6m": 6, "1y": 12 };

export function parseRange(v: string | null | undefined): RangePreset {
  return (RANGE_PRESETS as readonly string[]).includes(v ?? "") ? (v as RangePreset) : DEFAULT_RANGE;
}
