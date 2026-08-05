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


/**
 * 통계뷰 기간 — 단일 연도 또는 최근 N개년(**최대 3개년**, 원장 2026-08-05).
 *
 * 🔴 '전체'를 없앤 이유: 데이터가 쌓일수록 구간이 계속 길어져 화면이 무한히 빽빽해진다. 상한을 두면
 * 눈금 압축(월→분기)과 맞물려 **몇 년이 지나도 같은 밀도**로 읽힌다.
 * (칸반·목록의 "최대 1년"과는 다른 이유다 — 저기는 행 로딩, 여기는 가독성.)
 */
export const MAX_STATS_YEARS = 3;

export type StatsPeriod =
  | { kind: "year"; year: number }
  | { kind: "span"; years: number }; // 최근 N개년(올해 포함)

export function parseStatsPeriod(raw: string | null | undefined, thisYear: number): StatsPeriod {
  const m = String(raw ?? "").match(/^(\d)y$/);
  if (m) {
    const n = Math.min(MAX_STATS_YEARS, Math.max(2, Number(m[1])));
    return { kind: "span", years: n };
  }
  const y = Number(raw);
  return { kind: "year", year: Number.isFinite(y) && y > 2000 ? y : thisYear };
}

/** 그 기간의 시작·끝 연도. 데이터가 있는 범위 밖으로는 나가지 않는다(빈 화면 방지). */
export function periodRange(
  p: StatsPeriod,
  available: { from: number; to: number },
): { from: number; to: number } {
  if (p.kind === "year") return { from: p.year, to: p.year };
  const to = available.to;
  return { from: Math.max(available.from, to - p.years + 1), to };
}

export function periodLabel(p: StatsPeriod): string {
  return p.kind === "year" ? `${p.year}년` : `최근 ${p.years}개년`;
}

export function periodParam(p: StatsPeriod): string {
  return p.kind === "year" ? String(p.year) : `${p.years}y`;
}
