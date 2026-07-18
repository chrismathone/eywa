// AI 비서 답변 grounding 하네스 — 순수 함수(서버·DB 무관, Vitest). 약한 모델(Solar) 전제 방어:
// 생성된 답변에서 **조회된 팩트(툴 결과)에 근거하지 않은 수치·금액·비교**를 잡아낸다.
// briefing-team-report.validateTeamReport(숫자 whitelist)·form-fill.buildFormPatch(grounding)와 동일 정신.
//
// 잡는 3종(실측 Solar 날조 패턴):
//  ① 비교(전월/지난주/평균 대비 등) — 비서 툴은 이전 기간·평균을 주지 않으므로 이런 비교는 전부 날조.
//  ② 금액 — 툴 결과에 없는 금액을 지어냄(예: 퇴원 답변의 "미납액 1천만원"). 만원 반올림 허용, 합 허용.
//  ③ 퍼센트 — 툴 결과에 없는 비율을 계산해냄(예: "전환율 28.5%"). 조회된 비율(수납률 등)만 허용.
//
// 값 기반 비교(만·억 표기 정규화)라 "81만 7,500원"=817500처럼 재포맷돼도 정확히 대조된다.

export type GroundingIssueKind = "comparison" | "money" | "percent";
export type GroundingIssue = { kind: GroundingIssueKind; token: string };

// --- 한국어 수 파서 -------------------------------------------------------

/** 만 미만 소단위(천·백·십 + 숫자) → 정수. "1천"→1000, "1,286"→1286, "2백5십"→250, "3"→3. */
function parseKoreanSmall(raw: string): number {
  const s = raw.replace(/[,\s]/g, "");
  if (s === "") return 0;
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let rest = s;
  for (const [unit, mult] of [
    ["천", 1000],
    ["백", 100],
    ["십", 10],
  ] as const) {
    const idx = rest.indexOf(unit);
    if (idx >= 0) {
      const head = rest.slice(0, idx);
      total += (head === "" ? 1 : Number(head.replace(/\D/g, "") || "1")) * mult;
      rest = rest.slice(idx + 1);
    }
  }
  if (rest && /^\d+$/.test(rest)) total += Number(rest);
  return total;
}

/** 금액 문자열 하나를 정수 원(₩)으로. "81만 7,500원"→817500, "1,286만원"→12860000, "1천만원"→10000000. */
export function parseMoneyValue(match: string): number {
  const s = match.replace(/원/g, "").replace(/\s/g, "");
  let value = 0;
  let rest = s;
  const eok = rest.indexOf("억");
  if (eok >= 0) {
    value += parseKoreanSmall(rest.slice(0, eok)) * 100_000_000;
    rest = rest.slice(eok + 1);
  }
  const man = rest.indexOf("만");
  if (man >= 0) {
    value += parseKoreanSmall(rest.slice(0, man)) * 10_000;
    rest = rest.slice(man + 1);
  }
  const ones = rest.replace(/,/g, "");
  if (/^\d+$/.test(ones)) value += Number(ones);
  return value;
}

// 금액 표기: 억/만/천/백/십 혼합("1천만원")·만원 압축("81만 7,500원")·raw 정수원 모두. 원 또는 만/억 단위 필수.
// 첫 대안 = …원으로 끝, 둘째 대안 = …만/억으로 끝(원 생략, 예 "1,286만").
const MONEY_RE = /\d[\d,]*(?:\s*[억만천백십]\s*\d?[\d,]*)*\s*원|\d[\d,]*(?:\s*[천백십]\s*\d?[\d,]*)*\s*[억만]/g;

/** 텍스트의 모든 금액 값(원). 중복 제거. */
export function extractMoneyValues(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.match(MONEY_RE) ?? []) {
    const v = parseMoneyValue(m);
    if (v > 0) out.add(v);
  }
  return [...out];
}

const PERCENT_RE = /(\d+(?:\.\d+)?)\s*(?:%|퍼센트|퍼)/g;

/** 텍스트의 모든 퍼센트 값. */
export function extractPercentValues(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(PERCENT_RE)) out.add(Number(m[1]));
  return [...out];
}

// --- 비교(baseline) 날조 ---------------------------------------------------

// 이전 기간 참조 = 무조건 날조(툴이 제공 안 함). 평균/평소는 숫자·대비어와 붙을 때만(오탐 방지).
const PRIOR_PERIOD_RE = /(전월|전달|지난달|지난주|전주|지난분기|전분기|작년|전년|예년|지난해|저번\s*달|저번\s*주)/;
const BASELINE_NEAR_RE = /(평균|평소)[^.。\n]{0,6}(대비|보다|비해|은|는|이|가|\d)/;

/** 조회로 뒷받침되지 않는 비교 표현이 있는가(비서 툴은 이전기간·평균 데이터를 주지 않음). */
export function findComparisonIssues(answer: string): GroundingIssue[] {
  const issues: GroundingIssue[] = [];
  const p = answer.match(PRIOR_PERIOD_RE);
  if (p) issues.push({ kind: "comparison", token: p[1] });
  const b = answer.match(BASELINE_NEAR_RE);
  if (b) issues.push({ kind: "comparison", token: b[0] });
  return issues;
}

// --- grounding 세트 --------------------------------------------------------

export type Grounding = {
  money: number[]; // 조회된 금액 값들
  percent: number[]; // 조회된 퍼센트 값들
  hasMoney: boolean; // 조회 결과에 금액이 하나라도 있었나
};

/** 소스(툴 결과 문자열 + 질문 + 오늘)에서 grounding 세트를 만든다. */
export function buildGrounding(sources: string[]): Grounding {
  const joined = sources.join("\n");
  const money = extractMoneyValues(joined);
  // 툴 결과 JSON은 raw 정수("817500")로 금액을 담기도 하므로 원 단위 정수도 금액 후보로 흡수.
  for (const m of joined.match(/\d{4,}/g) ?? []) money.push(Number(m));
  const percent = extractPercentValues(joined);
  // 툴 결과의 비율 필드(paymentRate·weekRatePercent·전환율 등)는 % 기호 없이 숫자로 오므로 별도 흡수 —
  // 조회된 비율을 답변이 "N%"로 표기해도 근거로 인정(오탐 방지). 필드명에 rate/percent/ratio/율이 들어간 값만.
  for (const m of joined.matchAll(/(?:rate|percent|ratio|율)"?\s*[:=]\s*"?(\d+(?:\.\d+)?)/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) percent.push(n);
  }
  return { money: [...new Set(money)], percent: [...new Set(percent)], hasMoney: money.length > 0 };
}

/** 금액 v가 grounding에 근거하는가 — 만원 반올림 허용 + 두 값의 합 허용. */
function moneyGrounded(v: number, money: number[]): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(10_000, b * 0.005);
  if (money.some((g) => near(v, g))) return true;
  // 합(예: 상위 미수 2명 합)도 근거로 인정 — 지어낸 값이 우연히 합과 일치할 확률은 낮다.
  for (let i = 0; i < money.length; i++)
    for (let j = i; j < money.length; j++) if (near(v, money[i]! + money[j]!)) return true;
  return false;
}

/** 답변에서 근거 없는 이슈 목록. */
export function findGroundingIssues(answer: string, g: Grounding): GroundingIssue[] {
  const issues: GroundingIssue[] = [...findComparisonIssues(answer)];
  for (const v of extractMoneyValues(answer)) {
    // 툴 결과에 금액이 전혀 없으면(예: 퇴원 조회) 답변의 어떤 금액도 날조.
    if (!g.hasMoney || !moneyGrounded(v, g.money)) {
      issues.push({ kind: "money", token: `${v.toLocaleString()}원` });
    }
  }
  for (const v of extractPercentValues(answer)) {
    if (!g.percent.some((p) => Math.abs(p - v) <= 0.15)) {
      issues.push({ kind: "percent", token: `${v}%` });
    }
  }
  return issues;
}

// --- 복구: 근거 없는 문장 제거 ---------------------------------------------

/** 답변을 문장 단위로 나눠, 근거 없는 이슈가 든 문장을 제거(최후 수단). 남는 게 너무 짧으면 원문 유지. */
export function stripUngroundedSentences(answer: string, g: Grounding): string {
  const sentences = answer.split(/(?<=[.。!?])\s+|\n+/).filter((s) => s.trim());
  if (sentences.length <= 1) return answer; // 통짜 한 문장은 쪼개 봤자 = 원문(재생성이 담당)
  const kept = sentences.filter((s) => findGroundingIssues(s, g).length === 0);
  const joined = kept.join(" ").trim();
  return joined.length >= 10 ? joined : answer;
}
