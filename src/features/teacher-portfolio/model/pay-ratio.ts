/**
 * 매출 대비 급여 — 원장 2026-10-13: *"급여의 3배가 매출이면 만점"* · *"매출은 할인 전 청구액"* · *"급여는 세전"* ·
 * *"계약서가 있으면 계약서에 적힌 금액"* · *"금액을 포트폴리오에 그대로 노출할 필요없고 비율만"* · *"청구액 그대로"*. 순수 함수.
 *
 * - 수치(raw) = 급여 ÷ 매출 × 100(%) — 낮을수록 좋다(기본 구간 ≤33% 20점 …, 설정이 매긴다).
 * - 매출 = 그 강사 출석부 합계 행의 청구액(함께 맡은 반도 그 줄 금액 그대로).
 * - 급여 = 원장 직접 입력 → 계약서 월급 → 출석부 실급여(프리랜서) 순으로 처음 있는 것.
 * - 학생 수·반 수(원장 1-1 *"학생수와 생산성 모두 볼것"*)는 근거 화면에 같이 싣는다(점수엔 안 섞는다).
 * 🔴 금액(매출·급여)은 결과에 싣지 않는다 — 비율과 출처만.
 */
import { round1 } from "./dates";
import { METRIC_MAX, type PayRatioMetric } from "./types";

/**
 * 출석부에서 읽은 재료(서버 `loadSheetFacts`) — 금액은 이 단계에서만 쓰고 저장하지 않는다.
 * `rows`·`billedRows` = 청구액이 잡힐 출석부 줄 수 · 그중 청구액이 잡힌 줄 수(회차 확정이 덜 된 달은 일부 줄만 청구액이 있다).
 * `enrollments` = 학생 × 반 줄 수(보강 묶음 제외) — 한 학생이 그 선생님 반을 평균 몇 개 듣는지(생산성)에 쓴다.
 * `retry` = 출석부를 일시적으로 못 셌다(조회 실패·시간 초과) · `payReadFailed` = 실급여 비율표를 못 읽었다 —
 *   이런 칸은 0점으로 굳지 않게 그 달을 마감하지 않고 다음 집계가 다시 센다(`PayResult.retry`).
 */
export type PayFacts = {
  revenue: number | null; sheetPay: number | null; students: number; classes: number; enrollments: number;
  rows: number; billedRows: number; problem: string | null; retry?: boolean; payReadFailed?: boolean;
};
/**
 * 청구액이 잡힌 줄이 이보다 적으면 비율을 내지 않는다 — 달 중간에 회차 확정이 몇 줄만 된 상태에서 한 달 급여를 나누면
 * 수백 %가 나온다(실데이터 2026-10-13: 회차 확정 3줄인 10월에 한 선생님이 763%).
 */
export const MIN_BILLED_SHARE = 0.8;
export type PaySource = "직접 입력" | "계약서 월급" | "출석부 실급여";
export type PayResult = {
  raw: number | null; source: PaySource | null; students: number; classes: number; enrollments: number; problem: string | null;
  /** 일시 실패로 비율을 못 냈다 — 집계가 그 달 마감을 미룬다(값 자체는 저장하지 않는다). */
  retry: boolean;
};

export function payRatioOf(facts: PayFacts | undefined, contractPay: number | null, override: number | null): PayResult | undefined {
  if (!facts) return undefined;
  const [pay, source]: [number | null, PaySource | null] = override !== null ? [override, "직접 입력"]
    : contractPay !== null ? [contractPay, "계약서 월급"]
      : facts.sheetPay !== null ? [facts.sheetPay, "출석부 실급여"] : [null, null];
  // 청구액이 잡힐 담당 줄이 하나도 없으면(보강 묶음만 · 전원 청구서 없음) 비율을 내지 않는다 — 보강 묶음 청구액만으로 나누면
  // 회차 확정 정도를 볼 수 없어 달 중간에 수백 %가 나올 수 있다. 사유는 '확정 전'과 갈라 적는다.
  const share = facts.rows > 0 ? facts.billedRows / facts.rows : 0;
  // 출석부를 금액으로 쓸 수 없던 달(접힌 재료·조회 실패)은 다른 재료가 있어도 비율을 내지 않는다.
  const revenue = !facts.problem && facts.revenue !== null && facts.revenue > 0 && share >= MIN_BILLED_SHARE ? facts.revenue : null;
  const raw = revenue !== null && pay !== null && pay >= 0 ? round1((100 * pay) / revenue) : null;
  const problem = facts.problem
    ?? (facts.rows === 0 && facts.classes === 0 ? "이 달 담당 반이 없습니다"
      : facts.rows === 0 ? "청구서가 있는 담당 줄이 없습니다(보강만 맡았거나 담당 학생 청구서가 없음)"
      : facts.revenue === null || facts.revenue <= 0 ? "출석부 청구액이 없습니다(회차 확정 전)"
      : revenue === null ? `회차 확정이 아직 덜 됐습니다(청구액이 잡힌 줄 ${Math.round(share * 100)}%)`
        : pay === null
          ? (facts.payReadFailed ? "출석부 실급여 비율을 읽지 못했습니다(마감 전이면 다음 집계에서 다시 셉니다)" : "급여를 알 수 없습니다(직접 입력·계약서 월급·출석부 실급여 모두 없음)")
          : null);
  const retry = raw === null && (Boolean(facts.retry) || (revenue !== null && pay === null && Boolean(facts.payReadFailed)));
  return {
    raw, source: pay === null ? null : source, students: facts.students, classes: facts.classes, enrollments: facts.enrollments,
    problem: raw === null ? problem : null, retry,
  };
}

export function payRatioItem(r: PayResult | undefined): PayRatioMetric {
  const base = { id: "payRatio" as const, max: METRIC_MAX.payRatio, value: null, detail: [] as never[] };
  if (!r) {
    return {
      ...base, raw: null, uncounted: true, basis: "아직 계산 전",
      reason: "이번 집계에서 급여 비율을 계산하지 못한 달입니다(재료 조회 실패 등 · 마감 전이면 다음 집계에서 다시 셉니다). 급여 비율을 만들기 전에 마감한 달도 이렇게 남습니다. 이 달은 계산하지 않은 채로 매겼습니다.",
    };
  }
  return {
    ...base, raw: r.raw, source: r.source, students: r.students, classes: r.classes, enrollments: r.enrollments,
    basis: r.raw !== null ? `급여 비율 ${r.raw.toFixed(1)}% · ${r.source}` : (r.problem ?? "자료 없음"),
    reason: "그 달 급여(세전) ÷ 담당 매출(출석부 합계 행의 청구액, 할인 전)을 비율로만 보입니다. 급여는 원장 직접 입력 → 계약서 월급 → 출석부 실급여 순으로 처음 있는 것을 씁니다. 금액은 보이지 않습니다.",
  };
}
