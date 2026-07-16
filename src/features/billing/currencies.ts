// 지출 통화 레지스트리 — ⚠️ server-only 금지(클라 컴포넌트/문서가 import). 자주 쓰는 통화만 등록.
// 통화마다 소수 자릿수가 다르다(원·엔=0, 달러·유로=2) → 반올림·입력 step·표기의 단일 소스가 decimals.
// ⚠️ DB expenses.amount = numeric(12,2)라 소수는 **최대 2자리**. 3자리 통화를 추가하려면 마이그레이션 선행.
export type CurrencyMeta = { code: string; symbol: string; label: string; decimals: number };

export const CURRENCIES: CurrencyMeta[] = [
  { code: "KRW", symbol: "₩", label: "원", decimals: 0 },
  { code: "USD", symbol: "$", label: "달러", decimals: 2 },
  { code: "JPY", symbol: "¥", label: "엔", decimals: 0 },
  { code: "EUR", symbol: "€", label: "유로", decimals: 2 },
  { code: "CNY", symbol: "CN¥", label: "위안", decimals: 2 },
  { code: "GBP", symbol: "£", label: "파운드", decimals: 2 },
];

export const DEFAULT_CURRENCY = "KRW";

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencyMeta(code: string): CurrencyMeta {
  return BY_CODE.get(code) ?? CURRENCIES[0];
}

export function isValidCurrency(code: string): boolean {
  return BY_CODE.has(code);
}

/** 이 통화의 소수 자릿수(원·엔=0, 달러·유로=2). 미등록 코드는 기본 통화(원) 기준. */
export function currencyDecimals(code: string): number {
  return currencyMeta(code).decimals;
}

/**
 * 금액을 통화 정밀도로 반올림 — 라인 총액·합계의 단일 반올림 지점(순수함수).
 * ₩는 정수로, $는 센트로. 합계는 반드시 이걸 거쳐야 부동소수 누적오차($0.1+$0.2=0.30000000000000004)가 새지 않는다.
 */
export function roundMoney(amount: number, code: string): number {
  if (!Number.isFinite(amount)) return 0;
  const f = 10 ** currencyDecimals(code);
  // amount*f를 그대로 반올림하면 이진 표현 오차로 한 자리가 깎인다(1.005*100 = 100.49999…) → EPSILON 보정.
  return Math.round(amount * f + Math.sign(amount) * Number.EPSILON * f) / f;
}

/** 금액 input(type=number)의 step — 통화 소수 자릿수 기준(₩ "1" · $ "0.01"). step을 안 주면 암묵 1이라 소수가 거부된다. */
export function moneyStep(code: string): string {
  const d = currencyDecimals(code);
  return d === 0 ? "1" : `0.${"0".repeat(d - 1)}1`;
}

// 통화별 포매터 캐시 — Intl.NumberFormat 생성이 비싸 매 셀 렌더마다 만들지 않는다.
const NF_CACHE = new Map<string, Intl.NumberFormat>();
function numberFormat(code: string): Intl.NumberFormat {
  const key = currencyMeta(code).code;
  let f = NF_CACHE.get(key);
  if (!f) {
    const d = currencyDecimals(key);
    f = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
    NF_CACHE.set(key, f);
  }
  return f;
}

/** 금액 + 통화코드 → 표시 문자열(심볼 프리픽스, 통화 정밀도 고정 표기). 통화별 합계 분리의 단일 포매터. */
export function formatMoney(amount: number, code: string): string {
  return `${currencyMeta(code).symbol}${numberFormat(code).format(amount)}`;
}
