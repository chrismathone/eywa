/**
 * 운영실 수납 카드의 **과목별 값**(원장 2026-10-14 2단계 *"과목별로 나눠서(해당 과목 관리자일 경우)"* → 기준 = **청구 항목별**).
 * 청구서에는 과목 칸이 없어 청구 줄마다 과목을 정한다. 순수 함수(Vitest).
 *
 * 줄의 과목 = ① 줄에 반 id가 있으면 그 반 ② 반 이름이 맞는 그 학생의 반(`receiptMatchesClass` — 회차 확정 배분 추천과 같은 판정)
 * ③ 그 달 그 학생이 한 과목만 다녔으면 그 과목 ④ 그래도 모르면 **과목 모름**.
 * 과목 모름 줄은 어느 과목 합계에도 넣지 않고 따로 센다(원장 결정 — '과목 모름'으로 따로 보인다).
 * 실측(2026-10, 수업 항목 775개): 반 이름 일치 47% · 한 과목 학생 31% → 금액의 85%가 과목으로 갈렸다.
 *
 * ⚠️ 과목 합계는 **줄 금액**(청구·수납·할인)의 합이다 — 청구서 머리의 합계와 적립금·환불 처리 차이로 조금 다를 수 있다.
 *    건수(완납·부분납·미납)는 그 과목 줄이 하나라도 있는 청구서를 한 건으로 센다(두 과목 청구서는 양쪽에 한 건씩).
 *    상태는 **그 과목 줄로 다시** 정한다(`subjectStatus`) — 머리 상태를 그대로 쓰면 수학 줄을 다 낸 부분납 청구서가
 *    수학 관리자에게 '부분납'으로 섰다(적대 리뷰 2026-10-14 실측: 수학 17건 중 실제 미수 4건).
 * ⚠️ 줄에 수납 기록(`paid`·`unpaid`)이 하나도 없는 청구서(엑셀로 넣기·손으로 만든 청구서)는 머리의 수납·할인을 줄 금액 비율로
 *    나눠 싣는다 — 0으로 두면 부분납이 미납으로 뒤집힌다(재리뷰 2026-10-14).
 */
import { invoiceOutstanding, summarizeInvoices, type BillingSummary, type InvoiceSummaryInput } from "@/features/billing/calc";
import { normalizeInvoiceLineItems } from "@/features/billing/invoice-line-items";
import { receiptMatchesClass } from "@/features/billing/session-terms/receipt-suggestion";

export type StudentClassRef = { classId: string; className: string | null; subject: string | null };
/** `left` = 그 줄에 남은 금액 — makeedu 줄 미납액이 있으면 그 값, 없으면 청구−할인−적립금−수납(0 아래는 0). */
export type ClassifiedLine = { subject: string | null; amount: number; paid: number; discount: number; left: number };
/** `outstanding` = 청구서 머리의 미수(`invoiceOutstanding` — 완납·환불·무효는 0). 과목 모름 미수의 상한. */
export type ClassifiedInvoice = { period: string; status: string; outstanding: number; lines: ClassifiedLine[] };
/**
 * 과목으로 못 가른 청구 — 과목 관리자 카드에 '과목 모름'으로 따로 선다(모든 과목 관리자에게 같은 값).
 * `outstanding`·`count` = 과목 모름 줄에 남은 미수와 그런 청구서 수. 미수는 **청구서 단위로** 접는다 — 그 청구서의 과목 모름 줄
 * 남은 금액 합(0 아래는 0)을 머리 미수로 자른다. 줄마다 따로 자르면 상쇄가 안 돼 학원 전체 미수보다 커진다(적대 리뷰 2026-10-14).
 * 이 값이 없으면 과목 모름 줄에만 미수가 남은 청구서(실측 2026-10: 14건 · 341,000원)가 어느 과목 관리자에게도 안 보인다(재리뷰).
 */
export type UnclassifiedMoney = { billed: number; outstanding: number; count: number; lines: number };
export type SubjectBillingSummary = BillingSummary & { unclassified?: UnclassifiedMoney };

export type InvoiceForSubject = {
  period: string;
  status: string;
  amount_total: number | string;
  amount_paid: number | string;
  amount_discount: number | string | null;
  line_items: unknown;
};

const num = (v: unknown) => Number(v) || 0;

/**
 * 과목 줄로 다시 정한 청구서 상태 — 머리가 미납·부분납일 때만 그 과목 줄로 가른다. 순서는 머리 상태를 만드는 makeedu 규칙과 같다
 * (`scripts/_makeedu/import-invoices.cjs`): 낸 돈이 없으면 미납 → 남은 금액이 없으면 완납 → 나머지 부분납.
 * 완납·환불·무효 등 다른 상태는 머리 그대로(완납 판정은 머리가 진실 — calc.ts).
 */
export function subjectStatus(head: string, lines: readonly ClassifiedLine[]): string {
  if (head !== "partial" && head !== "unpaid") return head;
  if (lines.reduce((s, l) => s + l.paid, 0) <= 0) return "unpaid";
  return lines.reduce((s, l) => s + l.left, 0) <= 0 ? "paid" : "partial";
}

/** `total`을 양수 금액 비율로 정수 나누기 — 끝전은 마지막 몫에. 양수 금액이 없으면 똑같이. */
function allocate(total: number, amounts: readonly number[]): number[] {
  const weights = amounts.map((a) => Math.max(0, a));
  const sum = weights.reduce((s, w) => s + w, 0);
  const shares = sum > 0 ? weights.map((w) => w / sum) : amounts.map(() => 1 / amounts.length);
  const out = shares.map((share) => Math.round(total * share));
  const rest = total - out.reduce((s, v) => s + v, 0);
  const last = out.length - 1;
  out[last] = (out[last] ?? 0) + rest;
  return out;
}

/** 청구서 한 장의 줄마다 과목을 정한다. `classes` = 그 달 그 학생의 반(수강이 그 달에 걸린 반). */
export function classifyInvoice(inv: InvoiceForSubject, classes: readonly StudentClassRef[]): ClassifiedInvoice {
  const subjects = [...new Set(classes.map((c) => c.subject).filter((s): s is string => !!s))];
  const only = subjects.length === 1 ? subjects[0]! : null;
  const items = normalizeInvoiceLineItems(inv.line_items);
  const outstanding = invoiceOutstanding({
    amountTotal: num(inv.amount_total), amountPaid: num(inv.amount_paid), amountDiscount: num(inv.amount_discount), status: inv.status,
  });
  if (!items.length) {
    // 줄이 없는 청구서 — 한 줄로 보고 학생의 과목이 하나면 그 과목, 아니면 모름.
    return {
      period: inv.period,
      status: inv.status,
      outstanding,
      lines: [{
        subject: only,
        amount: num(inv.amount_total),
        paid: num(inv.amount_paid),
        discount: num(inv.amount_discount),
        left: Math.max(0, num(inv.amount_total) - num(inv.amount_discount) - num(inv.amount_paid)),
      }],
    };
  }
  // 줄에 수납 기록이 없으면 머리의 수납(·줄 할인도 없으면 할인)을 줄 금액 비율로 나눈다.
  const amounts = items.map((line) => num(line.amount));
  const hasPayment = items.some((line) => line.paid !== undefined || line.unpaid !== undefined);
  const paidOf = hasPayment ? items.map((line) => num(line.paid)) : allocate(num(inv.amount_paid), amounts);
  const discountOf = hasPayment || items.some((line) => line.discount !== undefined)
    ? items.map((line) => num(line.discount))
    : allocate(num(inv.amount_discount), amounts);
  return {
    period: inv.period,
    status: inv.status,
    outstanding,
    lines: items.map((line, i) => {
      const byId = line.classId ? classes.find((c) => c.classId === line.classId)?.subject ?? null : null;
      const matched = byId ? [byId] : [...new Set(classes.filter((c) => receiptMatchesClass(line, { classId: c.classId, className: c.className })).map((c) => c.subject).filter((s): s is string => !!s))];
      const paid = paidOf[i]!;
      const discount = discountOf[i]!;
      return {
        subject: matched.length === 1 ? matched[0]! : matched.length === 0 ? only : null,
        amount: amounts[i]!,
        paid,
        discount,
        left: line.unpaid ?? Math.max(0, amounts[i]! - discount - num(line.points) - paid),
      };
    }),
  };
}

/** 그 달들의 과목별 요약 — `inSubject`를 지나는 과목 줄만 더하고, 과목 모름 줄은 `unclassified`로 따로. */
export function summarizeSubjectBilling(
  invoices: readonly ClassifiedInvoice[],
  months: readonly string[],
  inSubject: (subject: string) => boolean,
): SubjectBillingSummary[] {
  return months.map((month) => {
    const rows: InvoiceSummaryInput[] = [];
    const unclassified: UnclassifiedMoney = { billed: 0, outstanding: 0, count: 0, lines: 0 };
    for (const inv of invoices) {
      if (inv.period !== month) continue;
      const mine = inv.lines.filter((l) => l.subject !== null && inSubject(l.subject));
      if (mine.length) {
        rows.push({
          amountTotal: mine.reduce((s, l) => s + l.amount, 0),
          amountPaid: mine.reduce((s, l) => s + l.paid, 0),
          amountDiscount: mine.reduce((s, l) => s + l.discount, 0),
          status: subjectStatus(inv.status, mine),
        });
      }
      const unknown = inv.lines.filter((l) => l.subject === null);
      if (!unknown.length) continue;
      unclassified.lines += unknown.length;
      unclassified.billed += unknown.reduce((s, l) => s + l.amount, 0);
      const left = Math.min(inv.outstanding, Math.max(0, unknown.reduce((s, l) => s + l.left, 0)));
      if (left > 0) {
        unclassified.outstanding += left;
        unclassified.count++;
      }
    }
    return { ...summarizeInvoices(rows, month), unclassified };
  });
}

/** 수강 한 줄이 그 달(YYYY-MM)에 걸렸나 — 시작일 ≤ 말일 · 종료일 없음 또는 ≥ 1일. */
export function enrollmentInMonth(e: { start: string | null; end: string | null }, month: string): boolean {
  const first = `${month}-01`;
  const last = `${month}-31`;
  return (!e.start || e.start.slice(0, 10) <= last) && (!e.end || e.end.slice(0, 10) >= first);
}
