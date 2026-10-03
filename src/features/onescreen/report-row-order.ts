import type { GridRow } from "./grid";
import type { ReportSort } from "./display-options";
import { CLASS_GROUP_MAKEUP, CLASS_GROUP_OTHER } from "./class-tags";

export function reportRowGroup(row: GridRow): string {
  return row.subject.makeup && !row.subject.classId ? CLASS_GROUP_MAKEUP
    : row.subject.className ?? row.student.className ?? CLASS_GROUP_OTHER;
}

/** 반별로 묶어도 원본 subjectIndex·행 키는 바꾸지 않는다(편집 대상 보존). */
export function orderReportRows(rows: readonly GridRow[], sort: ReportSort, classOrder: readonly string[] = []): GridRow[] {
  const order = new Map([...new Set([...classOrder, ...rows.map(reportRowGroup)])].map((key, i) => [key, i]));
  return rows.map((row, i) => ({ row, i })).sort((a, b) =>
    (sort === "class" ? order.get(reportRowGroup(a.row))! - order.get(reportRowGroup(b.row))! : a.row.student.name.localeCompare(b.row.student.name, "ko")) || a.i - b.i
  ).map(({ row }) => row);
}
