import {
  getStudentAttendanceFull,
  getStudentEnrollments,
} from "@/features/students/server/queries";
import { AttendanceView } from "./attendance-view";

/** 출결 탭 — ijw AttendanceTab 이식. 전건을 받아 클라에서 월 달력/리스트 두 뷰·월 네비·반 필터·통계. */
export async function AttendanceTab({ studentId }: { studentId: string }) {
  const [records, enrollments] = await Promise.all([
    getStudentAttendanceFull(studentId),
    getStudentEnrollments(studentId),
  ]);
  // 반 필터 옵션 — 출결이 있는 반 + 수강 반(중복 제거)
  const classMap = new Map<string, string>();
  for (const e of enrollments) classMap.set(e.classId, e.className);
  for (const r of records) if (!classMap.has(r.classId)) classMap.set(r.classId, r.className);
  const classes = [...classMap.entries()].map(([value, label]) => ({ value, label }));

  return <AttendanceView records={records} classes={classes} />;
}
