/**
 * 선생님 원스크린 — AI 학습 추세(종합분석) 프롬프트(순수 함수).
 * edutrix generateTrendAnalysis + historySummary 조립(reportActions.ts)의 이식.
 * 최근 N회 저장 보고서의 시험·과제 흐름을 한 문단으로 요약한다(멘트와 별개 출력).
 * 실 AI 호출은 server/actions.ts의 generateTrendComment. 라이브 호출 없음(빌더만).
 * CLAUDE.md 원칙: 계산/프롬프트 조립은 순수 함수 + Vitest.
 */
import { DEFAULT_PROMPTS, interpolate } from "./prompt-defaults";

/** 추세 조립 입력 1행 — 저장된 보고서(같은 과목)의 날짜·시험·과제. */
export type TrendHistoryRow = {
  date: string; // YYYY-MM-DD
  examInfo: string | null; // "일일 15/20, 확인 18/20" | null
  homeworkScore: string | null; // "완료" | "일부 미흡" | null
};

export type TrendInput = {
  count: number; // 분석에 쓴 회차 수(최근 10 이내)
  examTrend: string; // "[07-01] 일일 15/20 -> [07-08] …" | ""
  assignTrend: string; // 과제 흐름 | ""
};

// 유효 데이터(시험 또는 과제)가 이 미만이면 "추세"라 부를 수 없어 생성 skip.
export const MIN_TREND_RECORDS = 2;
const TREND_WINDOW = 10;

/**
 * 최근 기록 → 추세 입력. edutrix 규격 `[MM-DD] 값 -> [MM-DD] 값 -> …`(날짜순).
 * 유효 데이터 포인트 < MIN_TREND_RECORDS 또는 시험·과제 둘 다 비면 null(빈데이터 창작 방지).
 * history는 날짜 오름차순이라 가정(호출부에서 정렬). 최근 TREND_WINDOW회만 사용.
 */
export function buildTrendInput(history: TrendHistoryRow[]): TrendInput | null {
  const recent = history.slice(-TREND_WINDOW);
  const line = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "");
  const examTrend = recent
    .filter((h) => line(h.examInfo))
    .map((h) => `[${h.date.slice(5)}] ${line(h.examInfo)}`)
    .join(" -> ");
  const assignTrend = recent
    .filter((h) => line(h.homeworkScore))
    .map((h) => `[${h.date.slice(5)}] ${line(h.homeworkScore)}`)
    .join(" -> ");
  const dataPoints = recent.filter((h) => line(h.examInfo) || line(h.homeworkScore)).length;
  if (dataPoints < MIN_TREND_RECORDS) return null;
  if (!examTrend && !assignTrend) return null;
  return { count: recent.length, examTrend, assignTrend };
}

/** edutrix historySummary 규격(날짜순 흐름 3줄). 프롬프트 [기록] 블록에 주입. */
function historySummary(input: TrendInput): string {
  return [
    `분석 대상: 최근 ${input.count}회 기록`,
    `시험·테스트 점수 흐름(날짜순): ${input.examTrend || "자료 없음"}`,
    `과제 흐름(날짜순): ${input.assignTrend || "자료 없음"}`,
  ].join("\n");
}

/**
 * 추세 프롬프트 — 기본 템플릿(DEFAULT_PROMPTS.trend)에 조립한 [기록]을 주입. edutrix DEFAULT_TREND_PROMPT 이식.
 * template 인자를 주면(원장 DB 오버라이드) 그것을 대신 사용 — 프로덕션은 활성값이 기본을 덮음.
 */
export function buildTrendPrompt(input: TrendInput, template?: string | null): string {
  return interpolate(template || DEFAULT_PROMPTS.trend, { historySummary: historySummary(input) });
}
