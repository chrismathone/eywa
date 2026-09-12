/**
 * 운영실 '이번 달 지출 내역'의 합계 한 줄 — 원장 2026-09-12 *"USD 지출 합계가 있는데 이건 그냥 빼. 그냥 대충 환율 1500원으로
 * 계산해서 지출합계에 합쳐"*. 🔴 정산·회계용 환율이 아니라 운영실 눈대중이다 — 수납·급여 계열 코드에서 이 표를 쓰지 말 것.
 * 환율이 없는 통화는 합치지 않고 종전처럼 따로 세운다(모르는 환율로 합치면 숫자가 거짓이 된다).
 */
export const ROUGH_KRW_RATES: Readonly<Record<string, number>> = { USD: 1500 };

export type CurrencyAmount = { currency: string; total: number };
export type FoldedExpenseTotal = {
  /** 원화 합계 — 원화 + 환율이 있는 외화의 환산액. */
  krwTotal: number;
  /** 환산해 합친 외화(라벨에 환율을 적는 근거). */
  converted: { currency: string; total: number; rate: number }[];
  /** 환율이 없어 합치지 못한 외화 — 따로 표시한다. */
  unconverted: CurrencyAmount[];
};

export function foldExpenseTotals(
  byCurrency: readonly CurrencyAmount[],
  rates: Readonly<Record<string, number>> = ROUGH_KRW_RATES,
): FoldedExpenseTotal {
  let krwTotal = 0;
  const converted: FoldedExpenseTotal["converted"] = [];
  const unconverted: CurrencyAmount[] = [];
  for (const c of byCurrency) {
    if (c.currency === "KRW") {
      krwTotal += c.total;
      continue;
    }
    const rate = rates[c.currency];
    if (rate === undefined) {
      unconverted.push({ currency: c.currency, total: c.total });
      continue;
    }
    krwTotal += c.total * rate;
    converted.push({ currency: c.currency, total: c.total, rate });
  }
  return { krwTotal, converted, unconverted };
}
