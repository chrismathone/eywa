/**
 * 학부모 보고서 성적 추이 그래프 — 순수 파서/조립(edutrix ReportPaper 그래프 데이터 로직 이식).
 * 시험 점수(exam_info "n/m" → %)·과제 점수(homework_score "N%" → 숫자)를 0~100 시계열로 만든다.
 * 렌더는 순수 SVG(report-trend-graph.tsx) — 라이브러리 0(ClassNote 스크린샷 headless 호환, CLAUDE.md B5).
 * CLAUDE.md 원칙: 계산 파서는 순수 함수 + Vitest.
 */

/** 그래프 조립 입력 1행 — 저장된 보고서의 날짜·시험·과제(정렬은 buildTrendPoints에서). */
export type TrendReportRow = {
  id: string;
  date: string; // YYYY-MM-DD
  examInfo: string | null; // "4/5" | "9/10" | "80점" | "20문제 중 18개" | null
  homeworkScore: string | null; // "100%" | "90" | "완료" | null
};

/** 그래프 점 1개 — 날짜 + 시험/과제 백분율(없으면 null) + 현재 보고서 여부(강조점). */
export type TrendPoint = {
  date: string;
  exam: number | null; // 0~100
  homework: number | null; // 0~100
  isCurrent: boolean;
};

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * 시험 점수 → 백분율(0~100) | null. 우선순위:
 *  ① "n/m"(4/5, 9 / 10) → n/m*100  ② "N문제 중 M개"(신 분리필드) → M/N*100  ③ 단순 숫자(80, 80점) → 그 값(≤100).
 * edutrix parseExamPercent 이식 + eywa 분리필드("N문제 중 M개") 폴백.
 */
export function parseExamPercent(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // ② "N문제 중 M개" (eywa daily_test/check_test)
  const koreanMatch = s.match(/(\d+)\s*문제\s*중\s*(\d+)\s*개/);
  if (koreanMatch) {
    const total = parseInt(koreanMatch[1]!, 10);
    const correct = parseInt(koreanMatch[2]!, 10);
    if (total > 0) return clampPct((correct / total) * 100);
  }
  // ① "n/m"
  const fraction = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (fraction) {
    const correct = parseInt(fraction[1]!, 10);
    const total = parseInt(fraction[2]!, 10);
    if (total > 0) return clampPct((correct / total) * 100);
  }
  // ③ 단순 숫자 폴백("80점" 등)
  const simple = s.match(/(\d+)/);
  if (simple) return clampPct(parseInt(simple[1]!, 10));
  return null;
}

/**
 * eywa 온스크린 과제 칩(정성 상태) → 그래프용 퍼센트. data.ts `HOMEWORK`(["완료","일부 미흡","미제출"])와 동기 필수.
 * (온스크린 과제 입력은 숫자 점수가 아니라 상태값이라, 이 매핑이 없으면 과제 추이 그래프에 한 점도 안 찍힌다 —
 *  그래프가 edutrix 임포트 숫자에서만 돌던 배선 구멍. 2026-07-14.)
 */
const HOMEWORK_STATUS_PERCENT: Record<string, number> = {
  "완료": 100,
  "일부 미흡": 50,
  "미제출": 0,
};

/**
 * 과제 점수 → 백분율(0~100) | null.
 *  ① 정성 상태(온스크린 과제 칩) → 완료=100·일부 미흡=50·미제출=0.
 *  ② "100%"·"90"·"50%"(edutrix 임포트) → 숫자.
 *  그 외 숫자 없는 값("미확인"·"—" 등)은 null(그래프 제외).
 */
export function parseHomeworkPercent(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const mapped = HOMEWORK_STATUS_PERCENT[s]; // ① 정성 상태 → 퍼센트
  if (mapped !== undefined) return mapped;
  const m = s.match(/(\d+)/); // ② 숫자(%) — edutrix 임포트
  if (!m) return null;
  return clampPct(parseInt(m[1]!, 10));
}

/**
 * 보고서 이력 → 그래프 점 배열(날짜 오름차순, 최근 limit개). 시험·과제 둘 다 null인 행은 제외.
 * currentId = 현재 보고 중인 행(강조점). rows는 정렬 무관(여기서 날짜순 정렬).
 */
export function buildTrendPoints(rows: TrendReportRow[], currentId: string, limit = 10): TrendPoint[] {
  return rows
    .map((r) => ({
      date: r.date,
      exam: parseExamPercent(r.examInfo),
      homework: parseHomeworkPercent(r.homeworkScore),
      isCurrent: r.id === currentId,
    }))
    .filter((p) => p.exam !== null || p.homework !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-limit);
}

/** 특정 지표(exam|homework)에 유효 점이 2개 이상인가 — 미만이면 그래프 숨김(edutrix 최소 2점 규칙). */
export function hasTrend(points: TrendPoint[], key: "exam" | "homework"): boolean {
  return points.filter((p) => p[key] !== null).length >= 2;
}
