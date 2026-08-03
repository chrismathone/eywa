/**
 * 학부모 보고서 성적 추이 그래프 — 순수 파서/조립(edutrix ReportPaper 그래프 데이터 로직 이식).
 * 시험 점수(exam_info "n/m" → %)·과제 수행률(homework_score "N%" → 숫자)을 0~100 시계열로 만든다.
 * 렌더는 순수 SVG(report-trend-graph.tsx) — 라이브러리 0(ClassNote 스크린샷 headless 호환, CLAUDE.md B5).
 * CLAUDE.md 원칙: 계산 파서는 순수 함수 + Vitest.
 */
import { parseHomeworkRate } from "./homework-rate";

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
 * 과제 수행률 → 백분율(0~100) | null. **변환은 [`homework-rate.ts`](./homework-rate.ts) 단일 소스.**
 *
 * 🔴 2026-08-03: 여기 있던 `"일부 미흡" → 50` 매핑이 사고를 냈다 — 90% 해온 학생이 학부모 그래프에
 *    **50**으로 찍혀 혼났다. 정도를 모르는 값은 **점을 찍지 않는다**(null). 되돌리지 말 것.
 */
export function parseHomeworkPercent(raw: string | null | undefined): number | null {
  return parseHomeworkRate(raw);
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
