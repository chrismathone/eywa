/**
 * 선생님 원스크린 — AI 학습 추세(종합분석) 프롬프트(순수 함수).
 * edutrix generateTrendAnalysis + historySummary 조립(reportActions.ts)의 이식.
 * 최근 N회 저장 보고서의 시험·과제 흐름을 한 문단으로 요약한다(멘트와 별개 출력).
 * 실 AI 호출은 server/actions.ts의 generateReportComment(멘트와 통합 1회 호출). 라이브 호출 없음(빌더만).
 * CLAUDE.md 원칙: 계산/프롬프트 조립은 순수 함수 + Vitest.
 */
import { DEFAULT_PROMPTS, interpolate, assembleSingle } from "./prompt-defaults";
import { isNoneValue } from "./none-marker";
import { NOT_SUBMITTED, parseHomeworkRate } from "./homework-rate";

/** 추세 조립 입력 1행 — 저장된 보고서(같은 과목)의 날짜·시험·과제. */
export type TrendHistoryRow = {
  date: string; // YYYY-MM-DD
  examInfo: string | null; // "일일 15/20, 확인 18/20" | null
  homeworkScore: string | null; // 과제 수행률 "90%" | 옛 표기 "완료" | null
  classId?: string | null; // 그 보고서의 반(시험은 이 보고서 반의 기록만 쓴다 — keepExamOfClass)
  makeupClassId?: string | null; // 보강 행(반 없음)이면 보강 반(0171a) — 반 판정은 classId ?? makeupClassId
  /**
   * 그 보고서에 학습 추세가 **실제로 실렸는가**(lesson_reports.trend_note) — 반복 방지(trendNews)가 "지난번에 무엇을 말했나"를 이 행들로 본다.
   * 미지정(undefined) = 모름 → 바로 앞 회차와 견준다(종전 동작).
   */
  hadTrend?: boolean;
};

/**
 * 시험 점수는 **그 반의 기록만** — 다른 반(·반을 모르는 옛 이관분) 행의 시험 칸을 비운다. 과제는 그대로 둔다.
 * 기준 반을 모르면(classId 없음) 손대지 않는다(종전 동작).
 *
 * 🔴 원장 2026-10-15(권민서A 클레임): 수요일 부담임 반 보고서의 추세가 **화·금 담임 반의 일일테스트**(9/29 5/5 → 10/13 1/5)를
 *    가져와 "예전만큼 점수가 나오지는 않고 있습니다"라고 썼다 — 그 반엔 시험 기록이 하나도 없었다. 시험은 반마다 선생님·종류·범위가
 *    달라 이어 붙이면 흐름이 아니다. 2026-07-23 결정(정규·특강만 가름)을 **시험 줄에 한해** 좁힌 것이다(과제 수행률은 같은 과목
 *    정규 반끼리 그대로 함께 본다). 추세 문장과 학부모 그래프가 같은 표본을 보도록 두 조회(score-history.ts)가 함께 부른다.
 */
export function keepExamOfClass<T extends { examInfo: string | null; classId?: string | null; makeupClassId?: string | null }>(
  rows: readonly T[],
  classId: string | null | undefined,
): T[] {
  const cid = classId?.trim();
  if (!cid) return [...rows];
  // 보강 행은 반(class_id)이 비고 보강 반(makeup_class_id)에 그 수업이 남는다 — 그 반에서 본 보강 시험도 그 반 기록이다.
  return rows.map((r) => (r.examInfo && (r.classId ?? r.makeupClassId ?? null) !== cid ? { ...r, examInfo: null } : r));
}

export type TrendInput = {
  count: number; // 분석에 쓴 회차 수(최근 10 이내)
  examTrend: string; // "[07-01] 일일 15/20 -> [07-08] …" | ""
  assignTrend: string; // 과제 흐름 | ""
  /** 오늘 수업 날짜(MM-DD) — 오늘 결과는 알림장 본문이 전하니 추세에서 되풀이하지 않게 표시한다. 모르면 null. */
  today: string | null;
  /**
   * **코드가 정리한 사실 문장**(날짜 없음) — 프롬프트 [기록]에는 날짜 붙은 원기록 대신 이것을 싣는다(trendFacts).
   * 🔴 원장 2026-10-16 *"코드가 문장을 만들어 넘기는것도 괜찮네"* — 모델(Haiku)이 `[09-18] 70% -> [09-21~10-13] 100%(7회)`를 읽다가
   *    "9월 18일부터 일곱 번 연속"처럼 앞 칸 날짜를 붙였다. 같은 입력 9건 비교에서 날짜 없는 사실 문장만 준 쪽(E)이 가장 정확했다.
   * 🔴 **지난 보고서 이후 달라진 것만** 담는다(trendNews) — 같은 말 되풀이 금지(원장 2026-10-16).
   * 🔴 **숫자 없이 정도로만**(원장 2026-10-16 *"최근에는 과제를 잘해오고 있는 편입니다. 정도로 할것. 너무 정확하게 100% 80% 할 필요 없음.
   *    어차피 추세선에 나옴"*) — 퍼센트·문항 수·점수·횟수를 싣지 않는다. 정확한 값은 학부모 추세 그래프가 보여 준다.
   */
  facts: string[];
  /** 말할 것이 없다 — 지난 보고서와 **달라진 게 없거나** 코드가 정리할 사실이 아예 없다. 이번 회차엔 추세를 쓰지 않는다(화면이 자동작성 추세 칸만 비운다). */
  quiet: boolean;
  /** 과제 연속이 **이번 회차에 끝났다**("그동안 N회 연속") — 주의(TREND_STREAK_ENDED_NOTE)가 붙고, 이어지는 말로 쓰면 버린다(findTrendContradictions). */
  streakEnded: boolean;
  /**
   * 시험이 그동안 비슷하다가 **가장 최근 한 번만** 크게 다른가 — 'low'·'high'. 그 한 번을 흐름("예전만 못하다")으로
   * 일반화하지 말라는 코드 측 주의가 붙는다(TREND_LAST_OUTLIER_NOTE). 판정 = examOutlier.
   */
  lastExamOutlier: "low" | "high" | null;
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
 * 시험 줄을 싣는 최소 회차 — **같은 만점**의 시험이 이만큼 있어야 흐름이다(원장 2026-10-15).
 * 2회는 "지난번 5개 → 이번 1개" 비교일 뿐이고, 그건 알림장 본문이 '(지난 회차 대비)'로 이미 전한다(되풀이 금지).
 */
export const MIN_EXAM_TREND_POINTS = 3;

/** 시험 기록의 만점 묶음 열쇠 — 같은 열쇠끼리만 이어 볼 수 있다. 분모를 못 읽으면 빈 열쇠(그것끼리 한 묶음). */
function scaleKey(examInfo: string): string {
  return [...new Set(examScales(examInfo))].sort((a, b) => a - b).join(",");
}

/**
 * 그동안 비슷하다가 **마지막 한 번만** 크게 다른가(순수). 앞 회차들의 폭이 25%p 이내이고 마지막이 그 평균에서 30%p 이상
 * 벗어나면 'low'/'high'. 3회 미만이거나 앞 회차부터 들쭉날쭉하면 null(흐름 판단은 모델 몫).
 * 실례: 9/18 4/5 · 9/29 5/5 · 10/13 1/5 → 앞 80·100(폭 20) 평균 90, 마지막 20 → 'low'.
 */
export function examOutlier(percents: readonly (number | null)[]): "low" | "high" | null {
  const pts = percents.filter((p): p is number => p !== null);
  if (pts.length < MIN_EXAM_TREND_POINTS) return null;
  const prev = pts.slice(0, -1);
  const last = pts[pts.length - 1]!;
  if (Math.max(...prev) - Math.min(...prev) > 25) return null;
  const mean = prev.reduce((s, p) => s + p, 0) / prev.length;
  if (Math.abs(last - mean) < 30) return null;
  // 고르게 이어진 흐름(9→7→5개)은 한 번 튄 게 아니다 — **마지막 한 걸음이 앞 걸음들보다 확연히(두 배 이상) 클 때만** '한 번'이다.
  //    방향만 보면 10·10·10·9·2개가 '조금씩 덜 맞힘'이 된다(적대적 리뷰 2026-10-16 — 10-15 권민서A 유형의 재발).
  const steps = prev.slice(1).map((p, i) => Math.abs(p - prev[i]!));
  if (steps.length && Math.abs(last - prev[prev.length - 1]!) < 2 * Math.max(...steps)) return null;
  return last < mean ? "low" : "high";
}

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
  // 화면 문장 표기("5문제 중 4개 맞음") — 옛 기록·직접 작성 화면이 이 표기로 남긴 것도 같은 만점으로 묶이게.
  for (const m of examInfo.matchAll(/(\d{1,3})\s*문제\s*중/g)) out.push(Number(m[1]));
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
 * opts.today = 오늘 수업 날짜(YYYY-MM-DD) — 추세에서 오늘 결과를 되풀이하지 않게 [기록]에 표시한다.
 */
export function buildTrendInput(allHistory: TrendHistoryRow[], opts: { today?: string | null } = {}): TrendInput | null {
  const line = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "");
  // 호출부는 반복 방지용으로 60일(TREND_NEWS_LOOKBACK_DAYS)을 넘긴다 — 사실·표본은 이번 회차 기준 30일 창만 쓴다(trendNews만 60일을 본다).
  // 기준일 = 오늘(지정 시) · 없으면 기록의 가장 늦은 날(행 순서에 기대지 않는다).
  const latest = allHistory.reduce<string | null>((m, h) => (!m || h.date > m ? h.date : m), null);
  const anchor = opts.today && /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today : latest;
  const history = factWindow(allHistory, anchor);
  // ⚠️ 최근 N개를 **흐름별로 따로** 센다(공통 슬라이스 아님) — 과제만 기록된 날이 흔해서
  // (실측 최근 30일 853행 vs 시험 651행) 공통으로 자르면 과제-only 행이 슬롯을 잠식해
  // 시험 기록이 추세에서 사라진다(실측 215명 중 26명). 두 줄은 프롬프트에서도 독립 문장이라 분리가 안전하다.
  // 🔴 시험은 **가장 최근 시험과 만점이 같은 회차만** 넘긴다(원장 2026-10-15 "프롬프트 전체적으로 손봐"). 만점이 다른 회차를
  //    넘기고 "비교하지 마세요"라고 적었더니 30일 추세 2,602건 중 261건이 "만점이 달라 직접 비교하기는 어렵지만"으로 시작했다 —
  //    지시를 늘리는 대신 **비교할 수 없는 것은 입력에서 뺀다**(compressRuns와 같은 원리). 그렇게 모은 시험이 3회 미만이면
  //    시험 줄을 아예 싣지 않는다(MIN_EXAM_TREND_POINTS).
  //    묶음은 **3회 이상 쌓인 가장 최근 만점** — 가장 최근 시험 하나의 만점으로 정하면 한 번뿐인 월말평가(/25) 뒤에 /5 일일테스트
  //    이력이 통째로 빠진다(적대적 리뷰 2026-10-15).
  const examAll = history.filter((h) => line(h.examInfo));
  const keys = examAll.map((h) => scaleKey(line(h.examInfo)));
  const pickedKey = [...keys].reverse().find((k) => keys.filter((x) => x === k).length >= MIN_EXAM_TREND_POINTS);
  const examRows = pickedKey === undefined ? [] : examAll.filter((_, i) => keys[i] === pickedKey).slice(-TREND_WINDOW);
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
  // 문턱은 '시험·과제 값이 있는 날'로 — 옛 묶음(examRows: 칸 통째의 만점 열쇠)만 보면 "일일 5/5, 확인 8/10"처럼 시험이 둘인 칸이 빠져,
  //   이름별로 읽은 시험 사실이 있어도 추세가 null이 됐다(적대적 재리뷰 2026-10-16). 사실 유무는 아래 trendFacts가 판정한다.
  const dataDates = new Set(history.filter((h) => line(h.examInfo) || (line(h.homeworkScore) && !isNoneValue(h.homeworkScore))).map((h) => h.date));
  if (dataDates.size < MIN_TREND_RECORDS) return null;
  const todayIso = opts.today && /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today : null;
  // 코드가 정리한 사실이 하나도 없으면(분모를 못 읽는 시험뿐 · 부정어로만 말할 수 있는 기록뿐) 새 소식도 없다 → quiet.
  //   [기록]이 빈 채 문장을 요구하지 않는다(모델이 지어낸다 — 적대적 리뷰 2026-10-16). null(표본 부족)로 두면 예전 자동작성 추세가
  //   칸에 그대로 남아 나간다 — quiet면 화면이 자동작성 글만 비운다(손글씨는 둔다).
  const news = trendNews(allHistory, todayIso);
  const examNews = news.filter((f) => f.key !== "hw");
  return {
    count: dates.size,
    examTrend,
    assignTrend,
    today: todayIso ? todayIso.slice(5) : null,
    facts: news.map((f) => f.text),
    quiet: news.length === 0,
    lastExamOutlier: examNews.find((f) => f.outlier)?.outlier ?? null,
    // 시험 이름마다 따로 줄을 세우니, 만점이 다른 두 시험 줄이 함께 실릴 때만 섞임이다.
    scaleMixed: new Set(examNews.map((f) => f.max)).size > 1,
    streakEnded: news.some((f) => f.state.startsWith("broke:")),
  };
}

/**
 * 코드가 정리한 **사실 한 줄**(날짜 없음) — 프롬프트 [기록]에 싣는 단위.
 * `state`는 "지난 보고서 때와 같은 말인가"를 가르는 열쇠다(횟수·숫자는 빼고 흐름의 종류만 — trendNews).
 */
export type TrendFact = {
  key: string; // "hw" | "exam:일일" | "exam:확인" | "exam:테스트"
  // 과제 = "streak:good"(이어짐) · "mostly:good"(대체로) · "broke:good"(막 끝남) — 뒤는 정도(HwBand).
  // 시험 = "up:5" · "flat:5" · "full:5" · "outlier:5"(아래로) · "outlier-high:5"(위로)
  state: string;
  text: string;
  max?: number; // 시험 만점(척도 섞임 판정)
  outlier?: "low" | "high";
  /** 시험 — 그 줄이 말하는 정도(examLevel)와 그 평균(%). '대체로'의 정도가 바뀐 것을 소식으로 알아보는 데 쓴다(isNews). */
  level?: string;
  pct?: number;
};

/** 사실을 세는 창(일) — 추세 이력 조회(score-history `TREND_TEXT_WINDOW_DAYS`)와 같은 30일. */
export const TREND_FACT_WINDOW_DAYS = 30;
/**
 * 반복 방지가 "지난번 추세가 나간 회차"를 찾으려고 **더 읽는** 기간(일) — 그 회차의 30일 창까지 다시 계산할 수 있게.
 * 🔴 30일만 읽으면 지난번 회차가 창 앞쪽으로 밀려 그때의 사실이 사라지고, 비교할 게 없으니 "처음 나온 줄 = 소식"이 되어
 *    주 1회 수업에서 "최근 5회 연속"이 3주마다 나갔다(적대적 재리뷰 2026-10-16). 이보다 오래 조용했으면 한 번 다시 말한다(두 달에 한 번쯤).
 */
export const TREND_NEWS_LOOKBACK_DAYS = 60;
/**
 * 추세 이력을 **읽는** 기간(일) = 지난번 추세를 찾는 60일 + 그 회차의 30일 창. 60일만 읽으면 그 회차의 창 앞쪽이 조회 밖으로 잘려
 * 그때의 사실을 다시 만들지 못한다(같은 되풀이가 49일마다 — 흉내 시험).
 */
export const TREND_HISTORY_FETCH_DAYS = TREND_NEWS_LOOKBACK_DAYS + TREND_FACT_WINDOW_DAYS;

/** 날짜(YYYY-MM-DD) − N일. UTC 산술(KST 경계 무관). */
function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** 그 날짜 기준 사실 창(그날 포함 · 30일 전부터) — 운영 조회(`report_date ≥ 그날−30 · < 그날` + 그날 행)와 같은 모양. */
function factWindow<T extends { date: string }>(rows: readonly T[], end: string | null): T[] {
  if (!end) return [...rows];
  const start = daysBefore(end, TREND_FACT_WINDOW_DAYS);
  return rows.filter((r) => r.date >= start && r.date <= end);
}

/** 과제가 같은 정도로 이만큼 이어져야 '최근 ~하는 편'이라 말한다 — 2회는 흐름이 아니다. */
export const HOMEWORK_STREAK_MIN = 3;
/**
 * 과제 '대체로'는 값의 폭이 이 이하일 때만 말한다 — 0%와 100%를 오가는 기록의 평균은 그 아이의 모습이 아니다(2026-10-16 최종 시험 3건).
 * 폭이 넓으면 [기록]에서 뺀다.
 */
export const HOMEWORK_RANGE_MAX_SPAN = 40;
// 연속 '고비'(5·10·15회) 소식은 없앴다(2026-10-16 저녁) — 횟수를 말하지 않으니 고비 회차의 글은 지난번과 **같은 문장**이 된다.
//   같은 정도가 이어지는 동안은 말하지 않고, 정도가 바뀌거나 이어지던 것이 끝날 때만 말한다(trendNews · 60일 넘게 조용하면 한 번 다시).

/** 한 회차 시험 칸에서 읽은 시험 하나 — 이름 · 맞힌 수(점수) · 만점. */
export type ExamPoint = { date: string; kind: "일일" | "확인" | "테스트"; got: number; max: number };

/**
 * 시험 칸 → **시험별** 점수. `"일일 15/20, 확인 18/20"`은 둘로 읽는다 — 첫 분수만 읽으면 일일 점수가 '확인테스트'라는 이름으로 나가고
 * 확인 점수는 사라진다(적대적 리뷰 2026-10-16). 이름 없는 칸(`"88/100"` · `"88점(100점 만점)"` · `"5문제 중 4개 맞음"` — 옛 이관분)은
 * 점수가 하나일 때만 '테스트'로 읽는다. 못 읽으면 빈 배열 — 그 회차는 시험 흐름에서 빠진다(지어내지 않는다).
 */
export function examPointsOf(date: string, examInfo: string): ExamPoint[] {
  // 소수 점수("일일 4.5/5" — 사무실 직접 작성은 자유 입력)는 읽지 않는다 — 정수 정규식이 "5/5"로 오독했다(적대적 재리뷰 2026-10-16).
  if (/\d\.\d/.test(examInfo)) return [];
  const ok = (p: ExamPoint) => p.max > 0 && p.got <= p.max;
  const labeled: ExamPoint[] = [];
  for (const m of examInfo.matchAll(/(일일|확인)\s*(\d{1,3})\s*\/\s*(\d{1,3})(?!\d)/g))
    labeled.push({ date, kind: m[1] as "일일" | "확인", got: Number(m[2]), max: Number(m[3]) });
  if (labeled.length) return labeled.filter(ok);
  const found: [number, number][] = [
    ...[...examInfo.matchAll(/(?<!\d)(\d{1,3})\s*\/\s*(\d{1,3})(?!\d)/g)].map((m): [number, number] => [Number(m[1]), Number(m[2])]),
    ...[...examInfo.matchAll(/(\d{1,3})\s*점\s*\(?\s*(\d{1,3})\s*점\s*만점/g)].map((m): [number, number] => [Number(m[1]), Number(m[2])]),
    ...[...examInfo.matchAll(/(\d{1,3})\s*문제\s*중\s*(\d{1,3})\s*개/g)].map((m): [number, number] => [Number(m[2]), Number(m[1])]),
  ];
  if (found.length !== 1) return [];
  const p: ExamPoint = { date, kind: "테스트", got: found[0]![0], max: found[0]![1] };
  return ok(p) ? [p] : [];
}

/**
 * 시험 이름마다 **3회 이상 쌓인 가장 최근 만점** 한 줄씩(만점이 다른 회차는 이어 볼 수 없다 — 2026-10-15).
 * 이름 없는 점수('테스트')는 **만점이 같은 이름 붙은 시험이 하나뿐이면** 그 시험으로 본다 — 옛 표기("5문제 중 5개 맞음")가
 * 일일테스트 흐름에서 떨어져 나가지 않게(종전 묶음 규칙과 같다). 둘 이상이면 어느 쪽인지 몰라 '테스트'로 둔다.
 */
function examSeries(raw: readonly ExamPoint[]): ExamPoint[][] {
  const points = raw.map((p) => {
    if (p.kind !== "테스트") return p;
    const named = [...new Set(raw.filter((q) => q.kind !== "테스트" && q.max === p.max).map((q) => q.kind))];
    return named.length === 1 ? { ...p, kind: named[0]! } : p;
  });
  const kinds = [...new Set(points.map((p) => p.kind))];
  return kinds.flatMap((kind) => {
    const ps = points.filter((p) => p.kind === kind);
    const max = [...ps].reverse().find((p) => ps.filter((q) => q.max === p.max).length >= MIN_EXAM_TREND_POINTS)?.max;
    return max === undefined ? [] : [ps.filter((p) => p.max === max).slice(-TREND_WINDOW)];
  });
}

/** 시험에서 맞힌 **정도**(말) — 숫자 대신(원장 2026-10-16 *"너무 정확하게 … 할 필요 없음. 어차피 추세선에 나옴"*). */
function examLevel(pct: number): string {
  // '~편' 한 번만 흐린다 — "대체로 대부분 맞힘"을 모델이 "대부분의 문제를 대체로 맞혀"로 옮겼다(2026-10-16 시험 120회).
  if (pct >= 90) return "거의 다 맞히는 편";
  if (pct >= 70) return "대부분 맞히는 편";
  if (pct >= 50) return "절반 이상 맞히는 편";
  return "절반 아래로 맞히는 편";
}
const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * 시험 사실 한 줄 — 흐름은 **코드가** 판정한다(한 번 튐 · 연속 오름 · 모두 다 맞힘 · 그 정도). 날짜·숫자·횟수는 넣지 않는다.
 * 🔴 **덜 맞히는 흐름은 줄을 만들지 않는다**(null) — 원장 2026-10-16 *"점점 못해진다. 이런거 정도가 아니면 되는거지"*: 막을 것은
 *    나빠지는 흐름으로 묶는 말이다("덜 맞힘·줄었음"은 '점점 못해진다'로 읽힌다). 정도(절반 아래로 맞히는 편)는 사실이라 싣는다. 흐름은 그래프가 보여 준다.
 */
function examFact(series: readonly ExamPoint[], today: string | null): TrendFact | null {
  const { kind, max } = series[0]!;
  const v = series.map((p) => p.got);
  const pct = v.map((x) => (x / max) * 100);
  const name = kind === "일일" ? "일일테스트" : kind === "확인" ? "확인테스트" : "테스트";
  const score = max === 100;
  const lastWhen = today && series[series.length - 1]!.date === today ? "오늘" : "가장 최근";
  const outlier = examOutlier(pct);
  const last3 = pct.slice(-3);
  const steps = last3.slice(1).map((p, i) => p - last3[i]!);
  let state: string;
  let flow: string | null;
  // 정도와 그 평균 — '한 번 튐'은 그 한 번을 뺀 그동안의 것(isNews가 정도 변화를 견준다).
  const basis = outlier ? pct.slice(0, -1) : pct;
  const level = examLevel(mean(basis));
  if (outlier) {
    // 위로든 아래로든 튄 한 번은 말하지 않고 **그동안의 모습**만 — 그 한 번은 본문(오늘)·그래프가 전한다(10-15 권민서A 클레임의 결).
    //   위로 튄 한 번만 사실 줄로 주면 주의("그동안의 결과를 중심으로")·항목 간 규칙("오늘 사실을 되풀이 말 것")과 맞물려 쓸 재료가 없다(적대적 리뷰 2026-10-16).
    state = outlier === "high" ? "outlier-high" : "outlier";
    flow = `그동안은 ${level}이었음(${lastWhen} 한 번은 평소와 달랐지만 한 번은 흐름이 아님)`;
  } else if (steps.every((s) => s > 0)) {
    state = "up";
    flow = score ? "최근 들어 점수가 오르고 있음" : "최근 들어 맞히는 문제가 늘고 있음";
  } else if (steps.every((s) => s < 0)) {
    state = "down";
    flow = null;
  } else if (v.every((x) => x === max)) {
    state = "full";
    flow = score ? "모두 만점" : "모두 다 맞힘";
  } else {
    state = "flat";
    // 오가는 기록(0개 · 5개 · 0개 …)의 평균은 그 아이의 모습이 아니다 — 과제 '대체로'와 같은 폭 제한(적대적 리뷰 2026-10-16:
    //   0/5·5/5·0/5·5/5·5/5가 "절반 넘게 맞히는 편"이 됐다 — 그렇게 맞힌 날이 하루도 없다).
    flow = Math.max(...pct) - Math.min(...pct) > HOMEWORK_RANGE_MAX_SPAN ? null : level;
  }
  if (!flow) return null;
  return { key: `exam:${kind}`, state: `${state}:${max}`, text: `${name}: ${flow}`, max, level, pct: mean(basis), ...(outlier ? { outlier } : {}) };
}

/**
 * 과제 수행 **정도** — 퍼센트 대신 이 단계로 묶어 말한다. 정확한 값은 학부모 추세 그래프가 보여 준다.
 * 🔴 원장 2026-10-16 *"최근에는 과제를 잘해오고 있는 편입니다. 정도로 할것. 너무 정확하게 100% 80% 할 필요 없음. 어차피 추세선에 나옴"*
 *    → 100·100·80은 같은 '잘 해 옴'이다(값이 조금 달라도 같은 모습이 이어진다).
 * 🔴 0%(zero)·미제출(nosub)도 사실대로 말한다 — 원장 2026-10-16 *"점점 못해진다. 이런거 정도가 아니면 되는거지"*(막을 것은 나빠지는
 *    흐름으로 묶는 말 · 본문의 "제출하지 않았습니다"도 *"학부모도 납득할 정도"*). 단계는 따로 둔다 — 미제출과 0%가 서로·다른 단계와
 *    한 묶음으로 이어지지 않게(적대적 재리뷰 2026-10-16 · 학부모 글에선 '안 내 옴'과 '못 해 옴'이 갈린다).
 * 숫자로 못 읽는 옛 표기('일부 미흡')는 단계가 없다(null — 그 값이 든 흐름은 말하지 않는다).
 */
type HwBand = "good" | "part" | "some" | "zero" | "nosub";
function homeworkBand(raw: string): HwBand | null {
  if (raw.trim() === NOT_SUBMITTED) return "nosub";
  const n = parseHomeworkRate(raw);
  return n === null ? null : rateBand(n);
}
const rateBand = (n: number): HwBand => (n >= 80 ? "good" : n >= 50 ? "part" : n > 0 ? "some" : "zero");
/** 단계마다 이어지는 말. 0%·미제출은 본문의 말(`homeworkFactValue`)과 같은 결로. */
const HW_WORDS: Record<HwBand, string> = {
  good: "잘 해 오고 있는 편",
  part: "절반 이상 해 오는 편",
  some: "조금씩 해 오고 있는 편",
  zero: "해 오지 못하고 있음",
  nosub: "제출하지 않고 있음",
};
/** 그 묶음의 말 — 전부 100%(완료)면 '빠짐없이'(원장 2026-10-16 *"100% -> 빠짐없이 잘"*). */
function homeworkWords(key: string, raws: readonly string[]): string | null {
  const words = (HW_WORDS as Record<string, string | undefined>)[key];
  if (!words) return null; // 단계가 없는 옛 표기('?일부 미흡')
  if (key === "good" && raws.every((r) => parseHomeworkRate(r) === 100)) return "빠짐없이 잘 해 오고 있음";
  return words;
}

/**
 * 과제 사실 한 줄 — 최근에 이어진 같은 정도(3회 이상) · 최근 대체로의 정도 중 하나. 날짜·횟수·퍼센트는 넣지 않는다.
 * 숫자로 읽을 수 없는 값('일부 미흡')이 섞인 '대체로'는 싣지 않는다(일부만 골라 말하면 사실이 비틀린다).
 */
function homeworkFact(rows: readonly { date: string; value: string }[]): TrendFact | null {
  if (rows.length < 2) return null;
  const runs: { key: string; raws: string[]; last: string }[] = [];
  for (const r of rows) {
    // 단계가 없는 옛 표기는 제 글자로 따로 묶는다(어느 단계와도 이어지지 않게).
    const key = homeworkBand(r.value) ?? `?${r.value.trim()}`;
    const tail = runs[runs.length - 1];
    if (tail && tail.key === key) {
      tail.raws.push(r.value);
      tail.last = r.date;
    } else runs.push({ key, raws: [r.value], last: r.date });
  }
  const L = runs[runs.length - 1]!;
  if (L.raws.length >= HOMEWORK_STREAK_MIN) {
    const words = homeworkWords(L.key, L.raws);
    return words ? { key: "hw", state: `streak:${L.key}`, text: `과제: 최근 ${words}` } : null;
  }
  // 🔴 이어지던 모습이 **막 끝난 회차**엔 과제 줄을 만들지 않는다(2026-10-16 저녁) — "그동안 잘 해 왔음"을 실었더니 본문 "지난 과제는
  //    70%를 해 왔습니다" 바로 뒤에 "그동안 과제도 잘 해 왔습니다"가 붙어 읽는 사람이 헷갈렸다(Codex 검수 90건 중 c1·c29·c63 · 원장 기준
  //    '추세↔본문 어긋남'). 0%·미제출이 끝나 해 온 날엔 지난 부정만 말하게 됐다(재리뷰). 그날 값은 본문이 전하고, 새로 이어지면 그때 말한다.
  //    끝난 날은 아래 '대체로'도 가장 최근 값의 정도가 달라 줄이 생기지 않는다.
  const recent = rows.slice(-TREND_WINDOW);
  // 미제출이 섞인 '대체로'는 싣지 않는다 — 평균에 0으로 들어가 '제출하지 않음'을 '덜 해 옴'으로 바꾼다.
  if (recent.some((r) => r.value.trim() === NOT_SUBMITTED)) return null;
  const nums = recent.map((r) => parseHomeworkRate(r.value));
  if (!nums.every((x): x is number => x !== null)) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  if (lo === hi) return null; // 2회 같은 값 — 이어졌다고 하기엔 짧다
  if (hi - lo > HOMEWORK_RANGE_MAX_SPAN) return null; // 0%와 100%를 오감 = 정도라 할 게 없다
  const band = rateBand(mean(nums));
  // 3회 이상 · **가장 최근 값도 같은 정도**일 때만 — 40%·0%(오늘)에 "조금씩 해 오고 있는 편"이라 쓰면 본문("하나도 해오지 못함")과
  //   어긋난다(적대적 리뷰 2026-10-16). 최근이 다른 정도면 아직 '대체로'라 말할 때가 아니다.
  if (recent.length < HOMEWORK_STREAK_MIN || rateBand(nums[nums.length - 1]!) !== band) return null;
  const words = HW_WORDS[band];
  // '대체로'를 따로 붙이지 않는다 — '~편'이 이미 흐린 말이다("대체로 절반 넘게 해 오는 편"이 그대로 옮겨졌다, 2026-10-16 시험). 이어진 경우와
  //   같은 문장이 되는 것은 괜찮다 — 같은 정도면 같은 말이고, 둘 사이를 오가는 것은 소식이 아니다(isHomeworkNews).
  return { key: "hw", state: `mostly:${band}`, text: `과제: 최근 ${words}` };
}

/** 기록 전체(날짜 오름차순)에서 코드가 정리한 사실 줄들 — 시험(이름별) 먼저, 과제 나중. 순수. */
export function trendFacts(history: readonly TrendHistoryRow[], today: string | null): TrendFact[] {
  const line = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "");
  const points = history.flatMap((h) => (line(h.examInfo) ? examPointsOf(h.date, line(h.examInfo)) : []));
  const exams = examSeries(points).flatMap((s) => examFact(s, today) ?? []);
  const hw = homeworkFact(
    history.filter((h) => line(h.homeworkScore) && !isNoneValue(h.homeworkScore)).map((h) => ({ date: h.date, value: line(h.homeworkScore) })),
  );
  return hw ? [...exams, hw] : exams;
}

/**
 * 지난 보고서 때와 견줘 **새 소식인가**. 처음 나온 줄 · 흐름(정도)이 바뀐 줄만 참.
 * '대체로'로 **돌아온 것**은 소식이 아니다 — 끝난 그 회차, 흐름이 바뀐 그 회차에 이미 말했다.
 */
function isNews(now: TrendFact, prev: TrendFact | undefined): boolean {
  if (!prev) return true;
  if (now.key === "hw") return isHomeworkNews(now.state, prev.state);
  // 시험 — '대체로'로 돌아온 것은 소식이 아니다. 단 **정도가 확연히 바뀐 '대체로'**는 소식이다(지난번 말한 정도와 15%p 이상) —
  //   이제 문장의 내용이 곧 정도라, '절반 아래로'를 말한 뒤 '대부분 맞히는 편'이 영영 안 나가던 것(적대적 리뷰 2026-10-16).
  //   15%p 문턱 = 평균이 경계(50·70·90) 언저리에서 출렁일 때 회차마다 뒤집혀 나가지 않게.
  //   '한 번 튐'도 그 줄이 말하는 것은 '그동안의 정도'라 같은 규칙 — 지난번 말한 정도와 같으면 되풀이다(재리뷰 2026-10-16:
  //   '대부분 맞히는 편'을 말한 다음 회차에 한 번 튀자 "그동안은 대부분 맞히는 편이었음"이 다시 나갔다).
  if (now.state.startsWith("flat:") || now.state.startsWith("outlier")) {
    return now.level !== prev.level && Math.abs((now.pct ?? 0) - (prev.pct ?? 0)) >= EXAM_LEVEL_NEWS_GAP;
  }
  return now.state !== prev.state;
}
/** 시험 '대체로'의 정도가 바뀌었다고 말하려면 지난번 말한 정도의 평균에서 이만큼(%p) 움직여야 한다 — 경계 출렁임 방지. */
const EXAM_LEVEL_NEWS_GAP = 15;

/**
 * 과제 소식 — 횟수를 말하지 않으니 **정도가 같으면 같은 문장**이다('최근 잘 해 오고 있는 편' ↔ '최근 대체로 잘 해 오고 있는 편').
 *  · '막 끝남'은 사실 줄을 만들지 않는다(homeworkFact — 본문과 어긋나 헷갈렸다).
 *  · '대체로'끼리는 정도가 달라도 소식이 아니다 — 평균이 경계(80·50) 언저리면 값 하나에 단계가 뒤집혀 "잘 해 오는 편"과 "절반 넘게"가
 *    회차마다 번갈아 나갔다(적대적 리뷰 2026-10-16). 정도가 정말 바뀌었으면 같은 정도가 이어지는(streak) 회차에 말한다.
 *  · 그 밖 = 정도가 바뀌었을 때만.
 */
function isHomeworkNews(now: string, prev: string): boolean {
  const split = (s: string) => {
    const i = s.indexOf(":");
    return [s.slice(0, i), s.slice(i + 1)] as const;
  };
  const [nk, nb] = split(now);
  const [pk, pb] = split(prev);
  if (nk === "mostly" && pk === "mostly") return false;
  return nb !== pb;
}

/**
 * 이번 보고서에 실을 사실 = 기록 전체의 사실 중 **바로 앞 회차까지의 기록과 견줘 달라진 것**(순수 · 결정적 — 저장 없이 기록만으로).
 * 🔴 원장 2026-10-16 *"오늘은 7회 연속이라 말했는데, 다음엔 또 8회 연속이라는 같은 말을 반복할거 아냐. 완전 AI 티 팍팍 나네"* —
 *    30일 실측: AI 추세 830건 중 65%가 '과제 N회 연속·모두'를 말했고, 같은 학생 바로 다음 보고서에도 또 말한 쌍이 57%(690쌍 중 391쌍).
 *    지시("되풀이하지 마세요")를 늘리는 대신 **되풀이할 재료를 넘기지 않는다**(compressRuns와 같은 원리).
 * 마지막 행 = 이번 회차(호출부가 오늘 값을 끝에 붙인다). 이번 회차에 시험·과제가 없으면 앞과 같으니 빈 배열.
 */
export function trendNews(history: readonly TrendHistoryRow[], today: string | null): TrendFact[] {
  const end = history.length ? history[history.length - 1]!.date : null;
  const now = trendFacts(factWindow(history, end), today);
  const prior = history.slice(0, -1);
  // 그 회차의 사실은 **그 회차 날짜의 30일 창**으로 — 그때 학부모가 받은 추세를 만든 것과 같은 재료다.
  const factsUpTo = (cut: number) => {
    const rows = prior.slice(0, cut);
    return trendFacts(factWindow(rows, rows.length ? rows[rows.length - 1]!.date : null), null);
  };
  // 추세를 실었는지(hadTrend) 모르는 기록이면 바로 앞 회차와 견준다(종전 동작).
  if (!prior.some((h) => h.hadTrend !== undefined)) {
    const before = factsUpTo(prior.length);
    return now.filter((f) => isNews(f, before.find((b) => b.key === f.key)));
  }
  // 아는 기록이면 **추세가 나간 회차**와 견준다 — 그 뒤 추세가 안 나간 회차(달라진 것 없음 · 검사에 걸려 버림 · 미발송 설정 · 자동작성
  // 안 함)의 소식은 아직 학부모가 못 들은 것이다(적대적 재리뷰 2026-10-16). **최근 60일 안에서만** 찾는다 — 그보다 오래 조용했으면 비교
  // 기준 없이(= 한 번 다시 말한다). 그 회차의 30일 창은 호출부가 90일(TREND_HISTORY_FETCH_DAYS)을 읽어 온전히 들어온다.
  const since = end ? daysBefore(end, TREND_NEWS_LOOKBACK_DAYS) : "";
  const cuts: number[] = [];
  for (let i = prior.length - 1; i >= 0 && prior[i]!.date >= since; i--) if (prior[i]!.hadTrend) cuts.push(i + 1);
  // 🔴 **항목(과제·시험)마다** 그 항목을 말할 수 있었던 가장 최근 회차와 견준다(재리뷰 2026-10-16) — 마지막 추세 회차에 그 항목 줄이
  //    없었다는 이유로(그날 과제가 출렁여 줄이 안 생김 등) '처음 나온 줄'로 보면, 잠깐 끊겼다 돌아온 같은 말이 다시 나갔다.
  const memo = new Map<number, TrendFact[]>();
  const at = (cut: number) => memo.get(cut) ?? memo.set(cut, factsUpTo(cut)).get(cut)!;
  return now.filter((f) => {
    for (const cut of cuts) {
      const prev = at(cut).find((b) => b.key === f.key);
      if (prev) return isNews(f, prev);
    }
    return true;
  });
}

/** 프롬프트 [기록] 블록 — 이번에 달라진 사실 줄(날짜 없음). */
function historySummary(input: TrendInput): string {
  const lines = [
    "분석 대상: 지난 알림장 이후 새로 달라진 점만 코드가 골라 정리한 사실입니다 — 이 말의 정도 그대로 쓰고, 숫자(퍼센트·점수·문항 수·횟수)와 날짜·요일·달은 쓰지 마세요.",
  ];
  for (const f of input.facts) lines.push(`- ${f}`);
  if (input.today) lines.push("'오늘'이라 적힌 결과는 알림장 본문이 이미 전합니다. 다시 풀어 쓰지 말고 그동안의 모습을 쓰세요.");
  return lines.join("\n");
}

/**
 * 척도가 섞인 학생에게만 붙는 **코드 측 주의**. 프롬프트 본문(원장 편집 가능) 밖에 두어
 * 편집으로 사라지지 않게 한다(FACT_GUARD와 같은 이유).
 */
export const TREND_MIXED_SCALE_NOTE = [
  "[주의 — 이 학생의 기록 특성]",
  // 2026-10-15부터 만점이 다른 회차는 입력에서 빠진다 — 이 주의가 붙는 건 **한 회차에 시험이 둘**(일일·확인)인 경우뿐이다.
  "- 한 회차에 시험이 둘 있고 시험마다 **만점이 다릅니다**.",
  "- 시험끼리 '올랐다·내려갔다·상승·하락·회복'으로 이으면 사실이 아닙니다. 시험별로 따로, [기록]의 말 그대로 쓰세요.",
  // 2026-10-16 저녁: [기록]에 숫자가 없다 — 예전 이 주의의 숫자 예시('10문제 중 9개를 맞힌 날도…')를 따르면 '숫자' 검사로 추세가 버려진다(적대적 리뷰).
  //   '9~15문제 중 9~15개'(2026-08-13 실측) 같은 범위 표기는 숫자 검사가 함께 막는다.
  "- 숫자(문항 수·점수·몇 개)는 쓰지 마세요.",
  "- 🔴 만점이 다르다는 **사정 자체는 문장에 쓰지 마세요** — '비교하기 어렵습니다' 같은 설명은 학부모에게 필요 없는 내부 사정입니다. 기록만 전하세요.",
].join("\n");

/**
 * 시험이 **마지막 한 번만** 크게 다른 학생에게 붙는 코드 측 주의(원장 2026-10-15 권민서A 클레임 — 9/18 4/5 · 9/29 5/5 뒤 10/13 1/5
 * 한 번을 "예전만큼 점수가 나오지는 않고 있습니다"로 일반화했다). 프롬프트 본문(원장 편집 가능) 밖이라 편집으로 사라지지 않는다.
 */
export const TREND_LAST_OUTLIER_NOTE = [
  "[주의 — 이 학생의 시험 기록]",
  "- 그동안은 결과가 비슷했고 **가장 최근 한 번만** 크게 다릅니다. 한 번은 흐름이 아닙니다 — '예전만 못하다', '요즘 올랐다'처럼 쓰지 마세요.",
  "- 그동안의 결과를 중심으로 쓰세요. 그 한 번은 쓰지 않아도 됩니다 — 쓰더라도 숫자·날짜 없이 '한 번은 평소와 달랐다' 정도로만, 이유·평가·대책을 붙이지 마세요.",
].join("\n");

/**
 * 추세 프롬프트 — 기본 템플릿(DEFAULT_PROMPTS.trend)에 조립한 [기록]을 주입. edutrix DEFAULT_TREND_PROMPT 이식.
 * template 인자를 주면(원장 DB 오버라이드) 그것을 대신 사용 — 프로덕션은 활성값이 기본을 덮음.
 */
/** 추세 본문(출력 계약 없음) — 통합 호출 섹션용. template=원장 오버라이드. */
/**
 * 과제 연속이 **이번에 끝난** 학생에게 붙는 코드 측 주의(2026-10-16 운영 조건 시험) — "그동안 4회 연속 30%"를 "해 오고 있습니다"(이어지는 것처럼)로
 * 쓴 글이 11건 중 6건이었다(오늘 값은 이미 달라졌다). 사실 문장에 괄호 설명("(이번엔 달라짐)")을 달면 이번엔 그 말을 그대로 옮겨
 * "이번에는 그 흐름과 달라졌습니다"가 나왔다 — 그래서 문장이 아니라 이 자리(원장 편집 밖)에 둔다.
 */
export const TREND_STREAK_ENDED_NOTE = [
  "[주의 — 이 학생의 과제 기록]",
  "- '그동안 ~해 왔음'은 **이번 회차에 끝난 흐름**입니다. '~해 왔습니다'처럼 지난 일로 쓰고, '~해 오고 있습니다'·'계속'처럼 이어지는 말로 쓰지 마세요.",
  "- 오늘 결과는 알림장 본문이 전합니다 — '이번에는 달라졌다'고 따로 덧붙이지 마세요.",
].join("\n");

/**
 * 생성된 추세가 **[기록]과 어긋나는가**(순수) — 끝난 연속을 이어지는 말로 쓴 것. 걸리면 호출부가 추세를 싣지 않는다(없는 것보다 거짓이 나쁘다).
 * ⚠️ 시험 줄이 함께 있으면 "올랐고 … 해 오고 있습니다"가 시험에 붙은 말일 수 있어 **과제 문장만** 본다(과제가 든 문장).
 */
export function findTrendContradictions(input: Pick<TrendInput, "streakEnded">, text: string): string[] {
  if (!input.streakEnded) return [];
  // 문장·쉼표 마디로 쪼개 과제(숙제)·연속 마디만 본다 — 같은 문장의 시험 마디("꾸준히 잘 하고 있습니다")는 대조 밖(적대적 재리뷰 2026-10-16).
  // '계속'은 뺀다 — "계속해서 일곱 번 연속 해 왔습니다"(과거)를 버렸다. 이어짐은 '~해 오고 있다·~해 오는 중·이어 가다'로 판정.
  const ONGOING = /(?:해|챙겨|지켜|가져|빠짐없이)\s*오(?:고\s*있|는\s*중)|이어\s*가(?:고|는)/;
  const clauses = text.split(/(?<=[.!?])\s+|[,，]\s*|\n+/);
  // '연속·매번·그동안' 마디는 시험 마디("일일테스트는 세 번 연속 … 이어 가고")를 빼고 본다(재리뷰 2026-10-16).
  const hit = clauses.some(
    (c) => (/과제|숙제/.test(c) && (ONGOING.test(c) || /하고\s*있/.test(c))) || (/연속|매번|그동안/.test(c) && !/테스트|시험|문제/.test(c) && ONGOING.test(c)),
  );
  return hit ? ["끝난 연속을 이어진다고 씀"] : [];
}

export function trendBody(input: TrendInput, template?: string | null): string {
  const body = interpolate(template || DEFAULT_PROMPTS.trend, { historySummary: historySummary(input) });
  const notes = [
    input.scaleMixed ? TREND_MIXED_SCALE_NOTE : "",
    input.lastExamOutlier ? TREND_LAST_OUTLIER_NOTE : "",
    input.streakEnded ? TREND_STREAK_ENDED_NOTE : "",
  ].filter(Boolean);
  return notes.length ? `${body}\n\n${notes.join("\n\n")}` : body;
}

/**
 * 생성된 추세 문장의 **척도 온전성** 검사 — 사실일 수 없는 표기를 잡는다(순수).
 *
 * 🔴 2026-08-13 실측: *"큰 변화 없이 **9~15문제 중 9~15개** 선을 유지하고 있으며"* 가 실제로 나갔다.
 *    일일테스트 만점이 회차마다 달라(10·16·22문제) 모델이 서로 다른 척도를 한 범위로 뭉갠 것이다.
 *    지금은 이미지 안에 묻혀 잘 안 읽히지만 **본문이 텍스트가 되면 그대로 읽힌다.**
 *
 * 🔑 판정 기준은 "숫자가 이상한가"가 아니라 **"그 표기가 가능한가"**다:
 *    · `9~15문제` — 한 회차의 문항 수는 하나뿐이라 **분모에 범위는 불가능**하다 → 거짓
 *    · `10문제 중 8~9개` — 만점이 같고 점수만 달랐던 것이라 **정상**이다(막으면 안 된다)
 *    · `9~15점 만점` — 만점에 범위 → 거짓
 *    ⚠️ 프롬프트만 믿지 않는다. 위 주의 문구가 이미 있었는데도 뚫렸다.
 *
 * @returns 문제 표기들(빈 배열 = 이상 없음)
 */
export function findImpossibleScaleSpans(text: string): string[] {
  const out: string[] = [];
  // 분모(문항 수)·만점에 붙은 범위. '~'·'-'·'∼' 전부. 숫자와 단위 사이 공백 허용.
  for (const re of [/\d+\s*[~\-∼]\s*\d+\s*문제/g, /\d+\s*[~\-∼]\s*\d+\s*점\s*만점/g]) {
    for (const m of text.matchAll(re)) out.push(m[0]);
  }
  return out;
}

/** 추세 문장을 학부모에게 내보내도 되는가 — 사실일 수 없는 척도 표기가 없으면 true. */
export function isTrendScaleSane(text: string): boolean {
  return findImpossibleScaleSpans(text).length === 0;
}

/**
 * 추세에 **있을 수 없는 문장** — [기록]은 날짜·점수·과제 수행률뿐이라, 아래는 전부 모델이 지어낸 것이다(순수).
 * 🔴 원장 2026-10-15: 프롬프트 예시였던 "수업 중 집중력을 조금 더 챙겨 보려 합니다"가 30일 추세에 90건 그대로 나갔다(권민서A
 *    클레임의 한 문장). 프롬프트에서 예시를 지웠지만 **프롬프트만 믿지 않는다**(척도 범위 후검증과 같은 이유) — 걸리면 추세를 싣지 않는다.
 *  · 기록 사정 설명("만점이 달라 직접 비교하기는 어렵지만") — 학부모에게 필요 없는 내부 사정(30일 261건)
 *  · 원인 짐작("집중력") · 학원 계획("~겠습니다", "~려고 합니다") · 원색 표현("떨어졌") · 전망("오를 것")
 * @returns 걸린 이유들(빈 배열 = 이상 없음)
 */
// 🔴 해요체도 같이 막는다 — TONE_RULES가 '~했어요'를 허용하므로 "관리해 볼게요"·"하려고 해요"·"오를 거예요"가 빠져나간다(적대적 리뷰 2026-10-15).
const TREND_BANNED: readonly { re: RegExp; why: string; except?: RegExp }[] = [
  { re: /직접\s*비교|비교(?:하기|가)\s*(?:는|가)?\s*어렵|만점이\s*(?:서로\s*)?(?:다르|달라|일정하지)|기록이\s*(?:많지|적|부족)/, why: "기록 사정 설명" },
  { re: /집중|실수/, why: "원인 짐작" },
  { re: /겠|려고?\s*(?:합니다|해요)/, why: "정해지지 않은 계획" },
  { re: /떨어졌|떨어지고|하락|부진|나빠졌|나빠지고|저조/, why: "원색적인 표현" },
  // 2026-10-15 비교 생성에서 나옴: "과제는 아직 안정적이지 못한 상태입니다" — 기록은 숫자뿐이라 평가는 지어낸 것이다.
  { re: /안정적이지\s*(?:못|않)|미흡|부족|아쉽|아쉬운/, why: "평가" },
  { re: /기대/, why: "전망" },
  // 2026-10-16: [기록]에 날짜를 안 싣는다(코드가 정리한 사실 문장) — 문장에 날짜가 나오면 모델이 지어낸 것이다.
  //    "3일 연속"·"주 2회"·"일일테스트"는 날짜가 아니다(걸리지 않는다).
  { re: /\d{1,2}\s*월|지난\s*\d{1,2}\s*일|\d{1,2}\s*일\s*(?:부터|까지|에|엔|날|이후|자)|\d{1,2}\s*일(?=\s*(?:일일|확인|테스트|수업|과제))|어제|그제|지난\s*(?:주|달)|이번\s*달|[월화수목금토일]요일|\d+\s*주\s*(?:동안|간|째)|일주일|보름|(?:한|두)\s*달/, why: "날짜" },
  // 2026-10-16 저녁(원장 *"너무 정확하게 100% 80% 할 필요 없음. 어차피 추세선에 나옴"*): [기록]에 숫자가 없다 — 문장에 숫자·횟수가
  //    나오면 모델이 지어내거나 본문에서 끌어온 것이다(그날 값은 본문이 전한다). "한 번만"·"한 번은"은 횟수가 아니다(한 번 튐).
  { re: /\d|퍼센트|(?:두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|몇)\s*(?:번|회|차례)|(?:한|두|세|네)\s*(?:번|회)\s*(?:연속|째)|연속\s*(?:으로\s*)?(?:두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*번/, why: "숫자" },
  // 원장 2026-10-16 *"점점 못해진다. 이런거 정도가 아니면 되는거지"* — 나빠지는 흐름으로 묶는 말. [기록]엔 덜 맞히는 흐름이 없다
  //    (examFact가 싣지 않는다) — 문장에 나오면 본문의 '지난 회차 대비 ▼'를 끌어왔거나 지어낸 것이다. '못 해 왔다'(사실)는 걸리지 않는다.
  {
    re: /(?:점점|갈수록|날로|차츰)\s*(?:더\s*)?(?:못|덜|줄|낮아|내려|떨어|나빠|흐트러)|예전(?:만큼은?|만)\s*(?:못|안|나오지|하지|맞히지)|(?:예전|전|지난번|이전|평소)보다\s*(?:[가-힣]+\s+){0,2}(?:더\s*)?(?:못|덜|줄|낮|적게)|(?:맞힌|맞히는)\s*(?:문제|개수)(?:가|도|는)?\s*(?:조금씩\s*)?(?:줄|적어)|점수(?:가|도|는)?\s*(?:조금씩\s*)?(?:낮아(?!도)|내려(?!가지\s*않))/,
    why: "나빠지는 흐름",
    // 줄어드는 것이 **틀린 것**이면 좋아지는 말이다 — "틀리는 문제가 점점 줄고"·"전보다 덜 틀리고"·"오답이 갈수록 줄어"를 버렸다(재리뷰 2026-10-16).
    except: /틀리|틀린|틀려|오답|놓치|놓친|실수|헤매|모르는/,
  },
];
/** 문장·쉼표 마디 — 예외(except)는 걸린 표현과 **같은 마디**에서만 본다(다른 마디의 '틀린'이 진짜 나빠지는 말을 덮지 않게). */
const clausesOf = (text: string) => text.split(/(?<=[.!?])\s+|[,，]\s*|\n+/);

/** 받침이 ㄹ인 한글 음절인가(종성 인덱스 8). "볼·할·챙길·가르칠·쓸·좋을·될"… */
const hasRieulFinal = (ch: string | undefined): boolean => {
  if (!ch) return false;
  const c = ch.charCodeAt(0) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 === 8;
};

/**
 * 약속형('~ㄹ게요' — 볼게요·가르칠게요·신경 쓸게요)과 전망형('~ㄹ 거예요/겁니다/것입니다/것으로' — 잘할 거예요·좋아질 겁니다)을
 * **받침으로** 판정한다. 낱자 목록으로 적으면 "살필게요"·"회복될 거예요"가 빠져나간다(적대적 재리뷰 2026-10-15).
 * ⚠️ "늘 거르지 않고"처럼 뒤가 '거르'인 정상 문장은 걸리지 않는다(어미 목록에 없다).
 */
function rieulEndings(text: string): { plan: boolean; forecast: boolean } {
  let plan = false;
  let forecast = false;
  for (let i = 0; i < text.length; i++) {
    if (!hasRieulFinal(text[i])) continue;
    const rest = text.slice(i + 1);
    if (rest.startsWith("게요")) plan = true;
    if (/^\s*(?:거예요|겁니다|것입니다|것으로|거라)/.test(rest)) forecast = true;
  }
  return { plan, forecast };
}

export function findTrendViolations(text: string): string[] {
  const out = TREND_BANNED.filter((b) => (b.except ? clausesOf(text).some((c) => b.re.test(c) && !b.except!.test(c)) : b.re.test(text))).map((b) => b.why);
  const { plan, forecast } = rieulEndings(text);
  if (plan && !out.includes("정해지지 않은 계획")) out.push("정해지지 않은 계획");
  if (forecast && !out.includes("전망")) out.push("전망");
  return out;
}

/** 추세 단일 프롬프트(본문 + {trend} 계약) — 미리보기·개별 테스트용. */
export function buildTrendPrompt(input: TrendInput, template?: string | null): string {
  return assembleSingle(trendBody(input, template), "trend");
}
