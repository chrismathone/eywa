// 수강료 단가표 공유 상수·타입 — 서버(쿼리/액션)와 클라이언트(계산기·단가표 UI)가 함께 쓴다.
// ⚠️ "server-only" 금지: 클라이언트 컴포넌트도 import하므로(런타임 상수 DISCOUNT_CATEGORY 등).
// DB 쿼리는 tuition-catalog-queries.ts(server-only)에.

/** 분류(category) — ijw 충실 이식. "할인"은 계산기 할인 picker로, 나머지는 단가 picker로. */
export const TUITION_CATEGORIES = ["수학", "EIE", "영어", "국어", "기타", "할인"] as const;
export type TuitionCategory = (typeof TUITION_CATEGORIES)[number];
export const DISCOUNT_CATEGORY = "할인";

/**
 * 단가 종류(pricing_mode, 0102a) — price가 "회당/월/할인"으로 미구분이라 곱셈 사고 방지용 판별.
 * 계산기에서 `per_session`만 시수를 곱한다. null=미지정(곱셈 금지).
 * 회차 확정의 공통 드롭다운은 학원 설정 billing.sessionPrices를 쓴다(2026-09-16).
 */
export const PRICING_MODES = [
  { value: "per_session", label: "회당 단가" },
  { value: "monthly", label: "월 단가" },
  // 수업 단가가 아닌 부대비용(원장 2026-08-07: *"레벨 테스트 비용 및 셔틀버스비 스터디케어, 시스템
  // 사용료는 기타비용"*). 회당도 월도 아니라서 예전엔 **미지정으로 남을 수밖에 없었고**, 그 탓에
  // "아직 안 골랐다"는 경고를 영영 달고 있었다. 성격을 값으로 적어 그 경고를 끝낸다.
  { value: "extra", label: "기타비용" },
  { value: "discount", label: "할인액" },
] as const;
export type PricingMode = (typeof PRICING_MODES)[number]["value"];
const PRICING_LABELS: Record<PricingMode, string> = Object.fromEntries(
  PRICING_MODES.map((m) => [m.value, m.label]),
) as Record<PricingMode, string>;

/** pricing_mode → 한글 라벨. 미지정(null)은 "미지정". (raw enum UI 노출 금지 규칙) */
export function pricingModeLabel(mode: string | null | undefined): string {
  return mode && mode in PRICING_LABELS ? PRICING_LABELS[mode as PricingMode] : "미지정";
}

/**
 * "미지정만 보기" 필터 키 — DB의 `null`을 **URL 파라미터로 표현**하는 값이다(빈 문자열은 '전체'와
 * 구분이 안 돼 쓸 수 없다). 목록 쿼리는 이 값일 때 `is null`로 간다.
 * 🔴 `PricingMode`가 아니다 — 저장값으로 쓰지 말 것(저장은 null).
 */
export const PMODE_UNSET = "none";

/**
 * 단가 종류가 계산기에서 **무엇이 되는가** — 단가표와 계산기가 서로 다른 말을 쓰면(여긴 '월 단가',
 * 저긴 '월 고정') 같은 것을 두 이름으로 배우게 된다. 화면에 이 연결을 적어 둔다.
 */
export const PRICING_MODE_EFFECT: Record<PricingMode, string> = {
  per_session: "계산기에서 '회당' — 단가 × 시수",
  monthly: "계산기에서 '월 고정' — 금액을 그대로",
  extra: "수업이 아닌 부대비용 — 계산기 '교재 및 기타'로, 금액을 그대로",
  discount: "계산기 할인 항목",
};

/**
 * **수업 단가**인 종류만 — 계산기의 수강 과목이 될 수 있는 값(회당/월).
 * 기타비용·할인은 수업이 아니라서 여기 없다(수강 과목 picker도 그 분류를 아예 안 싣는다).
 */
export function isClassPricingMode(mode: string | null | undefined): boolean {
  return mode === "per_session" || mode === "monthly";
}

/** 폼 입력값을 안전한 PricingMode|null로 정규화(허용값 외 = null). */
export function normalizePricingMode(raw: string | null | undefined): PricingMode | null {
  const v = (raw ?? "").trim();
  return PRICING_MODES.some((m) => m.value === v) ? (v as PricingMode) : null;
}

export type TuitionCatalogRow = {
  id: string;
  category: string;
  name: string;
  price: number;
  pricingMode: PricingMode | null;
  note: string | null;
  isActive: boolean;
};

// 계산기 picker용 경량 옵션(활성 단가표).
// 🔴 `pricingMode`가 반드시 따라와야 한다 — 없으면 계산기가 price를 **무조건 회당 단가로 보고
//    시수를 곱한다**. 월 단가 20만원짜리를 9회 곱하면 180만원이 학부모 안내문에 찍힌다
//    (0102a가 "곱셈 금지"로 못박은 바로 그 사고. 적대 리뷰 2026-08-07).
export type TuitionCatalogOption = {
  id: string;
  category: string;
  name: string;
  price: number;
  pricingMode: PricingMode | null;
  note: string | null;
};
