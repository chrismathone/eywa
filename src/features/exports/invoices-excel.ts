import "server-only";
import ExcelJS from "exceljs";
import type { InvoiceRow } from "@/features/billing/server/queries";

const STATUS_LABEL: Record<string, string> = {
  paid: "완납",
  partial: "부분",
  unpaid: "미수",
  refunded: "환불",
  void: "취소",
};

const CATEGORY_LABEL: Record<string, string> = {
  tuition: "수강료",
  material: "교재",
  exam: "시험",
  other: "기타",
};

export async function buildInvoicesWorkbook(
  invoices: InvoiceRow[],
  period: string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "eywa";
  wb.created = new Date();
  const sheet = wb.addWorksheet(`${period} 수납`);

  sheet.columns = [
    { header: "학생명", key: "studentName", width: 14 },
    { header: "학년", key: "studentGrade", width: 8 },
    { header: "담임", key: "teacher", width: 12 },
    { header: "카테고리", key: "category", width: 10 },
    { header: "청구액", key: "amountTotal", width: 12 },
    { header: "할인", key: "amountDiscount", width: 10 },
    { header: "수납액", key: "amountPaid", width: 12 },
    { header: "잔액", key: "balance", width: 12 },
    { header: "기한", key: "dueDate", width: 12 },
    { header: "납부일", key: "paidAt", width: 16 },
    { header: "상태", key: "status", width: 10 },
    { header: "메모", key: "notes", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF1EDE2" },
  };

  for (const inv of invoices) {
    const balance = inv.amountTotal - inv.amountPaid - inv.amountDiscount;
    sheet.addRow({
      studentName: inv.studentName,
      studentGrade: inv.studentGrade ?? "—",
      teacher: inv.teacherName ?? "—",
      category: CATEGORY_LABEL[inv.category] ?? inv.category,
      amountTotal: inv.amountTotal,
      amountDiscount: inv.amountDiscount,
      amountPaid: inv.amountPaid,
      balance,
      dueDate: inv.dueDate ?? "—",
      paidAt: inv.paidAt ?? "—",
      status: STATUS_LABEL[inv.status] ?? inv.status,
      notes: inv.notes ?? "",
    });
  }

  // 숫자 컬럼 number format
  sheet.getColumn("amountTotal").numFmt = "#,##0";
  sheet.getColumn("amountDiscount").numFmt = "#,##0";
  sheet.getColumn("amountPaid").numFmt = "#,##0";
  sheet.getColumn("balance").numFmt = "#,##0";

  return wb;
}
