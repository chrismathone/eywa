// 수강료 단가표 공유 상수·타입 — 서버(쿼리/액션)와 클라이언트(계산기·단가표 UI)가 함께 쓴다.
// ⚠️ "server-only" 금지: 클라이언트 컴포넌트도 import하므로(런타임 상수 DISCOUNT_CATEGORY 등).
// DB 쿼리는 tuition-catalog-queries.ts(server-only)에.

/** 분류(category) — ijw 충실 이식. "할인"은 계산기 할인 picker로, 나머지는 단가 picker로. */
export const TUITION_CATEGORIES = ["수학", "EIE", "영어", "국어", "기타", "할인"] as const;
export type TuitionCategory = (typeof TUITION_CATEGORIES)[number];
export const DISCOUNT_CATEGORY = "할인";

export type TuitionCatalogRow = {
  id: string;
  category: string;
  name: string;
  price: number;
  note: string | null;
  isActive: boolean;
};

// 계산기 picker용 경량 옵션(활성 단가표).
export type TuitionCatalogOption = {
  id: string;
  category: string;
  name: string;
  price: number;
  note: string | null;
};
