// 시험 통계 순수 계산 — 시험 목록 통계열(응시/평균/최고/최저)과 상세 석차에 사용.
// UI·DB 비의존(테스트 강제). 백분율 변환은 성적 모듈과 동일 규칙을 공유한다.
import { pct } from "@/lib/calc/grades";

export type ExamScore = {
  /** 원점수. 미응시/공란이면 null. */
  score: number | null;
  /** 만점. 행별로 다를 수 있어 받되, 보통 시험의 max_score로 통일. */
  maxScore?: number | null;
};

export type ExamStats = {
  count: number; // 응시 인원 (score != null)
  avg: number | null; // 평균 원점수 (소수 1자리)
  max: number | null; // 최고 원점수
  min: number | null; // 최저 원점수
  avgPct: number | null; // 평균 백분율 (만점 있는 응시자만, 정수)
};

/** 응시(점수 있는) 행만으로 통계 산출. 입력 순서 무관. */
export function examStats(scores: ExamScore[]): ExamStats {
  const present = scores.filter(
    (s): s is { score: number; maxScore?: number | null } => s.score != null,
  );
  const count = present.length;
  if (count === 0) return { count: 0, avg: null, max: null, min: null, avgPct: null };

  const raw = present.map((s) => s.score);
  const avg = Math.round((raw.reduce((a, b) => a + b, 0) / count) * 10) / 10;
  const max = Math.max(...raw);
  const min = Math.min(...raw);

  const pcts = present
    .map((s) => pct(s.score, s.maxScore ?? null))
    .filter((p): p is number => p != null);
  const avgPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;

  return { count, avg, max, min, avgPct };
}

export type Rankable = { studentId: string; score: number | null };

/**
 * 표준 경쟁 석차(1,2,2,4). 점수 내림차순, 동점은 같은 등수.
 * 미응시(score=null)는 석차 없음(rank=null). 입력 순서를 보존해 반환.
 */
export function rankByScore<T extends Rankable>(entries: T[]): (T & { rank: number | null })[] {
  const sorted = entries
    .filter((e) => e.score != null)
    .sort((a, b) => (b.score as number) - (a.score as number));

  const rankByStudent = new Map<string, number>();
  let prevScore: number | null = null;
  let prevRank = 0;
  sorted.forEach((e, i) => {
    const sc = e.score as number;
    const rank = prevScore !== null && sc === prevScore ? prevRank : i + 1;
    rankByStudent.set(e.studentId, rank);
    prevScore = sc;
    prevRank = rank;
  });

  return entries.map((e) => ({
    ...e,
    rank: e.score == null ? null : rankByStudent.get(e.studentId) ?? null,
  }));
}
