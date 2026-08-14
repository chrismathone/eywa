import { buildAttendanceClassOptions } from "@/features/students/attendance-tab";
import {
  getStudentAttendanceFull,
  getStudentEnrollments,
} from "@/features/students/server/queries";
import { AttendanceView } from "./attendance-view";

/** 출결 탭 — 전건을 받아 클라에서 월 달력/리스트·월 네비·과목/반 필터·통계. */
export async function AttendanceTab({ studentId }: { studentId: string }) {
  const [records, enrollments] = await Promise.all([
    getStudentAttendanceFull(studentId),
    getStudentEnrollments(studentId),
  ]);
  const classes = buildAttendanceClassOptions(enrollments, records);

  return <AttendanceView records={records} classes={classes} />;
}
