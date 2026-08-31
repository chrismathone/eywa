/**
 * 누적 미수의 **어느 달 몫인가** 라벨 — 순수 함수(Vitest).
 *
 * 원장 2026-08-31: *"운영실 미수 상위 이것도 오해가 없도록 몇월분이 미납인건지 26.08 이런식으로
 * 월미납 붙여놓자"* + *"26.08, 26.09 라벨이 붙는거지 2개월 합산액이면"*.
 *
 * 🔴 이 카드의 금액은 **전 기간 합산**이라 "81.8만"만 보면 이번 달치로 읽힌다(실제 윤나연은 3월+4월이었다).
 *    달을 함께 적으면 그 오해가 사라진다.
 * ⚠️ 칸이 좁아 **두 개까지만** 적고 나머지는 `외 N`으로 접는다(실측 2026-08-31: 미납 학생 96명 중
 *    2개월이 4명, 나머지는 1개월 — 두 칸이면 거의 전부가 그대로 보인다).
 */

/** 라벨에 쓰는 최대 개수. 넘치면 `외 N`. */
export const OUTSTANDING_PERIOD_MAX = 2;

/** `2026-08` → `26.08`. 형식이 아니면 그대로 돌려준다(화면에 raw가 새지 않게 호출부가 거른다). */
export function shortPeriod(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period ?? ""));
  return m ? `${m[1].slice(2)}.${m[2]}` : String(period ?? "");
}

/**
 * 표시용 라벨 목록 + 접힌 개수.
 * 정렬은 **오래된 것부터** — 미수는 오래된 달이 더 급한 사실이라 그쪽을 먼저 보인다.
 */
export function outstandingPeriodLabels(
  periods: readonly string[],
  max = OUTSTANDING_PERIOD_MAX,
): { labels: string[]; more: number } {
  const valid = [...new Set((periods ?? []).filter((p) => /^\d{4}-\d{2}$/.test(String(p))))].sort();
  return {
    labels: valid.slice(0, Math.max(0, max)).map(shortPeriod),
    more: Math.max(0, valid.length - Math.max(0, max)),
  };
}

/** 미수가 남은 청구 한 줄(라벨 계산에 필요한 칸만). */
export type OutstandingPeriodRow = {
  student_id: string;
  period: string;
  amount_total: number | string | null;
  amount_discount: number | string | null;
  amount_paid: number | string | null;
};

/**
 * 학생별 **미수가 남은 청구월** 목록. 잔액 계산은 앱의 `invoiceOutstanding`과 같은 식
 * (청구 − 할인 − 납부, 0 이하는 제외) — 카드 금액과 라벨이 같은 근거를 보게 한다.
 */
export function groupOutstandingPeriods(rows: readonly OutstandingPeriodRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows ?? []) {
    const owed =
      Number(r.amount_total ?? 0) - Number(r.amount_discount ?? 0) - Number(r.amount_paid ?? 0);
    if (!(owed > 0)) continue;
    const list = out.get(r.student_id);
    if (list) list.push(r.period);
    else out.set(r.student_id, [r.period]);
  }
  return out;
}
