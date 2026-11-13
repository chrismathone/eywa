/** 보고서가 URL을 만들지 않는다. 같은 조회 행의 실제 UUID로만 내부 상세 주소를 만든다. */
export type ReportEntity = "student" | "staff" | "class";
export type ReportEntityLink = { entity: ReportEntity; idColumn: string };
const PATHS: Record<ReportEntity, string> = { student: "/students", staff: "/staff", class: "/classes" };
const ID_COLUMNS: Record<ReportEntity, readonly string[]> = {
  student: ["student_id", "학생id", "원생id"],
  staff: ["staff_id", "teacher_id", "담당id", "강사id", "직원id"],
  class: ["class_id", "반id"],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function entityIdColumn(link: ReportEntityLink): boolean {
  return Object.hasOwn(ID_COLUMNS, link.entity) && ID_COLUMNS[link.entity].includes(link.idColumn);
}
export function entityHref(link: ReportEntityLink, row: Record<string, unknown>): string | null {
  const id = row[link.idColumn];
  return entityIdColumn(link) && typeof id === "string" && UUID.test(id) ? `${PATHS[link.entity]}/${id}` : null;
}

/** 예전 답도 명시적인 종류별 ID 칸이 있으면 연결한다. 이름 검색·임의 id 칸·여러 이름의 합산 칸은 추측하지 않는다. */
export function inferredEntityLink(column: string, label: string, title: string, columns: readonly string[]): ReportEntityLink | undefined {
  const names = [column, label].map(s => s.replace(/[\s_]/g, "").toLowerCase());
  const matches = (pattern: RegExp) => names.some(s => pattern.test(s));
  const entity: ReportEntity | undefined = matches(/^(학생|학생명|학생이름|원생|원생명|원생이름|student|studentname)$/) ? "student"
    : matches(/^(강사|강사명|강사이름|직원|직원명|담당|담임|담당강사|담임강사|staff|teacher|staffname|teachername)$/) ? "staff"
      : matches(/^(반|반명|반이름|수학반|영어반|class|classname)$/) ? "class"
        : matches(/^(이름|성명|name)$/) && /학생|원생/.test(title) ? "student" : undefined;
  const idColumn = entity ? ID_COLUMNS[entity].find(id => columns.includes(id)) : undefined;
  return entity && idColumn ? { entity, idColumn } : undefined;
}
