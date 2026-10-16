/**
 * 매출 대비 급여 — 원장 2026-10-13: *"급여의 3배가 매출이면 만점"* · *"매출은 할인 전 청구액"* · *"급여는 세전"* ·
 * *"계약서가 있으면 계약서에 적힌 금액"* · *"금액을 포트폴리오에 그대로 노출할 필요없고 비율만"* · *"청구액 그대로"*. 순수 함수.
 *
 * - 수치(raw) = 급여 ÷ 매출 × 100(%) — 낮을수록 좋다(기본 구간 ≤33% 20점 …, 설정이 매긴다).
 * - 매출 = 그 강사 출석부 줄(학생 × 담당 반)마다 그 달 청구서의 그 반 항목 금액(할인 전)의 합 — 회차 확정을 기다리지 않는다(원장
 *   2026-10-14 *"회차 확정으로 하지말고 청구액으로 잡을것"* — 이름이 안 맞는 영어 항목은 짝이 하나뿐일 때 바로, `pay-revenue.ts`).
 *   함께 맡은 반도 그 줄 금액 그대로.
 * - 급여 = 원장 직접 입력 → 계약서 월급 → 출석부 실급여(프리랜서) 순으로 처음 있는 것.
 *   🔴 혼합 계약(근로 + 용역, 원장 2026-10-16 *"월급 + 고등 실급여 합산"*)은 직접 입력이 없으면 **계약서 월급 + 출석부 실급여**(용역 학년)
 *   — 둘 중 하나라도 모르면 비율을 내지 않는다(한쪽만으로 나누면 급여가 덜 잡혀 비율이 좋게 나온다).
 * - 학생 수·반 수(원장 1-1 *"학생수와 생산성 모두 볼것"*)는 근거 화면에 같이 싣는다(점수엔 안 섞는다).
 * - 🔴 **지난달 값으로 매긴다**(원장 2026-10-15 *"매출대비 급여는 지난달 것을 다음달에 반영 … 이번달을 반영하려면 월말이 되야하는데
 *   기다리지 못할듯"*) — 10월 점수 = 9월 급여 ÷ 9월 매출(`payDataMonth`). 그 전에 마감한 달(4~9월)은 그 달 값 그대로다.
 * - 🔴 지난달에 담당 반이 없던 선생님(새로 온 선생님)은 비율이 없어도 0점이 아니라 **합계에서 제외**(`newcomer` — 원장 2026-10-15,
 *   설정의 '자료가 없을 때' 규칙보다 먼저). 지난달 값으로 매기는 달만 — 그 달 담당이 없으면 애초에 평가 대상이 아니다.
 * - 반별 비중(원장 2026-10-15 *"급여 탭에서 상세 반별 매출 이런거 보면 좋겠는데"* → 비중만) = 반마다 학생 수 · 매출 중 그 반 몫(%) — 금액은 싣지 않는다.
 * 🔴 금액(매출·급여)은 결과에 싣지 않는다 — 비율과 출처만.
 */
import { shiftMonth } from "@/lib/date-kst";
import { round1 } from "./dates";
import type { PayClassRow } from "./source-types";
import { METRIC_MAX, type PayRatioMetric } from "./types";

/**
 * 출석부에서 읽은 재료(서버 `loadSheetFacts`) — 금액은 이 단계에서만 쓰고 저장하지 않는다.
 * `rows`·`billedRows` = 청구서가 있는 학생의 줄 수 · 그중 청구서 항목을 그 반에 맞춘 줄 수(항목 이름이 반과 안 맞으면 매출이 비어 보인다).
 * `enrollments` = 학생 × 반 줄 수(보강 묶음 제외) — 한 학생이 그 선생님 반을 평균 몇 개 듣는지(생산성)에 쓴다.
 * `payPending` = 프리랜서 실급여의 단가가 아직 다 안 잡혔다(회차 확정 전 — 0원으로 만점이 되지 않게 급여를 모르는 것으로).
 * `retry` = 출석부를 일시적으로 못 셌다(조회 실패·시간 초과) · `payReadFailed` = 실급여 비율표를 못 읽었다 —
 *   이런 칸과 프리랜서 실급여 단가를 기다리는 칸(`payPending` — 실제 받는 돈이 회차 확정 단가로 정해진다)은 0점으로 굳지 않게
 *   그 달을 마감하지 않고 다음 집계가 다시 센다(`PayResult.retry` — 미루는 것은 다음 달 말까지, refresh.ts `holdFrom`).
 *   매출(못 맞춘 줄)은 기다리지 않는다 — 회차 확정에 기대지 않기로 했다(원장 2026-10-14).
 */
export type PayFacts = {
  revenue: number | null; sheetPay: number | null; students: number; classes: number; enrollments: number;
  rows: number; billedRows: number; problem: string | null; retry?: boolean; payReadFailed?: boolean; payPending?: boolean;
  /** 실급여를 낼 수 없는 까닭(혼합 계약의 용역 학년 미선택 등) — 급여를 모를 때의 사유로 쓴다. */
  payProblem?: string;
  /** 이 지점은 출석부 실급여를 쓰지 않는다(급여 모듈·회차 정산 꺼짐) — 혼합 계약의 용역 몫을 셀 수 없다. */
  sheetOff?: boolean;
  /** 반별 학생 수 · 매출 비중(%) — 금액이 아니라 비중으로만 넘긴다(`loadSheetFacts`가 낸다). */
  byClass?: PayClassRow[];
};
/**
 * 청구서 항목을 반에 맞춘 줄이 이보다 적으면 비율을 내지 않는다(매출이 덜 잡힌 채 한 달 급여를 나누면 비율이 부푼다).
 * 프리랜서 실급여도 단가가 잡힌 줄이 이보다 적으면 쓰지 않는다(pay-sources.ts).
 */
export const MIN_BILLED_SHARE = 0.8;
/** 이 달부터 급여 비율은 지난달 재료로 매긴다(원장 2026-10-15) — 그 전 달은 그 달 재료(이미 마감해 다시 세지 않는다). */
export const PAY_PREV_MONTH_FROM = "2026-10";
/** 이 달 점수의 급여 비율을 낼 재료의 달(급여·매출·계약서 월급 모두 이 달 것). */
export const payDataMonth = (month: string): string => (month >= PAY_PREV_MONTH_FROM ? shiftMonth(month, -1) : month);
export type PaySource = "직접 입력" | "계약서 월급" | "출석부 실급여" | "계약서 월급 + 출석부 실급여";
export type PayResult = {
  raw: number | null; source: PaySource | null; students: number; classes: number; enrollments: number; problem: string | null;
  /** 일시 실패·프리랜서 단가 대기로 비율을 못 냈다 — 집계가 그 달 마감을 미룬다(값 자체는 저장하지 않는다). */
  retry: boolean;
  /** 재료의 달 — 점수 달과 다르면(지난달 값) 근거 문구가 그 달을 밝힌다. */
  dataMonth?: string;
  /** 지난달 담당 반이 없다(새로 온 선생님) — 비율이 없으면 합계에서 제외한다. */
  newcomer?: boolean;
  byClass?: PayClassRow[];
};

/** `mixed` = 계약구분 '혼합'(근로 + 용역) — 직접 입력이 없으면 계약서 월급 + 출석부 실급여. */
export function payRatioOf(
  facts: PayFacts | undefined, contractPay: number | null, override: number | null, dataMonth?: string, mixed = false,
): PayResult | undefined {
  if (!facts) return undefined;
  const [pay, source]: [number | null, PaySource | null] = override !== null ? [override, "직접 입력"]
    : mixed ? (contractPay !== null && facts.sheetPay !== null ? [contractPay + facts.sheetPay, "계약서 월급 + 출석부 실급여"] : [null, null])
      : contractPay !== null ? [contractPay, "계약서 월급"]
        : facts.sheetPay !== null ? [facts.sheetPay, "출석부 실급여"] : [null, null];
  // 청구서가 있는 담당 줄이 하나도 없으면(보강 묶음만 · 전원 청구서 없음) 비율을 내지 않는다. 사유는 '못 맞춤'과 갈라 적는다.
  const share = facts.rows > 0 ? facts.billedRows / facts.rows : 0;
  // 지난달 값으로 매기는 달에 지난달 담당 반이 하나도 없으면 새로 온 선생님 — 0점이 아니라 합계에서 제외(원장 2026-10-15).
  const newcomer = Boolean(dataMonth) && !facts.problem && facts.classes === 0;
  // 출석부를 금액으로 쓸 수 없던 달(접힌 재료·조회 실패)은 다른 재료가 있어도 비율을 내지 않는다.
  const revenue = !facts.problem && facts.revenue !== null && facts.revenue > 0 && share >= MIN_BILLED_SHARE ? facts.revenue : null;
  const raw = revenue !== null && pay !== null && pay >= 0 ? round1((100 * pay) / revenue) : null;
  const problem = facts.problem
    ?? (newcomer ? "그 달 담당 반이 없습니다(새로 맡은 선생님 — 합계에서 제외)"
      : facts.rows === 0 && facts.classes === 0 ? "그 달 담당 반이 없습니다"
      : facts.rows === 0 ? "그 달 담당 학생의 청구서가 없습니다"
      : facts.revenue === null ? "청구서에서 담당 반 금액을 찾지 못했습니다"
      : facts.revenue <= 0 ? "담당 반 청구액이 0원입니다"
      : revenue === null ? `청구서에서 담당 반 금액을 찾지 못한 줄이 많습니다(찾은 줄 ${Math.round(share * 100)}%)`
        : pay === null
          ? (mixed && contractPay === null ? "혼합 계약 — 계약서 월급을 찾지 못했습니다(계약서에 월급을 적거나 급여를 직접 입력할 수 있습니다)"
            : facts.payReadFailed ? "출석부 실급여 비율을 읽지 못했습니다(마감 전이면 다음 집계에서 다시 셉니다)"
            : facts.payPending ? "출석부 실급여(급여명세서 수업료와 같은 계산)가 아직 다 잡히지 않았습니다 — 급여를 직접 입력할 수 있습니다"
              : mixed && facts.sheetOff ? "이 지점은 출석부 실급여를 쓰지 않아(급여·회차 정산 꺼짐) 혼합 계약의 용역 몫을 셀 수 없습니다 — 급여를 직접 입력해 주세요"
              : facts.payProblem ?? (mixed ? "혼합 계약 — 그 달 출석부 실급여(용역 학년)를 산정하지 못했습니다(용역 수업이 없던 달이거나 출결·단가가 비어 있으면 급여를 직접 입력해 주세요)"
                : "급여를 알 수 없습니다(직접 입력·계약서 월급·출석부 실급여 모두 없음)"))
          : null);
  // 매출은 있는데 급여만 기다리는 칸(실급여 비율표 일시 실패 · 프리랜서 단가 미확정)은 1일 새벽에 0점으로 굳지 않게 미룬다.
  // 혼합인데 계약서 월급이 없으면 기다려도 안 풀린다(실급여가 잡혀도 비율을 못 낸다) — 미루지 않는다.
  const waiting = !facts.problem && revenue !== null && pay === null && Boolean(facts.payReadFailed || facts.payPending) && !(mixed && contractPay === null);
  const retry = raw === null && (Boolean(facts.retry) || waiting);
  return {
    raw, source: pay === null ? null : source, students: facts.students, classes: facts.classes, enrollments: facts.enrollments,
    problem: raw === null ? problem : null, retry, ...(dataMonth ? { dataMonth } : {}),
    ...(raw === null && newcomer ? { newcomer: true } : {}), ...(facts.byClass?.length ? { byClass: facts.byClass } : {}),
  };
}

export function payRatioItem(r: PayResult | undefined): PayRatioMetric {
  const base = { id: "payRatio" as const, max: METRIC_MAX.payRatio, value: null, detail: [] as PayClassRow[] };
  if (!r) {
    return {
      ...base, raw: null, uncounted: true, basis: "아직 계산 전",
      reason: "이번 집계에서 급여 비율을 계산하지 못한 달입니다(재료 조회 실패 등 · 마감 전이면 다음 집계에서 다시 셉니다). 급여 비율을 만들기 전에 마감한 달도 이렇게 남습니다. 이 달은 계산하지 않은 채로 매겼습니다.",
    };
  }
  // 지난달 값으로 매긴 달은 근거 첫머리에 그 달을 밝힌다(원장 2026-10-15 *"안내문구에도 그 문구 표시할것"*).
  const prev = r.dataMonth ? `지난달(${Number(r.dataMonth.slice(5, 7))}월)` : null;
  return {
    ...base, raw: r.raw, source: r.source, students: r.students, classes: r.classes, enrollments: r.enrollments,
    detail: r.byClass ?? [], ...(r.newcomer ? { newcomer: true } : {}),
    basis: r.raw !== null ? `${prev ? `${prev} ` : ""}급여 비율 ${r.raw.toFixed(1)}% · ${r.source}` : `${prev ? `${prev} 값 · ` : ""}${r.problem ?? "자료 없음"}`,
    reason: `${prev ? `이번 달 급여는 월말이 돼야 확정되므로 ${prev} 급여 ÷ ${prev} 매출로 매깁니다. ` : ""}급여(세전) ÷ 담당 매출(담당 반 학생 청구서의 그 반 금액, 할인 전)을 비율로만 보입니다. 급여는 원장 직접 입력 → 계약서 월급 → 출석부 실급여 순으로 처음 있는 것을 씁니다(혼합 계약은 계약서 월급 + 출석부 실급여). 금액은 보이지 않습니다.`,
  };
}
