import "server-only";
import ExcelJS from "exceljs";
import type { ClassListRow } from "@/features/classes/server/queries";
import { classKindMeta, classStatusMeta } from "@/features/classes/list-filters";
import { sheetDowLabel, sheetT } from "@/features/teacher-view/i18n";

/**
 * 수업목록 엑셀(감사 N2) — **화면 표와 같은 행**을 같은 말로 내보낸다.
 *
 * 🔴 과목 라벨은 학원설정(operations.subjects) 단일 소스 — 호출부가 `buildSubjectMaps().labelOf`를 넣는다(하드코딩 금지).
 * 🔴 상태·구분 문구는 화면 배지와 **같은 사전 키**(`classStatusMeta`·`classKindMeta` → `sheetT("ko")`) — 두 곳에
 *    적으면 같은 반이 화면과 파일에서 다른 말을 한다. 파일은 사무실 문서라 한국어 고정.
 */
export async function buildClassesWorkbook(
  classes: ClassListRow[],
  subjectLabelOf: (key: string) => string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "에이와";
  wb.created = new Date();
  const sheet = wb.addWorksheet("수업목록");

  sheet.columns = [
    { header: "반 이름", key: "name", width: 28 },
    { header: "과목", key: "subject", width: 12 },
    { header: "구분", key: "kind", width: 8 },
    { header: "담임", key: "teacher", width: 14 },
    { header: "강의실", key: "room", width: 14 },
    { header: "요일", key: "days", width: 30 },
    { header: "학생 수", key: "students", width: 9 },
    { header: "상태", key: "status", width: 8 },
    { header: "메모", key: "notes", width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9EE" } };

  for (const c of classes) {
    const days = c.days
      .map((d) => `${sheetDowLabel(d.day, "ko")}${d.start ? ` ${d.start.slice(0, 5)}` : ""}`)
      .join(", ");
    sheet.addRow({
      name: c.className,
      subject: subjectLabelOf(c.subject),
      kind: sheetT("ko", classKindMeta(c).key),
      teacher: c.teacherName ?? "—",
      room: c.classroomName ?? "—",
      // 지난 배치만 남은 반(daysStale)은 화면이 흐리게 그린다 — 파일에선 그 사실을 글로 밝힌다.
      days: days ? (c.daysStale ? `${days} (지난 배치)` : days) : "—",
      students: c.studentCount,
      status: sheetT("ko", classStatusMeta(c).key),
      notes: c.notes ?? "",
    });
  }
  return wb;
}
