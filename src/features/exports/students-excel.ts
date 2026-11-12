import "server-only";
import { phoneLabel } from "@/lib/format/phone";
import ExcelJS from "exceljs";
import type { StudentListRow } from "@/features/students/server/queries";

const STATUS_LABEL: Record<string, string> = {
  prospect: "예비",
  consulted: "상담완료",
  enrolled: "재원",
  on_hold: "휴원",
  withdrawn: "퇴원",
};

export async function buildStudentsWorkbook(
  students: StudentListRow[],
  // 과목 라벨은 학원설정(operations.subjects) 단일 소스 — 호출부가 buildSubjectMaps().labelOf 주입(하드코딩 금지).
  subjectLabelOf: (key: string) => string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "에이와";
  wb.created = new Date();
  const sheet = wb.addWorksheet("학생 목록");

  sheet.columns = [
    { header: "이름", key: "name", width: 14 },
    { header: "학년", key: "grade", width: 8 },
    { header: "학교", key: "school", width: 18 },
    { header: "상태", key: "status", width: 10 },
    { header: "수강 과목", key: "subjects", width: 18 },
    { header: "담당 강사", key: "teacher", width: 14 },
    { header: "학부모 연락처", key: "parentPhone", width: 16 },
    { header: "등록일", key: "enrolledAt", width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE9E9EE" },
  };

  for (const s of students) {
    sheet.addRow({
      name: s.name,
      grade: s.grade ?? "—",
      school: s.school ?? "—",
      status: STATUS_LABEL[s.status] ?? s.status,
      subjects: s.subjects.map((sub) => subjectLabelOf(sub)).join(", "),
      teacher: s.teacherNames.length > 0 ? s.teacherNames.join(", ") : "—",
      parentPhone: phoneLabel(s.parentPhone) ?? "—",
      enrolledAt: s.enrolledAt ?? "—",
    });
  }

  return wb;
}
