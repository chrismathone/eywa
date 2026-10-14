/**
 * 계약서의 월급 — 원장 2026-10-13 *"직원관리에 계약서가 있으면 계약서에 적힌 금액을 가져와서 반영할것"* · *"급여는 세전"*.
 * 직원관리 계약 이력의 '계약 조건' 글(`staff_contracts.terms`)에서 **한 달 급여 하나**를 읽는다. 순수 함수.
 *
 * 읽는 모양(침산 실데이터 155줄, 2026-10-13 — 금액을 가리고 모양만 봤다):
 *   `999만/월` · `999만원/월` · `월급 999만` · `월급 2,200,000원` · `기본급 999만원` · `급여계약금 999만원/월` · `연봉 3,600만원`(÷12)
 * 읽지 않는 것(→ null, 원장이 '직접 입력'으로 넣는다): 시급 · 수당 금액이 따로 적힌 글(`직책수당 30만/월`을 월급으로 읽지 않게 —
 *   '제수당 포함'처럼 금액 없는 말은 괜찮다 · 침산 계약 87줄 중 0줄, 2026-10-13) · 업무별 단가(`행정 … 담임수업 …`) · 금액이 둘 이상인 글
 *   (`주 2회시 120만, 주3회시 180만`처럼 무엇이 맞는지 글만으로 정할 수 없다) · 비율제(프리랜서 — 출석부 실급여로 간다).
 * 🔴 금액은 화면·저장 행에 싣지 않는다(비율만 — *"금액을 포트폴리오에 그대로 노출할 필요없고 비율만"*). 외부 AI로도 보내지 않는다.
 */

export type ContractRow = { kind: string | null; start_date: string | null; end_date: string | null; terms: string | null; seq: number | null };

const AMOUNT = String.raw`(\d[\d,]*(?:\.\d+)?)\s*(만)?\s*원?`;
const MONTHLY = [
  new RegExp(String.raw`(?:월급|기본급|급여계약금)\s*:?\s*${AMOUNT}`, "g"),
  new RegExp(String.raw`${AMOUNT}\s*/\s*월`, "g"),
];
const ANNUAL = new RegExp(String.raw`연봉\s*:?\s*${AMOUNT}`, "g");
/** 수당에 붙은 금액 — 있으면 어느 금액이 월급인지 글만으로 못 정한다. */
const ALLOWANCE = new RegExp(String.raw`수당\s*:?\s*\d`);

const toWon = (num: string, man: string | undefined): number | null => {
  const n = Number(num.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const won = man ? n * 10_000 : n;
  // 한 달 급여로 말이 되는 범위만(오타·차수 번호를 금액으로 읽지 않게) — 10만 원 ~ 1억 원.
  return won >= 100_000 && won <= 100_000_000 ? Math.round(won) : null;
};

function amountsOf(text: string, patterns: readonly RegExp[]): number[] {
  const out = new Set<number>();
  for (const re of patterns) for (const m of text.matchAll(re)) {
    const won = toWon(m[1]!, m[2]);
    if (won !== null) out.add(won);
  }
  return [...out];
}

/** 계약 조건 글 하나 → 한 달 급여(원, 세전). 시급·여러 금액·못 읽으면 null. */
export function monthlyPayFromTerms(terms: string | null | undefined): number | null {
  const text = (terms ?? "").replace(/\s+/g, " ");
  if (!text || /시급/.test(text) || ALLOWANCE.test(text)) return null;
  const monthly = amountsOf(text, MONTHLY);
  if (monthly.length === 1) return monthly[0]!;
  if (monthly.length > 1) return null;
  const annual = amountsOf(text, [ANNUAL]);
  return annual.length === 1 ? Math.round(annual[0]! / 12) : null;
}

/**
 * 그 달에 걸친 계약(종류 '계약' · 시작 ≤ 말일 · 끝이 없거나 ≥ 1일) 중 **가장 늦은 차수 하나**의 월급.
 * 그 계약을 못 읽으면(시급·수당 금액·금액 둘) null — 앞 차수로 내려가지 않는다(끝 날이 비어 남은 옛 계약의 월급을 쓰지 않게,
 * 적대적 재리뷰 2026-10-13). 메모 줄('입사'·'퇴사' 같은 note)은 계약이 아니라 보지 않는다.
 */
export function contractMonthlyPay(rows: readonly ContractRow[], month: string): number | null {
  const start = `${month}-01`;
  const end = `${month}-31`;
  const live = rows
    .filter((r) => (r.kind ?? "contract") === "contract" && (!r.start_date || r.start_date <= end) && (!r.end_date || r.end_date >= start))
    .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
  return live.length ? monthlyPayFromTerms(live[0]!.terms) : null;
}
