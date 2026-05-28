import "server-only";
import ExcelJS from "exceljs";
import type { StudentListRow } from "@/features/students/server/queries";

const STATUS_LABEL: Record<string, string> = {
  prospect: "예비",
  consulted: "상담완료",
  enrolled: "재원",
  on_hold: "휴원",
  withdrawn: "퇴원",
};

const SUBJECT_LABEL: Record<string, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
  arts: "예술",
};

export async function buildStudentsWorkbook(
  students: StudentListRow[],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "eywa";
  wb.created = new Date();
  const sheet = wb.addWorksheet("학생 목록");

  sheet.columns = [
    { header: "이름", key: "name", width: 14 },
    { header: "학년", key: "grade", width: 8 },
    { header: "학교", key: "school", width: 18 },
    { header: "상태", key: "status", width: 10 },
    { header: "수강 과목", key: "subjects", width: 18 },
    { header: "담임", key: "teacher", width: 12 },
    { header: "학부모 연락처", key: "parentPhone", width: 16 },
    { header: "등록일", key: "enrolledAt", width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF1EDE2" },
  };

  for (const s of students) {
    sheet.addRow({
      name: s.name,
      grade: s.grade ?? "—",
      school: s.school ?? "—",
      status: STATUS_LABEL[s.status] ?? s.status,
      subjects: s.subjects.map((sub) => SUBJECT_LABEL[sub] ?? sub).join(", "),
      teacher: s.primaryTeacherName ?? "—",
      parentPhone: s.parentPhone ?? "—",
      enrolledAt: s.enrolledAt ?? "—",
    });
  }

  return wb;
}
