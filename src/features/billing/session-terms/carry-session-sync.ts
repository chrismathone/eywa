// 금액 이월 → **확정 시수 자동 반영** — 순수 규칙(Vitest). 원장 2026-10-07 (9월 한 줄: 예정 5 · 확정 5 · 단가 24,000 ·
// 확정액 120,000 · 실납 144,000 · 8월 이월 +24,000):
//   *"이월처리되면 스마트하게 확정 시수도 올라갔으면 좋겠는데, 이러면 또 해제하고 확정시수 올리고 다시 확정해야함."*
//
// 사람이 하던 일(확정 해제 → 확정 시수에 이월 회차만큼 더함 → 다시 확정)을 그대로 대신한다 — **저장된 확정 시수 자체를 고친다**.
// 🔑 왜 화면에서만 더해 보이지 않나: 확정 시수는 분배(실납 × 실제 시수 ÷ 확정 시수) · 시수 검증 · 출석부 등록 차수 · 급여가 **같은 저장값**을
//    읽는다. 표시만 6으로 올리면 화면마다 다른 숫자가 된다(분배는 5로 나눈다).
//
// 판정은 하나다 — **더 받은 몫(실납 − 확정액)이 정확히 '지금 실린 받은 이월 합계'일 때만 그만큼 올린다.**
// 그래서 여러 번 불러도 한 번만 고친다(고친 뒤엔 차이가 0) · 사람이 이미 이월을 넣어 확정한 줄(차이 0)은 건드리지 않는다 ·
// 이월과 무관하게 어긋나 있던 줄(차이가 이월과 다름)도 건드리지 않는다.
// 이월을 **방금 더 실은** 계기에는 하나를 더 본다 — 더 받은 몫이 정확히 '이번 저장으로 그 반에 늘어난 몫'(`added`)일 때도 올린다.
// 이미 한 번 올린 줄(확정 6 · 이월 24,000)에 이월이 더 실리면(합계 48,000) 차이는 24,000이라 합계와는 안 맞는다 — 그걸 놓치면
// 사람이 다시 '해제 → 7로 고침 → 확정'을 해야 한다(적대 재리뷰 2026-10-07).
// 🔴 **올리기만 한다 — 자동으로 내리지 않는다.** 이월을 취소·줄였을 때 "맞던 줄을 계속 맞게" 내리면, 청구가 4회분인데 이월로 부족을 메워
//    사람이 5로 확정해 둔 줄까지 4로 깎는다(이월로 올린 적 없는 사람의 값 — 적대 리뷰 2026-10-07). 자동으로 올린 줄인지 가릴 표식이
//    없으므로 내리는 쪽은 **알리기만** 한다(`carryShortfall` — 실납이 확정액보다 적어진 줄).
// 🔴 하지 않는 것: 월 정액(EiE) · 옛 일수 기준 확정 · **0.5시수 단위로 안 떨어지는 이월**(만 원 같은 잔돈 — 단가 25,000에 10,000을
//    0.4시수로 바꾸면 분배가 그만큼 줄어 넘긴 돈이 분배에서 빠진다) · 배분이 없거나 재확인이 필요한 줄(이월이 아직 안 실렸다) ·
//    고치면 이 줄이 **보낸** 이월이 무효가 되는 줄 · **다음 달로 보낸 이월이 있는 줄**(아래) · 0~99 밖이 되는 시수.
// 🔴 다음 달로 보낸 이월이 있는 줄은 올리지 않는다(연쇄 이월, 2026-11-09) — 받은 이월에서 남은 몫을 다시 넘길 수 있게 된 뒤로는
//    "확정액 = 배분 − 보낸 이월"로 맞춰 둔 줄(사람이 실제 시수로 확정하고 남은 몫을 넘긴 줄)을 받은 이월만큼 또 올리면 확정이 실제보다
//    많아진다(적대 리뷰 2026-11-09). 그 전에는 올리면 보낸 이월이 무효가 되어 아래 재확인에서 저절로 걸렸던 줄이다 — 같은 동작을 명시로 지킨다.
import { sessionPricingAmount, validSessionQuantity, type SessionPricingMode } from "@/features/billing/session-pricing";
import { carryOutValid, carrySurplus, netAllocatedAmount, receivedCarry, type CarrySource, type MoneyCarryIn, type MoneyCarryOut } from "./money-carryover";

export type CarrySyncRow = CarrySource & {
  /** 회차 행만 대상이다(가상 행은 확정이 없다). 모르면 대상으로 본다. */
  termState?: string;
  pricingMode: SessionPricingMode;
  unitPrice: number | null;
  quantityBasis?: "days" | "attendance_units";
  carryOut?: MoneyCarryOut | null;
  carryIns?: readonly MoneyCarryIn[];
};

export type CarrySyncSkip = "not-term" | "unconfirmed" | "monthly" | "days-basis" | "no-price" | "no-allocation" | "balanced" | "unexplained" | "not-half" | "out-of-range" | "sending";
export type CarrySyncPlan =
  | { kind: "none"; reason: CarrySyncSkip }
  | { kind: "adjust"; sessions: number; amount: number; bySessions: number; byAmount: number };

/** 이 줄에 **지금 실제로 실리는** 받은 이월 합계 — 받을 수 없는 줄(배분 없음·재확인·환불)이면 0. `netAllocatedAmount`와 같은 판정. */
export function landedCarryIn(row: CarrySyncRow): number {
  return receivedCarry(row);
}

/** 자동으로 바꾸는 시수의 단위 — 출석부 시수는 0.5 단위로 찍는다(1.5T 등). 더 잘게 쪼개지는 금액은 회차가 아니라 잔돈이다. */
const STEP = 0.5;

/**
 * 확정 시수를 **올릴지** 판정한다 — 더 받은 몫이 정확히 지금 실린 받은 이월 합계일 때만.
 * `added` = 방금 한 이월 저장으로 **이 줄의 반에 늘어난 몫**(원, 양수일 때만 뜻이 있다) — 더 받은 몫이 그 값과 같아도 올린다.
 */
export function planCarrySessionSync(row: CarrySyncRow, added = 0): CarrySyncPlan {
  if (row.termState !== undefined && row.termState !== "term") return { kind: "none", reason: "not-term" };
  if (row.confirmedSessions == null || row.amount == null) return { kind: "none", reason: "unconfirmed" };
  if (row.pricingMode === "monthly") return { kind: "none", reason: "monthly" };
  if (row.quantityBasis === "days") return { kind: "none", reason: "days-basis" };
  const price = row.unitPrice;
  if (price == null || !Number.isSafeInteger(price) || price <= 0) return { kind: "none", reason: "no-price" };
  // 배분이 없거나 재확인이 필요하면 실납을 모른다 — 이월도 아직 안 실렸다(그 달 배분을 저장하면 그때 다시 본다).
  if (row.allocatedAmount == null || row.allocationStale) return { kind: "none", reason: "no-allocation" };
  const net = netAllocatedAmount(row);
  if (net == null) return { kind: "none", reason: "no-allocation" };
  const gap = net - row.amount;
  if (gap === 0) return { kind: "none", reason: "balanced" };
  // 다음 달로 보낸 이월이 있는 줄 — 사람이 남은 몫을 넘기려고 맞춘 확정이다(위 🔴). 받은 이월만큼 올리지 않는다.
  // '이월 재확인'(무효) 상태의 보낸 이월은 실납에서 빠져 있으니 종전처럼 판정한다(사람이 고칠 이월 — 적대 재리뷰 2026-11-09).
  if (row.carryOut && carryOutValid(row, row.carryOut.amount)) return { kind: "none", reason: "sending" };
  // 덜 받은 줄(차이 < 0)은 건드리지 않는다 — 내리는 쪽은 사람이 한다(위 🔴). 더 받은 몫이 이월과 다르면 이월 탓이 아니다.
  const landed = landedCarryIn(row);
  // `added`는 실제로 이 줄에 실린 이월의 일부여야 한다(실린 합계보다 크면 이 줄에 실린 돈이 아니다).
  const byAdded = added > 0 && added <= landed && gap === added;
  if (gap < 0 || (gap !== landed && !byAdded)) return { kind: "none", reason: "unexplained" };
  const by = gap / price;
  if (Math.abs(by / STEP - Math.round(by / STEP)) > 1e-8) return { kind: "none", reason: "not-half" };
  const sessions = Math.round((row.confirmedSessions + by) * 10) / 10;
  if (!validSessionQuantity(sessions)) return { kind: "none", reason: "out-of-range" };
  const amount = sessionPricingAmount(row.pricingMode, sessions, price);
  // 🔴 고친 **뒤의** 실납과 맞아야 한다 — 확정액이 시수 × 단가가 아닌 줄(옛 데이터)이거나, 확정액이 커지면서 이 줄이 **보낸** 이월이
  //    무효가 되는 줄(더 받은 몫이 줄어든다)은 고쳐도 안 맞는다. 맞출 수 없으면 손대지 않는다(다음 달로 보낸 돈을 조용히 되돌리지 않는다).
  if (netAllocatedAmount({ ...row, confirmedSessions: sessions, amount }) !== amount) return { kind: "none", reason: "unexplained" };
  return { kind: "adjust", sessions, amount, bySessions: Math.round(by * 10) / 10, byAmount: gap };
}

/**
 * 🔑 **받은 이월을 다음 달로 다시 넘기기 = 이월 창에서 명시적으로**(원장 2026-11-09 *"남은 한계는 근본 해결해"*).
 * 받은 이월이 확정 시수에 이미 반영된 줄(자동으로 올렸거나 사람이 올린 줄)은 더 받은 몫이 0이라 넘길 수 없었고, 이월 전 시수로 다시
 * 확정하면 자동 맞춤이 매번 다시 올렸다(맞춤은 "이미 반영한 이월인지 · 사람이 일부러 낮췄는지"를 가릴 수 없다 — 반 일괄 확정은 이미 확정된
 * 줄도 덮어써서 '낮춘 확정'이 사람의 뜻이라는 보장도 없다). 그래서 의도를 추측하지 않고 **넘기는 행동이 시수를 함께 낮춘다**:
 * 이월 창의 금액이 더 받은 몫을 넘으면 그만큼 확정 시수를 낮추고(0.5시수 단위) 넘긴다. 넘긴 줄은 보낸 이월이 있어 자동 맞춤이 다시
 * 올리지 않는다(`sending`). 낮출 수 있는 몫 = 확정액 가운데 받은 이월로 채운 부분(확정액 − 배분액, 받은 이월 이하) — 그보다 낮추는 것은
 * 이 달 수업료로 낸 시수라 이월이 아니다(그건 사람이 확정 시수를 고친 뒤 더 받은 몫으로 넘긴다).
 * ⚠️ 낮추는 저장은 자동 맞춤과 같은 길(배분이 자동으로 다시 확정될 청구서만 · 읽은 값 그대로일 때만 · 재확정 실패면 되돌림).
 */
/** 0.5시수 단위로 낮출 수 있는지 보는 공통 조건 — 맞으면 단가를, 아니면 null. */
function unreflectPrice(row: CarrySyncRow): number | null {
  if (row.termState !== undefined && row.termState !== "term") return null;
  if (row.confirmedSessions == null || row.amount == null) return null;
  if (row.pricingMode === "monthly" || row.quantityBasis === "days") return null;
  const price = row.unitPrice;
  if (price == null || !Number.isSafeInteger(price) || price <= 0) return null;
  if (row.allocatedAmount == null || row.allocationStale) return null;
  // 확정액이 시수 × 단가인 줄만(옛 손 맞춤 줄은 낮춘 뒤 금액을 맞출 수 없다).
  if (sessionPricingAmount(row.pricingMode, row.confirmedSessions, price) !== row.amount) return null;
  return price;
}

/** 이월 창에서 **확정 시수를 낮춰** 더 넘길 수 있는 최대 금액(원, 0.5시수 단위로 내림) — 대상이 아니면 0. */
export function carryUnreflectable(row: CarrySyncRow): number {
  const price = unreflectPrice(row);
  if (price == null) return 0;
  const received = landedCarryIn(row);
  // 덜 받는 줄(배분 + 받은 이월 < 확정액)은 낮춰도 모자란 몫이 남아 넘긴 이월이 유효해지지 않는다 — 낮출 몫 없음(적대 리뷰 2026-11-09).
  if ((row.allocatedAmount as number) + received < (row.amount as number)) return 0;
  const funded = Math.min(received, Math.max(0, (row.amount as number) - (row.allocatedAmount as number)));
  const step = price * STEP;
  return Math.max(0, Math.floor(funded / step + 1e-9) * step);
}

export type CarryUnreflectPlan =
  | { kind: "none" }
  | { kind: "lower"; sessions: number; amount: number; bySessions: number; byAmount: number }
  | { kind: "invalid"; error: string };

/**
 * 넘길 금액 `amount`가 더 받은 몫을 넘으면 확정 시수를 몇으로 낮출지 — 더 받은 몫 안이면 `none`(종전 그대로).
 * 넘는 몫은 0.5시수 단위여야 하고 `carryUnreflectable` 이하여야 한다. 낮춘 뒤 이 이월이 유효한지까지 본다.
 */
export function planCarryUnreflect(row: CarrySyncRow, amount: number): CarryUnreflectPlan {
  const surplus = carrySurplus(row);
  if (!(amount > surplus)) return { kind: "none" };
  const price = unreflectPrice(row);
  const limit = carryUnreflectable(row);
  if (price == null || limit <= 0) return { kind: "invalid", error: `넘길 수 있는 금액은 최대 ${surplus.toLocaleString("ko-KR")}원입니다(확정액보다 더 받은 몫)` };
  const by = amount - surplus;
  if (by > limit) {
    return { kind: "invalid", error: `넘길 수 있는 금액은 최대 ${(surplus + limit).toLocaleString("ko-KR")}원입니다(더 받은 몫 ${surplus.toLocaleString("ko-KR")}원 + 확정 시수에 반영된 받은 이월 ${limit.toLocaleString("ko-KR")}원)` };
  }
  const bySessions = by / price;
  if (Math.abs(bySessions / STEP - Math.round(bySessions / STEP)) > 1e-8) {
    return { kind: "invalid", error: `더 받은 몫 ${surplus.toLocaleString("ko-KR")}원을 넘는 금액은 확정 시수를 0.5시수(${(price * STEP).toLocaleString("ko-KR")}원) 단위로 낮춰 넘깁니다 — 금액을 그 단위로 맞춰 주세요` };
  }
  const sessions = Math.round(((row.confirmedSessions as number) - bySessions) * 10) / 10;
  if (!validSessionQuantity(sessions)) return { kind: "invalid", error: "확정 시수를 그만큼 낮출 수 없습니다" };
  const next = sessionPricingAmount(row.pricingMode, sessions, price);
  if (next !== (row.amount as number) - by || !carryOutValid({ ...row, confirmedSessions: sessions, amount: next }, amount)) {
    return { kind: "invalid", error: "확정 시수를 낮춰도 넘길 금액이 맞지 않습니다 — 회차 확정에서 시수를 확인해 주세요" };
  }
  return { kind: "lower", sessions, amount: next, bySessions: Math.round(bySessions * 10) / 10, byAmount: by };
}

/**
 * 이 줄의 실납이 확정액보다 **얼마나 적은가**(원) — 이월을 취소·줄인 뒤 사람에게 알릴 값. 적지 않거나 판단할 수 없으면 0.
 * 자동으로 내리지 않는 대신 "확정 시수를 확인해 주세요"라고 말하는 재료다.
 */
export function carryShortfall(row: CarrySyncRow): number {
  if (row.termState !== undefined && row.termState !== "term") return 0;
  if (row.confirmedSessions == null || row.amount == null) return 0;
  if (row.allocatedAmount == null || row.allocationStale) return 0;
  const net = netAllocatedAmount(row);
  return net == null ? 0 : Math.max(0, row.amount - net);
}
