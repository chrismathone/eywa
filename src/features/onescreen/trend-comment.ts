/**
 * 선생님 원스크린 — AI 학습 추세(종합분석) 프롬프트(순수 함수).
 * edutrix generateTrendAnalysis + historySummary 조립(reportActions.ts)의 이식.
 * 최근 N회 저장 보고서의 시험·과제 흐름을 한 문단으로 요약한다(멘트와 별개 출력).
 * 실 AI 호출은 server/actions.ts의 generateTrendComment. 라이브 호출 없음(빌더만).
 * CLAUDE.md 원칙: 계산/프롬프트 조립은 순수 함수 + Vitest.
 */

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
 * 추세 프롬프트 — edutrix DEFAULT_TREND_PROMPT 이식(숫자 정확·전망/격려 금지·상투어 금지·few-shot).
 * eywa generateJSON(Upstage JSON mode)에 맞춰 `{"trend":"..."}` 출력 계약으로 조정.
 */
export function buildTrendPrompt(input: TrendInput): string {
  return [
    "당신은 학원 담임 선생님입니다. 아래 [기록]의 시험·과제 점수 변화를 학부모님께 한 문단의 자연스러운 문장으로 전합니다.",
    "",
    "[반드시]",
    "- [기록]에 있는 날짜·점수만 쓰세요. 없는 회차·점수·평가·전망을 지어내지 마세요.",
    "- 점수 숫자는 [기록] 그대로 정확히 옮기세요. 'X/Y'는 'Y문제 중 X문제'로 풀어쓰세요.",
    "- 날짜를 나열하거나 줄로 끊지 말고, 점수 변화를 한 문단의 이어지는 문장(3~4문장)으로 이야기하세요.",
    "- '만점 가능/기대됩니다' 같은 전망·격려·조언은 넣지 마세요. 오직 점수 변화 사실만.",
    "- 점수가 떨어졌어도 담담히 사실만 전하세요(비난 없이). 수신인 호칭·인사말·마크다운·불릿 금지.",
    "",
    "[예시]",
    "기록) 시험·테스트 점수 흐름(날짜순): [06-01] 일일 6/10 -> [06-08] 일일 8/10 -> [06-15] 일일 9/10",
    '출력) {"trend": "6월 1일 일일테스트에서 10문제 중 6개, 6월 8일 10문제 중 8개, 6월 15일 10문제 중 9개로 점수가 꾸준히 올랐습니다."}',
    "",
    "[기록]",
    historySummary(input),
    "",
    '[출력] JSON만 출력: {"trend": "..."} — trend는 한국어 한 단락(줄바꿈 없이). 마크다운 코드블록 금지.',
  ].join("\n");
}
