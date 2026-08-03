/**
 * 선생님 원스크린 — AI 학습 추세(종합분석) 프롬프트(순수 함수).
 * edutrix generateTrendAnalysis + historySummary 조립(reportActions.ts)의 이식.
 * 최근 N회 저장 보고서의 시험·과제 흐름을 한 문단으로 요약한다(멘트와 별개 출력).
 * 실 AI 호출은 server/actions.ts의 generateReportComment(멘트와 통합 1회 호출). 라이브 호출 없음(빌더만).
 * CLAUDE.md 원칙: 계산/프롬프트 조립은 순수 함수 + Vitest.
 */
import { DEFAULT_PROMPTS, interpolate, assembleSingle } from "./prompt-defaults";
import { isNoneValue } from "./none-marker";

/** 추세 조립 입력 1행 — 저장된 보고서(같은 과목)의 날짜·시험·과제. */
export type TrendHistoryRow = {
  date: string; // YYYY-MM-DD
  examInfo: string | null; // "일일 15/20, 확인 18/20" | null
  homeworkScore: string | null; // 과제 수행률 "90%" | 옛 표기 "완료" | null
};

export type TrendInput = {
  count: number; // 분석에 쓴 회차 수(최근 10 이내)
  examTrend: string; // "[07-01] 일일 15/20 -> [07-08] …" | ""
  assignTrend: string; // 과제 흐름 | ""
  /**
   * 시험 기록의 **만점(척도)이 회차마다 다른가**. true면 "올랐다/내려갔다"로 이을 수 없다 —
   * 9문제 중 7개와 100점 만점에 68점 사이엔 증감이라는 게 없다.
   *
   * 🔴 2026-07-30 발송 감사: 추세 137건 중 11건이 한 문단에서 척도를 섞었고 **그 11건 전부가
   *    증감을 서술**했다("100점 만점에 56점으로 시작한 후 … 9문제 중 7개, 68점으로 내려갔습니다").
   *    코드엔 척도 경계에서 prevScore를 버리는 가드가 있는데(roster.ts) **추세 문장은 그 밖**이었다.
   */
  scaleMixed: boolean;
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
 * 그 회차 시험의 **만점(척도)** 집합. "일일 15/20, 확인 18/20" → {20}, "88점(100점 만점)" → {100}.
 * 분모를 못 읽는 표기는 무시한다(판정 불가로 기능을 죽이지 않음 — 섞였다고 단정하지 않는다).
 */
export function examScales(examInfo: string): number[] {
  const out: number[] = [];
  for (const m of examInfo.matchAll(/(?<!\d)\d{1,3}\s*\/\s*(\d{1,3})(?!\d)/g)) out.push(Number(m[1]));
  for (const m of examInfo.matchAll(/(\d{1,3})\s*점\s*만점/g)) out.push(Number(m[1]));
  return out;
}

/**
 * **연속 같은 값 묶기** — `[07-06] 완료 -> [07-09] 완료 -> [07-13] 완료`를
 * `[07-06~07-13] 완료(3회)`로. 프롬프트에 "같은 값이 이어지면 묶어 쓰세요"라고 적어 뒀지만
 * Haiku가 잘 안 따랐다(2026-07-30 감사: 추세 137건 중 86건이 날짜 6개 이상 나열, 최대 18개).
 *
 * 🔴 지시를 강화하는 대신 **입력을 줄인다** — 모델이 나열할 항목 자체가 없으면 나열할 수 없다.
 *    (요약은 코드가 하므로 숫자 창작 여지도 없다.)
 */
export function compressRuns(rows: { date: string; value: string }[]): string {
  if (rows.length === 0) return "";
  const parts: string[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1]!.value === rows[i]!.value) j++;
    const from = rows[i]!.date.slice(5);
    const to = rows[j]!.date.slice(5);
    const n = j - i + 1;
    parts.push(n === 1 ? `[${from}] ${rows[i]!.value}` : `[${from}~${to}] ${rows[i]!.value}(${n}회)`);
    i = j + 1;
  }
  return parts.join(" -> ");
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
  // 🔴 "없음"(과제가 없던 날)은 **추세에서 제외**한다 — 원장 2026-07-23. 미제출이 아니라 '해당 없음'이라
  //    흐름에 넣으면 성실한 학생이 미제출로 몰린다. 정규화 전 원본(`-`·`X` 등 이관분 표기)도 함께 걸러야
  //    해서(실측 67건) 저장 시점 정규화만으로는 부족하다 → 조립 시점에서도 판정한다.
  const assignRows = history
    .filter((h) => line(h.homeworkScore) && !isNoneValue(h.homeworkScore))
    .slice(-TREND_WINDOW);
  const examTrend = compressRuns(
    examRows.map((h) => ({ date: h.date, value: normalizeExamInfo(line(h.examInfo)) })),
  );
  const assignTrend = compressRuns(
    assignRows.map((h) => ({ date: h.date, value: line(h.homeworkScore) })),
  );
  // 표본 수 = 실제 인용되는 날짜의 합집합(둘 다 있는 날을 두 번 세지 않는다).
  const dates = new Set([...examRows, ...assignRows].map((h) => h.date));
  if (dates.size < MIN_TREND_RECORDS) return null;
  if (!examTrend && !assignTrend) return null;
  const scales = new Set(examRows.flatMap((h) => examScales(line(h.examInfo))));
  return { count: dates.size, examTrend, assignTrend, scaleMixed: scales.size > 1 };
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
 * 척도가 섞인 학생에게만 붙는 **코드 측 주의**. 프롬프트 본문(원장 편집 가능) 밖에 두어
 * 편집으로 사라지지 않게 한다(FACT_GUARD와 같은 이유).
 */
export const TREND_MIXED_SCALE_NOTE = [
  "[주의 — 이 학생의 기록 특성]",
  "- 회차마다 **만점이 다릅니다**(예: 5문제 중 3개 / 100점 만점에 68점).",
  "- 만점이 다른 회차끼리 '올랐다·내려갔다·상승·하락·회복'으로 이으면 사실이 아닙니다. 그렇게 쓰지 마세요.",
  "- **만점이 같은 회차끼리 묶어** 전하세요. 묶음마다 처음과 마지막만 짚으면 충분합니다(전부 나열하지 마세요).",
  "- 🔴 **가장 최근 회차는 반드시 포함하세요.** 만점이 달라 앞 회차와 이을 수 없더라도, 최근 기록은 사실 그대로 적습니다(빠뜨리면 학부모가 오늘 결과를 못 봅니다).",
  "- 🔴 만점이 다르다는 **사정 자체는 문장에 쓰지 마세요** — '비교하기 어렵습니다' 같은 설명은 학부모에게 필요 없는 내부 사정입니다. 기록만 전하세요.",
].join("\n");

/**
 * 추세 프롬프트 — 기본 템플릿(DEFAULT_PROMPTS.trend)에 조립한 [기록]을 주입. edutrix DEFAULT_TREND_PROMPT 이식.
 * template 인자를 주면(원장 DB 오버라이드) 그것을 대신 사용 — 프로덕션은 활성값이 기본을 덮음.
 */
/** 추세 본문(출력 계약 없음) — 통합 호출 섹션용. template=원장 오버라이드. */
export function trendBody(input: TrendInput, template?: string | null): string {
  const body = interpolate(template || DEFAULT_PROMPTS.trend, { historySummary: historySummary(input) });
  return input.scaleMixed ? `${body}\n\n${TREND_MIXED_SCALE_NOTE}` : body;
}

/** 추세 단일 프롬프트(본문 + {trend} 계약) — 미리보기·개별 테스트용. */
export function buildTrendPrompt(input: TrendInput, template?: string | null): string {
  return assembleSingle(trendBody(input, template), "trend");
}
