/**
 * 보카킹 리포트 **기준표**(순수) — 석차 구간 이름 · 점수 레벨. 원장 2026-10-07 *"데이터 없음 빼고 일단 다 넣어서
 * 구현 — 시안 보고 추가 변경"* → 기준이 정해지지 않은 칸은 **여기 한 곳의 기본값**으로 두고, 바꿀 땐 이 표만 고친다.
 * ⚠️ 기본값은 원장 확정 전이다(2026-10-07). 확정되면 이 주석을 바꿀 것.
 */

/** 상위 % → 구간 이름(작을수록 위). 화면 문구가 "취약"처럼 부정적으로 읽히지 않게 맨 아래도 '성장 구간'. */
export const RANK_BANDS: readonly { maxTopPercent: number; label: string }[] = [
  { maxTopPercent: 10, label: "최상위권" },
  { maxTopPercent: 30, label: "상위권" },
  { maxTopPercent: 70, label: "중위권" },
  { maxTopPercent: 100, label: "성장 구간" },
];

/** 점수(0~100) → 레벨. 시안의 Lv.1~5(기초~최상위)를 점수 구간으로 정한 기본값. */
export const SCORE_LEVELS: readonly { level: 1 | 2 | 3 | 4 | 5; minScore: number; label: string }[] = [
  { level: 1, minScore: 0, label: "기초" },
  { level: 2, minScore: 50, label: "기본" },
  { level: 3, minScore: 65, label: "중급" },
  { level: 4, minScore: 80, label: "고급" },
  { level: 5, minScore: 90, label: "최상위" },
];

/** 학년 평균을 낼 최소 인원(나 빼고). 적으면 평균이 한두 명에 휘둘려 학부모에게 거짓 정밀도가 된다. */
export const MIN_GRADE_PEERS = 5;

/** 석차 → 상위 %(1~100, 올림). 1위/88명 = 상위 2%. */
export function topPercentOf(rank: number, of: number): number | null {
  if (!(rank >= 1) || !(of >= rank)) return null;
  return Math.min(100, Math.max(1, Math.ceil((rank / of) * 100)));
}

export function rankBand(topPercent: number): string {
  return RANK_BANDS.find((b) => topPercent <= b.maxTopPercent)?.label ?? RANK_BANDS[RANK_BANDS.length - 1]!.label;
}

export function scoreLevel(score: number): (typeof SCORE_LEVELS)[number] {
  let hit = SCORE_LEVELS[0]!;
  for (const l of SCORE_LEVELS) if (score >= l.minScore) hit = l;
  return hit;
}

/** 다음 레벨까지 남은 점수(최상위면 null). */
export function pointsToNextLevel(score: number): { level: (typeof SCORE_LEVELS)[number]; gap: number } | null {
  const cur = scoreLevel(score);
  const next = SCORE_LEVELS.find((l) => l.level === cur.level + 1);
  return next ? { level: next, gap: Math.max(1, Math.ceil(next.minScore - score)) } : null;
}
