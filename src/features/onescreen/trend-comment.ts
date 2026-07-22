/**
 * 선생님 원스크린 — AI 학습 추세(종합분석) 프롬프트(순수 함수).
 * edutrix generateTrendAnalysis + historySummary 조립(reportActions.ts)의 이식.
 * 최근 N회 저장 보고서의 시험·과제 흐름을 한 문단으로 요약한다(멘트와 별개 출력).
 * 실 AI 호출은 server/actions.ts의 generateReportComment(멘트와 통합 1회 호출). 라이브 호출 없음(빌더만).
 * CLAUDE.md 원칙: 계산/프롬프트 조립은 순수 함수 + Vitest.
 */
import { DEFAULT_PROMPTS, interpolate, assembleSingle } from "./prompt-defaults";

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
 * `X/100` → `X점(100점 만점)`. 추세 프롬프트는 "'X/Y'는 'Y문제 중 X문제'로 풀어쓰세요"라 지시하는데,
 * **분모 100은 문항 수가 아니라 100점 만점 시험 점수**다 → 그대로 두면 학부모에게
 * "100문제 중 88개를 맞혔습니다"라는 없는 사실이 나간다(2026-07-22 실측: 최주원 6/25 88/100이
 * 그렇게 발송됨. 반대로 92/100·96/100은 점수가 통째로 사라지고 "100점 만점으로 시작"이 됐다).
 * 판정 근거: 6/25 하루에 21명이 x/100(48~89 분포, 5의 배수 아님 123/158) — 100문항 일일테스트가 아니라
 * 시험 점수. 그 외 분모(5·10·15·20…)는 문항 수라 건드리지 않는다.
 */
export function normalizeExamInfo(examInfo: string): string {
  return examInfo.replace(/(?<!\d)(\d{1,3})\s*\/\s*100(?!\d)/g, "$1점(100점 만점)");
}

/**
 * 최근 기록 → 추세 입력. edutrix 규격 `[MM-DD] 값 -> [MM-DD] 값 -> …`(날짜순).
 * 유효 데이터 포인트 < MIN_TREND_RECORDS 또는 시험·과제 둘 다 비면 null(빈데이터 창작 방지).
 * history는 날짜 오름차순이라 가정(호출부에서 정렬). 최근 TREND_WINDOW회만 사용.
 */
export function buildTrendInput(history: TrendHistoryRow[]): TrendInput | null {
  const line = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "");
  // ⚠️ 최근 N개를 **흐름별로 따로** 센다(공통 슬라이스 아님) — 과제만 기록된 날이 흔해서
  // (실측 최근 30일 853행 vs 시험 651행) 공통으로 자르면 과제-only 행이 슬롯을 잠식해
  // 시험 기록이 추세에서 사라진다(실측 215명 중 26명). 두 줄은 프롬프트에서도 독립 문장이라 분리가 안전하다.
  const examRows = history.filter((h) => line(h.examInfo)).slice(-TREND_WINDOW);
  const assignRows = history.filter((h) => line(h.homeworkScore)).slice(-TREND_WINDOW);
  const examTrend = examRows
    .map((h) => `[${h.date.slice(5)}] ${normalizeExamInfo(line(h.examInfo))}`)
    .join(" -> ");
  const assignTrend = assignRows.map((h) => `[${h.date.slice(5)}] ${line(h.homeworkScore)}`).join(" -> ");
  // 표본 수 = 실제 인용되는 날짜의 합집합(둘 다 있는 날을 두 번 세지 않는다).
  const dates = new Set([...examRows, ...assignRows].map((h) => h.date));
  if (dates.size < MIN_TREND_RECORDS) return null;
  if (!examTrend && !assignTrend) return null;
  return { count: dates.size, examTrend, assignTrend };
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
/** 추세 본문(출력 계약 없음) — 통합 호출 섹션용. template=원장 오버라이드. */
export function trendBody(input: TrendInput, template?: string | null): string {
  return interpolate(template || DEFAULT_PROMPTS.trend, { historySummary: historySummary(input) });
}

/** 추세 단일 프롬프트(본문 + {trend} 계약) — 미리보기·개별 테스트용. */
export function buildTrendPrompt(input: TrendInput, template?: string | null): string {
  return assembleSingle(trendBody(input, template), "trend");
}
