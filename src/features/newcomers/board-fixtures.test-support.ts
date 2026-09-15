/** 테스트 전용 합성 데이터. 실제 페이지 조회에는 연결하지 않는다. */
import { bucketOf, daysBetween, progressOf } from "./onboarding-items";
import type { NewcomerRow, NewcomersView } from "./server/queries";

export const TEST_TODAY = "2026-09-16";
export function testRow(overrides: Partial<NewcomerRow> = {}): NewcomerRow {
  const row = {
    studentId: "student-a", rowKey: "student-a|math", subject: "math", name: "테스트가A", school: "가온중", grade: "중1",
    enrolledOn: "2026-09-10", firstClassOn: "2026-09-11", checks: {}, ...overrides,
  };
  const elapsedDays = daysBetween(row.enrolledOn, TEST_TODAY);
  return { ...row, elapsedDays, bucket: bucketOf(row.enrolledOn, TEST_TODAY), progress: progressOf(row, row.checks, TEST_TODAY) };
}
export function testView(subjectRows = [
  testRow(),
  testRow({ rowKey: "student-a|english", subject: "english", firstClassOn: "2026-09-17" }),
  testRow({ studentId: "student-b", rowKey: "student-b|math", name: "테스트가A", school: "별빛초등학교", grade: "초5", enrolledOn: "2026-08-18", firstClassOn: "2026-09-16" }),
  testRow({ studentId: "student-c", rowKey: "student-c|", subject: null, name: "테스트나", firstClassOn: null }),
]): NewcomersView {
  return { today: TEST_TODAY, subjectRows, rows: [...new Map(subjectRows.map(row => [row.studentId, row])).values()], checksAvailable: true, subjectChecks: true, checksError: null };
}
