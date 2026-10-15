/**
 * 선생님 원스크린 — AI 학습 추세(종합분석) 프롬프트(순수 함수).
 * edutrix generateTrendAnalysis + historySummary 조립(reportActions.ts)의 이식.
 * 최근 N회 저장 보고서의 시험·과제 흐름을 한 문단으로 요약한다(멘트와 별개 출력).
 * 실 AI 호출은 server/actions.ts의 generateReportComment(멘트와 통합 1회 호출). 라이브 호출 없음(빌더만).
 * CLAUDE.md 원칙: 계산/프롬프트 조립은 순수 함수 + Vitest.
 */
import { DEFAULT_PROMPTS, interpolate, assembleSingle } from "./prompt-defaults";
import { isNoneValue } from "./none-marker";
import { parseExamPercent } from "./report-trend";

/** 추세 조립 입력 1행 — 저장된 보고서(같은 과목)의 날짜·시험·과제. */
export type TrendHistoryRow = {
  date: string; // YYYY-MM-DD
  examInfo: string | null; // "일일 15/20, 확인 18/20" | null
  homeworkScore: string | null; // 과제 수행률 "90%" | 옛 표기 "완료" | null
  classId?: string | null; // 그 보고서의 반(시험은 이 보고서 반의 기록만 쓴다 — keepExamOfClass)
  makeupClassId?: string | null; // 보강 행(반 없음)이면 보강 반(0171a) — 반 판정은 classId ?? makeupClassId
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
export function buildTrendInput(history: TrendHistoryRow[], opts: { today?: string | null } = {}): TrendInput | null {
  const line = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "");
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
  if (dates.size < MIN_TREND_RECORDS) return null;
  if (!examTrend && !assignTrend) return null;
  // 같은 만점끼리 모았으니 한 회차 안에 시험이 둘(일일 4/5 · 확인 8/10)인 경우만 남는다.
  const scales = new Set(examRows.flatMap((h) => examScales(line(h.examInfo))));
  const today = opts.today && /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today.slice(5) : null;
  return {
    count: dates.size,
    examTrend,
    assignTrend,
    today,
    lastExamOutlier: examOutlier(examRows.map((h) => parseExamPercent(line(h.examInfo)))),
    scaleMixed: scales.size > 1,
  };
}

/** edutrix historySummary 규격(날짜순 흐름). 프롬프트 [기록] 블록에 주입. */
function historySummary(input: TrendInput): string {
  const lines = [
    `분석 대상: 최근 ${input.count}회 기록`,
    `시험·테스트 점수 흐름(날짜순): ${input.examTrend || "자료 없음"}`,
    `과제 흐름(날짜순): ${input.assignTrend || "자료 없음"}`,
  ];
  if (input.today) lines.push(`오늘 수업: ${input.today} — 오늘 결과는 알림장 본문이 전합니다. 여기서 다시 풀어 쓰지 마세요.`);
  return lines.join("\n");
}

/**
 * 척도가 섞인 학생에게만 붙는 **코드 측 주의**. 프롬프트 본문(원장 편집 가능) 밖에 두어
 * 편집으로 사라지지 않게 한다(FACT_GUARD와 같은 이유).
 */
export const TREND_MIXED_SCALE_NOTE = [
  "[주의 — 이 학생의 기록 특성]",
  // 2026-10-15부터 만점이 다른 회차는 입력에서 빠진다 — 이 주의가 붙는 건 **한 회차에 시험이 둘**(일일·확인)인 경우뿐이다.
  "- 한 회차에 시험이 둘 있고 시험마다 **만점이 다릅니다**(예: 일일 4/5 · 확인 8/10).",
  "- 시험끼리 '올랐다·내려갔다·상승·하락·회복'으로 이으면 사실이 아닙니다. 시험별로 따로 말하세요.",
  "- 같은 시험끼리만 흐름을 보세요. 처음과 마지막만 짚으면 충분합니다(전부 나열하지 마세요).",
  // 🔴 2026-08-13 실측 사고: 모델이 '비교'는 안 했지만 **범위로 뭉갰다** — "9~15문제 중 9~15개 선을 유지".
  //    문항 수는 회차마다 하나뿐이라 **분모에 범위가 붙으면 언제나 거짓**이다. 이름을 대고 막는다.
  "- 🔴 **만점(문항 수)에 범위를 쓰지 마세요.** '9~15문제 중 9~15개', '10~20문제 중' 같은 표기는 **없는 시험**을 만드는 것입니다 —",
  "  문항 수는 회차마다 하나뿐입니다. 만점이 다르면 묶지 말고 **회차를 따로** 말하세요('10문제 중 9개를 맞힌 날도, 20문제 중 15개를 맞힌 날도 있었습니다').",
  "- 🔴 만점이 다르다는 **사정 자체는 문장에 쓰지 마세요** — '비교하기 어렵습니다' 같은 설명은 학부모에게 필요 없는 내부 사정입니다. 기록만 전하세요.",
].join("\n");

/**
 * 시험이 **마지막 한 번만** 크게 다른 학생에게 붙는 코드 측 주의(원장 2026-10-15 권민서A 클레임 — 9/18 4/5 · 9/29 5/5 뒤 10/13 1/5
 * 한 번을 "예전만큼 점수가 나오지는 않고 있습니다"로 일반화했다). 프롬프트 본문(원장 편집 가능) 밖이라 편집으로 사라지지 않는다.
 */
export const TREND_LAST_OUTLIER_NOTE = [
  "[주의 — 이 학생의 시험 기록]",
  "- 그동안은 결과가 비슷했고 **가장 최근 한 번만** 크게 다릅니다. 한 번은 흐름이 아닙니다 — '예전만 못하다', '요즘 올랐다'처럼 쓰지 마세요.",
  "- 그동안의 결과를 중심으로 쓰세요. 그 한 번을 쓰더라도 날짜와 숫자만 담담히 — 이유·평가·대책을 붙이지 마세요.",
].join("\n");

/**
 * 추세 프롬프트 — 기본 템플릿(DEFAULT_PROMPTS.trend)에 조립한 [기록]을 주입. edutrix DEFAULT_TREND_PROMPT 이식.
 * template 인자를 주면(원장 DB 오버라이드) 그것을 대신 사용 — 프로덕션은 활성값이 기본을 덮음.
 */
/** 추세 본문(출력 계약 없음) — 통합 호출 섹션용. template=원장 오버라이드. */
export function trendBody(input: TrendInput, template?: string | null): string {
  const body = interpolate(template || DEFAULT_PROMPTS.trend, { historySummary: historySummary(input) });
  const notes = [input.scaleMixed ? TREND_MIXED_SCALE_NOTE : "", input.lastExamOutlier ? TREND_LAST_OUTLIER_NOTE : ""].filter(Boolean);
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
const TREND_BANNED: readonly { re: RegExp; why: string }[] = [
  { re: /직접\s*비교|비교(?:하기|가)\s*(?:는|가)?\s*어렵|만점이\s*(?:서로\s*)?(?:다르|달라|일정하지)|기록이\s*(?:많지|적|부족)/, why: "기록 사정 설명" },
  { re: /집중|실수/, why: "원인 짐작" },
  { re: /겠|려고?\s*(?:합니다|해요)/, why: "정해지지 않은 계획" },
  { re: /떨어졌|떨어지고|하락|부진|나빠졌|나빠지고|저조/, why: "원색적인 표현" },
  // 2026-10-15 비교 생성에서 나옴: "과제는 아직 안정적이지 못한 상태입니다" — 기록은 숫자뿐이라 평가는 지어낸 것이다.
  { re: /안정적이지\s*(?:못|않)|미흡|부족|아쉽|아쉬운/, why: "평가" },
  { re: /기대/, why: "전망" },
];

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
  const out = TREND_BANNED.filter((b) => b.re.test(text)).map((b) => b.why);
  const { plan, forecast } = rieulEndings(text);
  if (plan && !out.includes("정해지지 않은 계획")) out.push("정해지지 않은 계획");
  if (forecast && !out.includes("전망")) out.push("전망");
  return out;
}

/** 추세 단일 프롬프트(본문 + {trend} 계약) — 미리보기·개별 테스트용. */
export function buildTrendPrompt(input: TrendInput, template?: string | null): string {
  return assembleSingle(trendBody(input, template), "trend");
}
