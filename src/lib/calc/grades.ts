// 성적 KPI 순수 계산 — 학생 상세 성적 탭의 추이/통계에 사용. UI·DB 비의존(테스트 강제).

export type GradeInput = {
  score: number | null;
  maxScore: number | null;
  takenOn: string; // ISO date "YYYY-MM-DD"
  subject: string;
  examName?: string;
};

/** 점수→백분율(0–100, 정수 반올림). score 없거나 maxScore 0/없으면 null. */
export function pct(score: number | null, maxScore: number | null): number | null {
  if (score == null || !maxScore || maxScore <= 0) return null;
  return Math.round((score / maxScore) * 100);
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
}

export type GradeStats = {
  count: number; // 백분율 산출 가능한 기록 수
  avgPct: number | null; // 전체 평균
  recentAvgPct: number | null; // 최근 3회 평균
  delta: number | null; // 최근 3회 평균 − 직전 3회 평균(향상도)
  bestPct: number | null;
  worstPct: number | null;
};

/** 백분율 가능한 기록만으로 통계 산출. 입력 순서 무관(내부에서 takenOn 정렬). */
export function gradeStats(grades: GradeInput[]): GradeStats {
  const withPct = grades
    .map((g) => ({ p: pct(g.score, g.maxScore), takenOn: g.takenOn }))
    .filter((x): x is { p: number; takenOn: string } => x.p != null)
    .sort((a, b) => a.takenOn.localeCompare(b.takenOn)); // 오래된→최근

  const ps = withPct.map((x) => x.p);
  if (ps.length === 0) {
    return { count: 0, avgPct: null, recentAvgPct: null, delta: null, bestPct: null, worstPct: null };
  }

  const recent3 = ps.slice(-3);
  const prev3 = ps.slice(-6, -3);
  const recentAvgPct = mean(recent3);
  const prevAvgPct = mean(prev3);
  const delta =
    recentAvgPct != null && prevAvgPct != null
      ? Math.round((recentAvgPct - prevAvgPct) * 10) / 10
      : null;

  return {
    count: ps.length,
    avgPct: mean(ps),
    recentAvgPct,
    delta,
    bestPct: Math.max(...ps),
    worstPct: Math.min(...ps),
  };
}

export type GradeSeriesPoint = {
  date: string; // takenOn
  label: string; // examName (or date)
  pct: number;
  subject: string;
};

/** 차트용 시계열(오래된→최근), 백분율 가능한 기록만. */
export function gradeSeries(grades: GradeInput[]): GradeSeriesPoint[] {
  return grades
    .map((g) => {
      const p = pct(g.score, g.maxScore);
      return p == null
        ? null
        : { date: g.takenOn, label: g.examName?.trim() || g.takenOn, pct: p, subject: g.subject };
    })
    .filter((x): x is GradeSeriesPoint => x != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}
