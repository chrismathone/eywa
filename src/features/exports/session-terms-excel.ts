import "server-only";
import ExcelJS from "exceljs";
import type { SessionTermRow } from "@/features/billing/session-terms/server/queries";
import { netAllocatedAmount } from "@/features/billing/session-terms/money-carryover";
import { NO_LESSON_LABEL, TERM_STATE_LABEL } from "@/features/billing/session-terms/month-roster";
import { schoolGradeLabel } from "@/lib/format/school-grade";

/**
 * 회차 확정 엑셀 — 수납관리 '회차 확정' 면의 **표와 같은 줄 집합**(과목·검색·미확정만·미배분만, 감사 N2).
 * 🔴 돈 숫자는 새로 계산하지 않는다 — 확정액·단가는 저장값, 실납은 화면과 같은 `netAllocatedAmount`.
 * raw 코드(termState·pricingMode)는 한글 라벨로만 싣는다.
 */
export type SessionTermExcelRow = {
  subject: string;
  className: string;
  homeroom: string;
  studentName: string;
  schoolGrade: string;
  state: string;
  unit: string;
  planned: number | null;
  confirmed: number | null;
  unitPrice: number | null;
  amount: number | null;
  classAmount: number | null;
  received: number | null;
  confirmedOn: string;
  note: string;
};

function kstDate(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

export function sessionTermExcelRows(rows: readonly (SessionTermRow & { subjectLabel: string })[]): SessionTermExcelRow[] {
  return rows.map((r) => {
    const stateParts = [
      r.termState === "term" ? (r.confirmedSessions === null ? "미확정" : "확정") : TERM_STATE_LABEL[r.termState].label,
      r.noLesson ? NO_LESSON_LABEL.label : null,
      r.duplicateInvoice ? "청구서 중복" : null,
    ].filter(Boolean);
    return {
      subject: r.subjectLabel,
      className: r.className ?? "(반 미지정)",
      homeroom: r.homeroomTeacherName ?? "",
      studentName: r.studentName,
      schoolGrade: schoolGradeLabel(r.studentSchool ?? null, r.studentGrade),
      state: stateParts.join(" · "),
      unit: r.pricingMode === "monthly" ? "월 정액" : "회당",
      planned: r.plannedSessions,
      confirmed: r.confirmedSessions,
      unitPrice: r.unitPrice,
      amount: r.amount,
      classAmount: r.classAmount,
      received: r.allocatedAmount != null ? (netAllocatedAmount(r) ?? r.allocatedAmount) : null,
      confirmedOn: kstDate(r.confirmedAt),
      note: r.note ?? "",
    };
  });
}

export async function buildSessionTermsWorkbook(
  rows: readonly (SessionTermRow & { subjectLabel: string })[],
  period: string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "aywa";
  wb.created = new Date();
  const sheet = wb.addWorksheet(`${period} 회차 확정`);
  sheet.columns = [
    { header: "과목", key: "subject", width: 10 },
    { header: "반", key: "className", width: 22 },
    { header: "담임", key: "homeroom", width: 10 },
    { header: "학생", key: "studentName", width: 12 },
    { header: "학교·학년", key: "schoolGrade", width: 12 },
    { header: "상태", key: "state", width: 16 },
    { header: "단위", key: "unit", width: 8 },
    { header: "예정", key: "planned", width: 7 },
    { header: "확정", key: "confirmed", width: 7 },
    { header: "단가", key: "unitPrice", width: 11 },
    { header: "확정액", key: "amount", width: 12 },
    { header: "반 청구액", key: "classAmount", width: 12 },
    { header: "실납(배분)", key: "received", width: 12 },
    { header: "확정일", key: "confirmedOn", width: 12 },
    { header: "메모", key: "note", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9EE" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of sessionTermExcelRows(rows)) sheet.addRow(row);
  for (const key of ["unitPrice", "amount", "classAmount", "received"]) sheet.getColumn(key).numFmt = "#,##0";
  return wb;
}
