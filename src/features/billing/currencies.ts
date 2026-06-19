// 지출 통화 레지스트리 — ⚠️ server-only 금지(클라 컴포넌트/문서가 import). 자주 쓰는 통화만 등록.
// 금액은 정수(numeric scale 0)라 소수점 없이 심볼 프리픽스로 표기(₩1,000 · $1,000 · ¥1,000).
export type CurrencyMeta = { code: string; symbol: string; label: string };

export const CURRENCIES: CurrencyMeta[] = [
  { code: "KRW", symbol: "₩", label: "원" },
  { code: "USD", symbol: "$", label: "달러" },
  { code: "JPY", symbol: "¥", label: "엔" },
  { code: "EUR", symbol: "€", label: "유로" },
  { code: "CNY", symbol: "CN¥", label: "위안" },
  { code: "GBP", symbol: "£", label: "파운드" },
];

export const DEFAULT_CURRENCY = "KRW";

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencyMeta(code: string): CurrencyMeta {
  return BY_CODE.get(code) ?? CURRENCIES[0];
}

export function isValidCurrency(code: string): boolean {
  return BY_CODE.has(code);
}

const NF = new Intl.NumberFormat("ko-KR");

/** 금액 + 통화코드 → 표시 문자열(심볼 프리픽스). 통화별 합계 분리의 단일 포매터. */
export function formatMoney(amount: number, code: string): string {
  return `${currencyMeta(code).symbol}${NF.format(amount)}`;
}
