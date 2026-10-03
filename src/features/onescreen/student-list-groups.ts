import type { OneScreenStudent, Subject } from "./types";
import { CLASS_GROUP_MAKEUP, CLASS_GROUP_OTHER } from "./class-tags";
import { rowInClass } from "./grid";
import { MARK_PRESENT, studentMarkOf } from "./attendance-mark";
import { resolveRowFields } from "./row-fields";

/** 대표 반 한 곳에 합치지 않고, 각 수업 아래에 해당 학생·보고서 행을 세운다. */
export function studentListGroups(students: readonly OneScreenStudent[], classFilter: string | null = null) {
  const groups = new Map<string, OneScreenStudent[]>();
  for (const student of students) {
    const rowsByClass = new Map<string, Subject[]>();
    const makeup: Subject[] = [];
    for (const subject of student.subjects) {
      if (!rowInClass(subject, classFilter)) continue;
      const key = subject.makeup && !subject.classId
        ? CLASS_GROUP_MAKEUP
        : subject.className ?? student.className ?? CLASS_GROUP_OTHER;
      // 보강은 같은 과목 행 단위로 선택해야 한다. 정규 수업만 같은 반 안에서 묶는다.
      if (key === CLASS_GROUP_MAKEUP) {
        makeup.push(subject);
      } else {
        rowsByClass.set(key, [...(rowsByClass.get(key) ?? []), subject]);
      }
    }
    for (const [key, subjects] of rowsByClass) add(key, subjects);
    for (const subject of makeup) add(CLASS_GROUP_MAKEUP, [subject]);
    if (!student.subjects.length) add(student.className ?? CLASS_GROUP_OTHER, []);

    function add(key: string, subjects: Subject[]) {
      const fields = subjects[0] ? resolveRowFields(student, subjects[0]) : null;
      const row: OneScreenStudent = {
        ...student, subjects,
        className: key === CLASS_GROUP_MAKEUP ? student.className : key,
        progressConfirmed: student.progressConfirmed && subjects.every(su => !!su.today.trim()),
        ...(fields ? { tests: fields.tests } : {}),
        // 다른 반의 결석을 현재 반에 붙이지 않는다. 옛 행(raw 없음)은 기존 표시를 유지한다.
        attendance: subjects.some(su => su.attendanceRaw !== undefined)
          ? studentMarkOf(subjects.map(su => su.attendanceRaw))
          : key === CLASS_GROUP_MAKEUP ? MARK_PRESENT : student.attendance,
      };
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
  }
  return groups;
}
