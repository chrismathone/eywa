import type { ClassListRow, ClassSort } from "./server/queries";

/**
 * 수업목록 정렬(순수 — 서버 조회 `getClassesPage`가 부른다 · 테스트가 직접 본다) — 반 이름(기본 오름차순)·학생 수·담임, 방향은 값에 실린다. 동률은 반 이름 오름차순 → id(쪽 경계가 흔들리지 않게).
 * 담임 미정은 방향과 상관없이 맨 뒤(내림차순에서 맨 위로 올리지 않는다).
 */
export function sortClassRows(rows: ClassListRow[], sort: ClassSort): void {
  const byName = (a: ClassListRow, b: ClassListRow) => a.className.localeCompare(b.className, "ko") || a.id.localeCompare(b.id);
  rows.sort((a, b) => {
    switch (sort) {
      case "students":
        return b.studentCount - a.studentCount || byName(a, b);
      case "students_asc":
        return a.studentCount - b.studentCount || byName(a, b);
      case "teacher":
      case "teacher_desc": {
        if (!a.teacherName !== !b.teacherName) return a.teacherName ? -1 : 1;
        const c = (a.teacherName ?? "").localeCompare(b.teacherName ?? "", "ko");
        return (sort === "teacher" ? c : -c) || byName(a, b);
      }
      case "name_desc":
        return b.className.localeCompare(a.className, "ko") || a.id.localeCompare(b.id);
      default:
        return byName(a, b);
    }
  });
}
