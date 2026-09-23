import "server-only";
import ExcelJS from "exceljs";
import type { InvoiceRow } from "@/features/billing/server/queries";
import { invoiceDisplayLines, invoiceKindLabel, paymentMethodLabel } from "@/features/billing/invoice-lines";
import { overdueLinesOnly } from "@/features/billing/sync-window";

const STATUS_LABEL: Record<string, string> = {
  paid: "완납",
  partial: "부분",
  unpaid: "미수",
  refunded: "환불",
  void: "취소",
};


/**
 * timestamptz(또는 date) → KST "YYYY-MM-DD". 값이 없으면 "—".
 * 표시 시각은 항상 Asia/Seoul(feedback_kst-timezone-display-rule) — 엑셀도 화면과 같은 날짜를 말해야 한다.
 */
function kstDate(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  // en-CA = YYYY-MM-DD 고정 포맷(엑셀 정렬·필터에 유리).
  return t.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** 엑셀 한 줄 = 화면 수납 표의 한 줄(라인 단위). 순수 함수 — 워크북과 분리해 Vitest로 잠근다(감사 N3). */
export type InvoiceExcelLine = {
  studentName: string;
  studentGrade: string;
  period: string;
  billedOn: string;
  kind: string;
  description: string;
  amount: number;
  discount: number | null;
  points: number | null;
  paid: number | null;
  /** null = 라인별 미납을 알 수 없는 구형 청구서의 2번째+ 라인(화면 "—"). */
  unpaid: number | null;
  method: string;
  cardCompany: string;
  paidOn: string;
  status: string;
  notes: string;
  discountReason: string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export function invoiceExcelLines(
  invoices: readonly InvoiceRow[],
  opts: { overdueOnly?: boolean } = {},
): InvoiceExcelLine[] {
  const out: InvoiceExcelLine[] = [];
  for (const inv of invoices) {
    // 화면과 **같은** 라인 펼치기(invoiceDisplayLines) + '기한 경과만'이면 같은 미납 라인 거르기.
    const all = invoiceDisplayLines(inv);
    const lines = opts.overdueOnly ? overdueLinesOnly(all) : all;
    lines.forEach((li, i) => {
      const first = i === 0;
      const method = li.method ?? null;
      const isCard = method === "card" || (method == null && inv.paymentMethod === "card");
      out.push({
        studentName: inv.studentName,
        studentGrade: inv.studentGrade ?? "",
        period: inv.period,
        // 청구일 — makeedu 라인은 일(dueDay)만 있어 청구월과 붙인다. 수동 청구서는 billed_at(화면과 같은 폴백).
        billedOn: li.dueDay ? `${inv.period}-${pad2(li.dueDay)}` : inv.billedAt ? kstDate(inv.billedAt) : "",
        kind: invoiceKindLabel(li.kind) || "수업",
        description: li.description ?? "",
        amount: li.amount,
        discount: li.discount ?? null,
        points: li.points ?? null,
        paid: li.paid ?? null,
        unpaid: li.unpaid ?? null,
        method: paymentMethodLabel(method),
        cardCompany: isCard ? (inv.cardCompany ?? "") : "",
        paidOn: li.paidDate ? kstDate(li.paidDate) : "",
        status: STATUS_LABEL[inv.status] ?? inv.status,
        notes: first ? (inv.notes ?? "") : "",
        discountReason: first ? (inv.discountReason ?? "") : "",
      });
    });
  }
  return out;
}

/**
 * 수납 엑셀 — **화면 수납 표와 같은 라인 단위 열**(감사 N3, 2026-09-23). 종전엔 청구서 한 줄 요약이라
 * 수납명·결제수단·카드사·적립금·청구일이 빠져 카드·현금 대조를 못 했다.
 * 🔴 돈 숫자는 새로 계산하지 않는다 — 라인 값은 화면이 쓰는 `invoiceDisplayLines` 그대로다.
 */
export async function buildInvoicesWorkbook(
  invoices: InvoiceRow[],
  period: string,
  opts: { overdueOnly?: boolean } = {},
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "aywa";
  wb.created = new Date();
  const sheet = wb.addWorksheet(`${period} 수납`);

  sheet.columns = [
    { header: "학생명", key: "studentName", width: 14 },
    { header: "학년", key: "studentGrade", width: 8 },
    { header: "청구월", key: "period", width: 10 },
    { header: "청구일", key: "billedOn", width: 12 },
    { header: "구분", key: "kind", width: 8 },
    { header: "수납명", key: "description", width: 30 },
    { header: "청구액", key: "amount", width: 12 },
    { header: "할인액", key: "discount", width: 10 },
    { header: "적립금", key: "points", width: 10 },
    { header: "실제낸금액", key: "paid", width: 12 },
    { header: "미납금액", key: "unpaid", width: 12 },
    { header: "결제수단", key: "method", width: 10 },
    { header: "카드사", key: "cardCompany", width: 12 },
    { header: "수납일", key: "paidOn", width: 12 },
    { header: "상태", key: "status", width: 8 },
    { header: "메모", key: "notes", width: 24 },
    { header: "할인 사유", key: "discountReason", width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE9E9EE" },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const line of invoiceExcelLines(invoices, opts)) sheet.addRow(line);

  for (const key of ["amount", "discount", "points", "paid", "unpaid"]) sheet.getColumn(key).numFmt = "#,##0";

  return wb;
}
