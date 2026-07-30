import "server-only";
import ExcelJS from "exceljs";
import type { InvoiceRow } from "@/features/billing/server/queries";
import { invoiceOutstanding } from "@/features/billing/calc";

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
    fgColor: { argb: "FFE9E9EE" },
  };

  for (const inv of invoices) {
    // 잔액 = 행 레벨 미수(청구−할인−수납, 0 바닥, paid/refunded/void = 0) — calc.ts 단일 공식.
    // 컬럼 합계가 수납관리 KPI '미수 총액'과 일치한다(구: 무clamp라 음수·유령 미수 혼입).
    const balance = invoiceOutstanding(inv);
    sheet.addRow({
      studentName: inv.studentName,
      studentGrade: inv.studentGrade ?? "—",
      category: CATEGORY_LABEL[inv.category] ?? inv.category,
      amountTotal: inv.amountTotal,
      amountDiscount: inv.amountDiscount,
      amountPaid: inv.amountPaid,
      balance,
      dueDate: inv.dueDate ?? "—",
      // paid_at은 timestamptz라 PostgREST가 "2026-07-16T00:00:00+00:00" 원문으로 준다 —
      // 그대로 넣으면 엑셀에 ISO UTC가 찍히고(화면 표는 "07.16") KST 표시 규칙도 깨진다.
      // 게다가 실제 결제 시각이 들어오는 순간 KST 00:00~08:59 건은 UTC 날짜가 전날이라 하루 밀어 보고된다.
      paidAt: kstDate(inv.paidAt),
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
