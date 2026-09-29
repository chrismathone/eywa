import type ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { InvoiceRow } from "@/features/billing/server/queries";
import type { ExpenseRow } from "@/features/billing/server/expense-queries";
import type { ClassListRow } from "@/features/classes/server/queries";
import type { StudentListRow } from "@/features/students/server/queries";
import { buildClassesWorkbook } from "@/features/exports/classes-excel";
import { buildExpensesWorkbook } from "@/features/exports/expenses-excel";
import { buildInvoicesWorkbook } from "@/features/exports/invoices-excel";
import { buildStudentsWorkbook } from "@/features/exports/students-excel";
import classesDef from "./importers/classes";
import expensesDef from "./importers/expenses";
import invoicesDef from "./importers/invoices";
import studentsDef from "./importers/students";
import { readSheetGrid, type SheetRows } from "./rows";
import { parseOption, type ImportIssue, type SheetSpec } from "./spec";
import { findSheet, loadWorkbook, sheetGrid } from "./server/workbook";

/**
 * 🔴 **내보낸 파일 = 올릴 수 있는 파일**(원장 2026-09-29 *"전부다 맞추기도 맞출것"*) — 각 탭의 실제 내보내기 함수로 만든 xlsx를
 * 바이트로 한 바퀴 돌려, 그 탭 가져오기의 시트·열 규약으로 읽었을 때 **서식 오류가 0건**이고 열마다 뜻이 맞게 잡히는지 잠근다.
 * 내보내기 열을 바꾸면 여기가 먼저 깨진다(그때 가져오기 별칭을 함께 고칠 것). DB는 안 탄다.
 */
async function readExport(wb: ExcelJS.Workbook, spec: SheetSpec, single: boolean) {
  const back = await loadWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  expect(back).not.toBeNull();
  const ws = findSheet(back!, spec.name, single, spec.aliases);
  expect(ws, `'${spec.name}' 시트를 못 찾음`).not.toBeNull();
  const issues: ImportIssue[] = [];
  const read = readSheetGrid(spec, sheetGrid(ws!), issues) as SheetRows<string> | null;
  expect(issues).toEqual([]);
  expect(read).not.toBeNull();
  return read!;
}

describe("엑셀 내보내기 → 그대로 가져오기", () => {
  it("원생목록 — 학부모 연락처·상태·등록일을 알아보고, 수강 과목·담당 강사는 조용히 무시", async () => {
    const rows = [
      { id: "s1", name: "김하늘", school: "칠성중", grade: "중1", status: "enrolled", teacherNames: ["박선생"], enrolledAt: "2026-03-02", parentPhone: "010-1234-5678", subjects: ["math"], syncNew: false, dupSuspect: false, merged: false },
      { id: "s2", name: "이바다", school: null, grade: null, status: "on_hold", teacherNames: [], enrolledAt: null, parentPhone: null, subjects: [], syncNew: false, dupSuspect: false, merged: false },
    ] satisfies StudentListRow[];
    const read = await readExport(await buildStudentsWorkbook(rows, () => "수학"), studentsDef.sheets[0]!, true);
    expect([...read.map.keys()].sort()).toEqual(["enrolledAt", "grade", "name", "parentPhone", "school", "status"].sort());
    const [a, b] = read.rows;
    expect(a!.text("name")).toBe("김하늘");
    expect(a!.phone("parentPhone")).toBe("010-1234-5678");
    expect(a!.date("enrolledAt")).toBe("2026-03-02");
    expect(a!.raw("status")).toBe("재원");
    // '—'(없음)은 빈 칸 — 덮어쓰기에서 값을 지우지 않는다.
    expect(b!.text("school")).toBeNull();
    expect(b!.phone("parentPhone")).toBeNull();
    expect(b!.date("enrolledAt")).toBeNull();
    expect(a!.ok && b!.ok).toBe(true);
  });

  it("수업목록 — 시트 '수업목록'을 '반'으로 · 담임·상태·구분을 알아보고, 요일·학생 수는 무시", async () => {
    const rows = [
      { id: "c1", className: "중등M 중1 A", subject: "math", teacherId: "t1", teacherName: "박선생", classroomName: "301", isActive: true, closedAt: null, isSpecial: false, studentCount: 7, days: [{ day: "mon", start: "16:00:00" }] as ClassListRow["days"], daysStale: false, notes: "메모" },
      { id: "c2", className: "겨울 특강", subject: "math", teacherId: null, teacherName: null, classroomName: null, isActive: false, closedAt: null, isSpecial: true, studentCount: 0, days: [], daysStale: false, notes: null },
    ] satisfies ClassListRow[];
    const classSpec = classesDef.sheets.find((s) => s.name === "반")!;
    const read = await readExport(await buildClassesWorkbook(rows, () => "수학"), classSpec, false);
    expect(read.map.has("className") && read.map.has("subject") && read.map.has("teacher") && read.map.has("classroom")).toBe(true);
    expect(read.map.has("status") && read.map.has("kind") && read.map.has("notes")).toBe(true);
    const [a, b] = read.rows;
    expect(a!.text("className")).toBe("중등M 중1 A");
    expect(a!.raw("teacher")).toBe("박선생");
    expect(a!.option("status", [{ label: "운영", value: true }, { label: "종강", value: true }, { label: "폐지", value: false }])).toBe(true);
    expect(b!.option("status", [{ label: "운영", value: true }, { label: "종강", value: true }, { label: "폐지", value: false }])).toBe(false);
    expect(b!.option("kind", [{ label: "특강", value: true }, { label: "정규", value: false }])).toBe(true);
    expect(b!.text("teacher")).toBeNull(); // '—'
    expect(a!.ok && b!.ok).toBe(true);
  });

  it("수납 — 줄 단위 파일(수납명·실제낸금액)을 읽고 구분 '수업'은 수강료로", async () => {
    const inv: InvoiceRow = {
      id: "i1", studentId: "s1", studentName: "김하늘", studentGrade: "중1", period: "2026-09", category: "tuition",
      amountTotal: 300000, amountPaid: 300000, amountDiscount: 0, status: "paid", dueDate: null, paidAt: "2026-09-05T01:00:00+00:00",
      notes: "메모", lineItems: [{ kind: "tuition", description: "수강료", amount: 300000 }], paymentMethod: "card", cardCompany: "신한", cashReceiptNumber: null, pointsUsed: 0,
      discountReason: null, billedAt: "2026-09-01", syncAddedAt: null, updatedAt: null,
    };
    const read = await readExport(await buildInvoicesWorkbook([inv], "2026-09"), invoicesDef.sheets[0]!, true);
    for (const k of ["name", "grade", "period", "category", "total", "discount", "paid", "paidAt", "method", "notes", "description"]) {
      expect(read.map.has(k), k).toBe(true);
    }
    const [r] = read.rows;
    expect(r!.text("name")).toBe("김하늘");
    expect(r!.raw("period")).toBe("2026-09");
    expect(parseOption(r!.raw("category"), [{ label: "수강료", value: "tuition", aliases: ["수업"] }])).toBe("tuition");
    expect(r!.int("total")).toBe(300000);
    expect(r!.int("paid")).toBe(300000);
    expect(r!.date("paidAt")).toBe("2026-09-05");
    expect(r!.raw("method")).toBe("카드");
    expect(r!.text("description")).toBe("수강료");
    expect(r!.ok).toBe(true);
  });

  it("지출 — 제목(뒤쪽 '항목' 열 아님)·총액·일자·통화를 잡는다", async () => {
    const e = {
      id: "e1", title: "간식", category: "운영비", amount: 10000, currency: "KRW", expenseDate: "2026-09-10", createdDate: "2026-09-10",
      vendor: "편의점", department: null, author: "홍길동", position: null, bankName: null, accountNumber: null, approvalStatus: "approved",
      approvalChecks: {}, paymentMethod: "카드결제", memo: null, lineItems: [{ purpose: "세부", vendor: "x", description: "y", total: 10000 }], receiptType: null, receiptUrls: [], createdBy: null,
    } as unknown as ExpenseRow;
    const read = await readExport(await buildExpensesWorkbook([e], "2026-09"), expensesDef.sheets[0]!, true);
    expect(read.map.has("currency")).toBe(true);
    const [r] = read.rows;
    expect(r!.text("title")).toBe("간식");
    expect(r!.int("amount")).toBe(10000);
    expect(r!.date("date")).toBe("2026-09-10");
    expect(r!.raw("category")).toBe("운영비");
    expect(r!.raw("method")).toBe("카드결제");
    expect(r!.text("vendor")).toBe("편의점");
    expect(r!.ok).toBe(true);
  });
});
