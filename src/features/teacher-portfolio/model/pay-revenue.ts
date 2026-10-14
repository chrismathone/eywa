/**
 * '매출 대비 급여'의 매출 — 출석부 줄(학생 × 담당 반) 하나의 그 달 청구액(할인 전). 순수 함수.
 * 원장 2026-10-14 *"회차 확정으로 하지말고 청구액으로 잡을것"* · *"청구액으로 바로 잡는건 안되나? 회차 확정을 해야만 잡을 수가 있나?"*.
 *
 * - 그 반의 회차 행이 있는 청구서 = 출석부 청구액 열(`billing.billed`)의 값 그대로(회차 확정 배분·이월이 실린 값).
 * - 회차 행이 없는 청구서 = 청구서 항목을 그 반 이름·코드에 맞춘 금액(`classInvoiceAmount`) — 회차 확정을 기다리지 않는다.
 *   한 학생의 청구서가 둘이면 청구서마다 따로 본다(한쪽에만 회차 행이 있어도 다른 쪽 금액이 빠지지 않게).
 * - 이름으로 못 맞춘 줄은 짝이 하나뿐일 때 바로 잡는다(`soleLeftover`) — 영어 청구서 항목은 교재 이름("[EiE] Pre Let's 5"),
 *   반 이름은 줄임("PL5")이라 이름으로는 안 맞는다.
 * - 🔴 그 달 그 반 수강이 없는 줄(보강 방문 — `enrolled` false)은 출석부 청구액만 본다 — 이름으로 맞추면 같은 코드의 분반
 *   ("PS2S-1" ↔ 자기 반 항목 "PS2S 화목")에서 그 학생 수강료가 두 반에 잡힌다.
 * - 🔴 자유 배분(0279a — 금액을 반에 직접 준 것)이 있는 청구서는 회차 행이 없는 반을 이름으로 채우지 않는다 — 채우면 한 반에 몰아 준
 *   금액이 다른 반에 또 잡혀 매출이 부푼다. 0원으로 세지도 않는다(그 배분이 지금도 유효한지는 여기서 모른다 — 0은 매출을 깎는다).
 * 맞춘 금액이 하나도 없으면 null(0원을 지어내지 않는다 — 분모의 '못 맞춘 줄').
 */
import { classInvoiceAmount, lineMatchesClass, type LineItemLike } from "@/features/billing/session-terms/class-amount";
import { receiptSalaryAmount } from "@/features/billing/session-terms/receipt-refund";
import { isTuitionReceipt } from "@/features/billing/session-terms/tuition-receipt";

/**
 * `termClassIds` = 그 청구서에 회차 행이 있는 반 · `freeAllocated` = 그 청구서에 자유 배분이 있다 ·
 * `allocatedClassIds`·`allocatedLines` = 회차 확정 배분을 받은 반 · 배분이 걸린 항목 자리(`line_items` 순번).
 */
export type RevenueInvoice = {
  items: LineItemLike[]; termClassIds: ReadonlySet<string>; freeAllocated: boolean;
  allocatedClassIds: ReadonlySet<string>; allocatedLines: ReadonlySet<number>;
};
export type SolePair = { classId: string; amount: number };

export function rowRevenue(row: {
  classId: string; className: string; billed: number | undefined; invoices: readonly RevenueInvoice[]; sole?: SolePair | null; enrolled: boolean;
}): number | null {
  const parts: number[] = typeof row.billed === "number" && Number.isFinite(row.billed) ? [row.billed] : [];
  if (!row.enrolled) return parts.length ? parts[0]! : null;
  for (const invoice of row.invoices) {
    if (invoice.termClassIds.has(row.classId) || invoice.freeAllocated) continue; // 출석부 청구액(billed)에 이미 들어 있다 · 자유 배분.
    const amount = classInvoiceAmount(row.className, invoice.items);
    if (amount !== null) parts.push(amount);
  }
  if (parts.length) return parts.reduce((n, v) => n + v, 0);
  return row.sole?.classId === row.classId ? row.sole.amount : null;
}

/**
 * 짝이 하나뿐인 청구서 항목 — 학생 한 명의 그 달 반 가운데 이름으로도 배분으로도 금액을 못 받은 반이 **하나**이고,
 * 어느 반에도 안 맞은 수강료 항목도 **하나**면 둘을 짝짓는다. 회차 확정 자동 재확정과 같은 결(답이 하나면 자동, 여럿이면
 * 회차 확정 배분을 기다린다 — 반 이동한 달처럼 못 맞춘 반이 둘이면 짓지 않는다).
 * - 수강료 항목만(`isTuitionReceipt` — 강아·PHONICS&ROOKIES 같은 프로그램 비용은 빠진다). 교재·차량비는 수업 항목이 아니다.
 * - 자유 배분 청구서는 보지 않는다 · 배분이 걸린 항목은 짝 후보가 아니다.
 * - 항목 주인은 이름이 맞는지로만 본다(`lineMatchesClass` — 부분 환불로 금액을 못 정해도 그 반 항목이다. 그 반은 짝을 받지 않는다).
 * `classes` = 그 학생의 앞뒤 달까지의 반 전부(어느 선생님 반이든 — 지난 반·다음 달 반 몫 항목을 이 반에 붙이지 않게) ·
 * `open` = 그 달 실제로 다니는 반(휴원 제외 · 반 이동은 반열림) — 짝을 받을 수 있는 반은 이것뿐이다.
 */
export function soleLeftover(classes: readonly { id: string; name: string; open: boolean }[], invoices: readonly RevenueInvoice[]): SolePair | null {
  const covered = new Set<string>();
  const leftover: LineItemLike[] = [];
  for (const invoice of invoices) {
    if (invoice.freeAllocated) {
      for (const id of invoice.termClassIds) covered.add(id);
      continue;
    }
    for (const id of invoice.allocatedClassIds) covered.add(id);
    invoice.items.forEach((item, index) => {
      const owners = classes.filter((c) => lineMatchesClass(c.name, item));
      for (const c of owners) covered.add(c.id);
      if (!owners.length && !invoice.allocatedLines.has(index) && isTuitionReceipt(item)) leftover.push(item);
    });
  }
  const open = [...new Map(classes.filter((c) => c.open && !covered.has(c.id)).map((c) => [c.id, c])).values()];
  if (open.length !== 1 || leftover.length !== 1) return null;
  const amount = receiptSalaryAmount(leftover[0]);
  return amount === null ? null : { classId: open[0]!.id, amount };
}
