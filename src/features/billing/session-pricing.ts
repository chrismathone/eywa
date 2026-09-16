// 회차 드롭다운의 단일 소스는 학원 설정(billing.sessionPrices)이다.
// 기본값은 출석부 단가표(2026-09-16)의 중복 금액을 합친 13종.
import type { TuitionCatalogOption } from "./tuition-catalog";

export type SessionPrice = { price: number; label: string };

export const DEFAULT_SESSION_PRICES: SessionPrice[] = [
  { price: 21250, label: "초등 3T · 초등특강" },
  { price: 22500, label: "초등 2T · 의치대 초등" },
  { price: 24000, label: "중등 3T · 중등특강" },
  { price: 25000, label: "중등 2T · 의치대 중등 · 중등특강(2.5)" },
  { price: 27250, label: "고등 3T · 고1특강" },
  { price: 29167, label: "의치대 고등" },
  { price: 29250, label: "고등 2T · 킬러문제" },
  { price: 30000, label: "매쓰몽 · 중등함수특강" },
  { price: 31250, label: "선택과목 · 고2특강" },
  { price: 32500, label: "절대등급" },
  { price: 33333, label: "중등특강(3.33)" },
  { price: 36000, label: "중등특강2" },
  { price: 37500, label: "수능" },
];

export const DEFAULT_EIE_MONTHLY_PRICE = 270000;
export type SessionPricingMode = "per_session" | "monthly";
export type SessionQuantityBasis = "days" | "attendance_units";

export function validSessionQuantity(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 99 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;
}

export function sessionPricingAmount(mode: SessionPricingMode | undefined, sessions: number, price: number): number {
  return mode === "monthly" ? price : Math.round(sessions * price);
}

/** 이름 추정 없이 반에 저장된 영어 프로그램 구분을 따른다. */
export function isEieMonthlyClass(subject: string, englishTrack: string | null | undefined): boolean {
  return subject === "english" && englishTrack === "eie";
}

/** 저장한 빈 목록도 존중한다. 과목·수업명에 상관없이 금액당 후보는 하나다. */
export function sessionPriceOptions(prices: readonly SessionPrice[]): SessionPrice[] {
  const byPrice = new Map<number, SessionPrice>();
  for (const item of prices) {
    if (!Number.isSafeInteger(item.price) || item.price <= 0) continue;
    if (!byPrice.has(item.price)) byPrice.set(item.price, item);
  }
  return [...byPrice.values()].sort((a, b) => a.price - b.price);
}

/** EiE 수업은 설정의 월 금액 한 항목으로 선택한다. 교재·기타비용·할인은 그대로 둔다. */
export function withEieMonthlyTuition(catalog: TuitionCatalogOption[], monthlyPrice: number): TuitionCatalogOption[] {
  return [
    ...catalog.filter((row) => row.category.trim().toUpperCase() !== "EIE" || row.pricingMode === "extra" || row.pricingMode === "discount"),
    { id: "eie-monthly", category: "EIE", name: "EiE 월 수강료", price: monthlyPrice, pricingMode: "monthly", note: null },
  ];
}
