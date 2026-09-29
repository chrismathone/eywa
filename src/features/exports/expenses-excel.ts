import "server-only";
import ExcelJS from "exceljs";
import type { ExpenseRow } from "@/features/billing/server/expense-queries";

/**
 * 지출 엑셀 — 수납관리 '지출' 면의 **표와 같은 집합**(월 · 분류 · 검색어, 감사 N2).
 * 🔴 계좌·카드번호(`accountNumber`)는 싣지 않는다 — 파일은 메일·메신저로 돌아다닌다(은행/카드명만).
 * 금액은 통화별로 다르므로 통화 칸을 함께 싣고 합계 행은 만들지 않는다(₩와 $를 한 숫자로 더하지 않는 규약).
 */
export type ExpenseExcelRow = {
  expenseDate: string;
  department: string;
  author: string;
  position: string;
  title: string;
  category: string;
  currency: string;
  amount: number;
  paymentMethod: string;
  bankName: string;
  vendor: string;
  receiptType: string;
  receiptCount: number;
  authorCheck: string;
  directorCheck: string;
  ceoCheck: string;
  executorCheck: string;
  lineItems: string;
  memo: string;
};

const mark = (v: boolean | undefined) => (v ? "O" : "");

export function expenseExcelRows(rows: readonly ExpenseRow[]): ExpenseExcelRow[] {
  return rows.map((r) => ({
    expenseDate: r.expenseDate,
    department: r.department ?? "",
    author: r.author ?? "",
    position: r.position ?? "",
    title: r.title,
    category: r.category,
    currency: r.currency,
    amount: r.amount,
    paymentMethod: r.paymentMethod ?? "",
    bankName: r.bankName ?? "",
    vendor: r.vendor ?? "",
    receiptType: r.receiptType ?? "",
    receiptCount: r.receiptUrls.length,
    authorCheck: mark(r.approvalChecks.author?.checked),
    directorCheck: mark(r.approvalChecks.director?.checked),
    ceoCheck: mark(r.approvalChecks.ceo?.checked),
    executorCheck: mark(r.approvalChecks.executor?.checked),
    lineItems: (r.lineItems ?? [])
      .map((li) => {
        const text = [li.purpose, li.vendor, li.description].filter((x) => typeof x === "string" && x.trim()).join(" · ");
        return `${text} ${Number(li.total).toLocaleString("ko-KR")}`.trim();
      })
      .filter(Boolean)
      .join("\n"),
    memo: r.memo ?? "",
  }));
}

export async function buildExpensesWorkbook(rows: readonly ExpenseRow[], period: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "에이와";
  wb.created = new Date();
  const sheet = wb.addWorksheet(`${period} 지출`);
  sheet.columns = [
    { header: "일자", key: "expenseDate", width: 12 },
    { header: "부서명", key: "department", width: 12 },
    { header: "성명", key: "author", width: 10 },
    { header: "직위", key: "position", width: 10 },
    { header: "제목", key: "title", width: 30 },
    { header: "분류", key: "category", width: 10 },
    { header: "통화", key: "currency", width: 7 },
    { header: "총액", key: "amount", width: 14 },
    { header: "결제수단", key: "paymentMethod", width: 10 },
    { header: "은행·카드명", key: "bankName", width: 14 },
    { header: "거래처", key: "vendor", width: 16 },
    { header: "증빙 유형", key: "receiptType", width: 12 },
    { header: "증빙 첨부", key: "receiptCount", width: 9 },
    { header: "작성", key: "authorCheck", width: 6 },
    { header: "원장", key: "directorCheck", width: 6 },
    { header: "대표", key: "ceoCheck", width: 6 },
    { header: "집행자", key: "executorCheck", width: 7 },
    { header: "항목", key: "lineItems", width: 40 },
    { header: "메모", key: "memo", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9EE" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of expenseExcelRows(rows)) sheet.addRow(row);
  sheet.getColumn("amount").numFmt = "#,##0.##";
  sheet.getColumn("lineItems").alignment = { wrapText: true, vertical: "top" };
  return wb;
}
