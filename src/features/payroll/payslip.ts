// 급여명세서(프리랜서 강의용역수수료 명세서) — 순수 계산. Vitest로 잠근다.
//
// 출처: 원장이 쓰던 구글시트 '프리랜서 강의용역수수료 명세서'(문서 1Uh7mbje…)의 수식을 그대로 옮긴 것이다.
// 시트가 진실이므로 **여기서 산식을 "개선"하지 말 것** — 숫자가 달라지면 명세서가 시트와 안 맞는다.
//
// 시트 수식 원문(셀 → 의미):
//   D9  소득세 3.3%  = (지급총액 − 기타공제) × 0.033     ← 기타공제가 **과세표준을 줄인다**(학원 규칙)
//   D10 공제총액     = 기타공제 + 소득세
//   G10 실수령액     = 지급총액 − 공제총액
//   B5  근무기간     = "yy.MM.01-{말일}"
//   B19 서명 날짜    = 다음 달 10일("yyyy.MM.10")
//
// ⚠️ 라운딩: 시트는 셀 값을 **반올림하지 않고**(104282.046) 통화 서식으로만 반올림해 보인다. 실제 이체는
//    정수라, 여기서는 **마지막에 한 번만** 반올림한다. 중간 반올림을 넣으면 시트와 1원씩 어긋난다.
//    (같은 이유로 tier-settlement.ts의 floor1도 건드리지 말 것 — 그쪽은 "행별 내림"이 시트 규칙이다.)

/** 원천징수율 — 사업소득 3.3% = 소득세 3% + 지방소득세 0.3%(소득세의 10%). */
export const INCOME_TAX_RATE = 0.03;
export const LOCAL_TAX_RATE = 0.003;
export const WITHHOLDING_RATE = INCOME_TAX_RATE + LOCAL_TAX_RATE;

export type PayslipAmounts = {
  /** 수업료 총액 — 티어 정산액(Σ floor1(단가×시수×0.911×비율)). */
  tuition: number;
  /** 인센티브(없으면 0). */
  incentive: number;
  /** 지급총액 = 수업료 총액 + 인센티브. */
  grossPay: number;
  /** 기타공제(없으면 0) — 시트 규칙상 **과세표준에서 먼저 뺀다**. */
  otherDeduction: number;
  /** 과세표준 = 지급총액 − 기타공제. */
  taxableBase: number;
  /** 원천징수 합계(3.3%) — 명세서 '소득세 3.3%' 칸. 이 값이 실수령액을 정한다. */
  withholding: number;
  /** 소득세(3%) — 신고용 분해. withholding과 **합이 어긋나지 않도록** 아래 localTax가 나머지를 받는다. */
  incomeTax: number;
  /** 지방소득세(0.3%) = withholding − incomeTax. */
  localTax: number;
  /** 공제총액 = 기타공제 + 원천징수. */
  deductionTotal: number;
  /** 실수령액 = 지급총액 − 공제총액. */
  netPay: number;
};

/**
 * 명세서 금액 블록.
 *
 * 🔑 `withholding`을 **먼저** 정하고 `localTax`를 나머지로 두는 이유: 3%와 0.3%를 각각 반올림하면
 *    합이 3.3% 반올림과 1원 어긋나는 구간이 생긴다. 명세서에 실제로 찍히는 건 3.3% 한 줄과 실수령액이라,
 *    그 둘을 진실로 잡고 신고용 분해를 거기에 맞춘다(합계 불일치 = 세무 신고에서 바로 문제가 된다).
 */
export function computePayslipAmounts(input: {
  tuition: number;
  incentive?: number | null;
  otherDeduction?: number | null;
}): PayslipAmounts {
  const tuition = Math.max(0, Math.round(input.tuition));
  const incentive = Math.max(0, Math.round(input.incentive ?? 0));
  const otherDeduction = Math.max(0, Math.round(input.otherDeduction ?? 0));

  const grossPay = tuition + incentive;
  const taxableBase = Math.max(0, grossPay - otherDeduction);

  const withholding = Math.round(taxableBase * WITHHOLDING_RATE);
  const incomeTax = Math.round(taxableBase * INCOME_TAX_RATE);
  const localTax = withholding - incomeTax;

  const deductionTotal = otherDeduction + withholding;
  return {
    tuition,
    incentive,
    grossPay,
    otherDeduction,
    taxableBase,
    withholding,
    incomeTax,
    localTax,
    deductionTotal,
    netPay: grossPay - deductionTotal,
  };
}

// ── 기간·날짜 라벨 (시트 수식 그대로) ─────────────────────────────────────────

/** 'YYYY-MM' → { year, month } . 형식이 아니면 null(호출부가 판단). */
function parsePeriod(period: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** 그 달의 말일(28~31). */
export function lastDayOfMonth(period: string): number | null {
  const p = parsePeriod(period);
  return p ? new Date(Date.UTC(p.year, p.month, 0)).getUTCDate() : null;
}

/** 근무기간 라벨 — 시트 B5: "26.07.01-31". */
export function workPeriodLabel(period: string): string | null {
  const p = parsePeriod(period);
  const last = lastDayOfMonth(period);
  if (!p || last === null) return null;
  const yy = String(p.year % 100).padStart(2, "0");
  const mm = String(p.month).padStart(2, "0");
  return `${yy}.${mm}.01-${last}`;
}

/**
 * 지급일 — **다음 달 10일**("2026.08.10").
 *
 * ⚠️ 원본 시트는 지급일 칸(G7)만 `TEXT(A2,"yyyy.mm.10")` = **당월** 10일로 계산해, 서명 날짜(B19,
 *    `MONTH(A2)+1` = 다음 달 10일)와 어긋나 있다(7월분인데 지급일 2026.07.10 / 서명일 2026.08.10).
 *    7월 근무분을 7월 10일에 지급할 수는 없으므로 **시트 쪽 오타로 보고 다음 달 10일로 통일**했다.
 *    (원장이 당월 표기를 의도한 것이라면 이 함수 한 곳만 되돌리면 된다.)
 */
export function payDateLabel(period: string): string | null {
  const p = parsePeriod(period);
  if (!p) return null;
  const d = new Date(Date.UTC(p.year, p.month, 10)); // month는 0-based라 +1달이 된다
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.10`;
}

/** 명세서 제목의 연월 — "2026년 07월". */
export function periodTitle(period: string): string | null {
  const p = parsePeriod(period);
  return p ? `${p.year}년 ${String(p.month).padStart(2, "0")}월` : null;
}

// ── 배분율 패널티 (블로그 미작성 −2%p) ────────────────────────────────────────

/**
 * 블로그(내신분석 글) 미작성 패널티 — 원장 규칙: **프리랜서 공통, 미작성 시 전 과정 −2.0%p**.
 * (2026-08 시트 역산: 김윤하 45→43·48→46, 이수진 45→43·47.5→45.5·50→48 = 균일 −2.0 **포인트**.)
 *
 * 🔴 비율(%)이 아니라 **포인트(%p)** 차감이다 — 45 × 0.98 = 44.1 이 아니라 45 − 2 = 43.
 * 🔴 `users.commission_rates`(계약 비율)는 **고치지 않는다.** 이건 그 달에만 얹는 조정이다.
 */
export const BLOG_PENALTY_POINTS = 2;

/** 패널티를 반영한 실제 적용 비율. 음수로 내려가지 않게 0에서 멈춘다. */
export function applyRatePenalty(baseRate: number, penaltyPoints: number): number {
  return Math.max(0, baseRate - Math.max(0, penaltyPoints));
}

/** 명세서 비율 줄에 찍을 설명 — "기본 45% · 블로그 미작성 −2%p · 적용 43%". */
export function rateBreakdownLabel(baseRate: number, penaltyPoints: number): string {
  if (penaltyPoints <= 0) return `${formatRate(baseRate)}%`;
  return `기본 ${formatRate(baseRate)}% · 블로그 미작성 −${formatRate(penaltyPoints)}%p · 적용 ${formatRate(
    applyRatePenalty(baseRate, penaltyPoints),
  )}%`;
}

/** 45 → "45", 47.5 → "47.5" (불필요한 .0 제거). */
export function formatRate(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * 폼 입력(체크박스 + 숫자 칸) → 실제 차감 포인트.
 *
 * 🔴 **체크박스가 1차 컨트롤이다.** 꺼져 있으면 숫자 칸에 뭐가 있든 0이다.
 *    첫 구현은 숫자 칸이 항상 이겨서, 저장값 "2"가 프리필된 뒤엔 체크를 풀어도 −2%p가 안 지워졌다
 *    → 비율 45%가 43%로 굳어 **매달 약 4.4% 과소지급**(적대 리뷰가 잡은 치명 버그). 순서를 바꾸지 말 것.
 *
 * 반환 `{ points }` 또는 `{ error }` — 숫자 칸이 범위를 벗어나면 저장을 거부한다(조용히 고치지 않는다).
 */
export function resolvePenaltyPoints(
  penaltyOn: boolean,
  raw: string,
): { points: number; error?: undefined } | { points?: undefined; error: string } {
  if (!penaltyOn) return { points: 0 };
  const s = raw.trim();
  if (s === "") return { points: BLOG_PENALTY_POINTS };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { error: "차감 포인트는 0~100 사이여야 합니다" };
  return { points: Math.round(n * 10) / 10 };
}
